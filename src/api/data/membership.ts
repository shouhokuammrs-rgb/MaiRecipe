// グループをまたぐ操作はここだけ（自分宛ての招待を読む・参加する）。
// 宛先はセッションのユーザーの「確認済み」のメールだけで決める。クライアントから group_id は受け取らない。
import { and, count, eq, sql } from "drizzle-orm";
import { GROUP_MAX_MEMBERS, normalizeEmail } from "../../shared/group";
import type { SessionUser } from "../app-env";
import { Conflict, NotFound, type Db } from "./index";
import * as s from "./schema";

/**
 * batch の失敗が「参加の INSERT が NOT NULL／UNIQUE 制約で弾かれた」ことによるものか
 * （＝招待の取り消し・人数変化・二重受諾などの競合）を判定する。D1 が返す実際のエラー文
 * （例: `D1_ERROR: NOT NULL constraint failed: group_members.group_id: SQLITE_CONSTRAINT
 * (extended: SQLITE_CONSTRAINT_NOTNULL)`）の文字列だけを対象にし、関係ない外部キー違反や
 * コードのバグはここで握りつぶさない（handleError の 500 に任せる）。
 */
export function isJoinRaceError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes("group_members") &&
    (message.includes("NOT NULL constraint failed") ||
      message.includes("UNIQUE constraint failed"))
  );
}

export function membershipFor(db: Db, user: SessionUser) {
  const email = user.emailVerified ? normalizeEmail(user.email) : null;

  async function countOf(
    table: typeof s.groupMembers | typeof s.recipes,
    groupId: string,
  ) {
    const [r] = await db
      .select({ n: count() })
      .from(table)
      .where(eq(table.groupId, groupId));
    return r?.n ?? 0;
  }

  return {
    async invites() {
      if (!email) return [];
      return db
        .select({
          id: s.groupInvites.id,
          groupName: s.groups.name,
          invitedBy: sql<string>`coalesce(${s.user.name}, '')`,
        })
        .from(s.groupInvites)
        .innerJoin(s.groups, eq(s.groups.id, s.groupInvites.groupId))
        .leftJoin(s.user, eq(s.user.id, s.groupInvites.invitedBy))
        .where(eq(s.groupInvites.email, email));
    },

    async accept(inviteId: string) {
      const inv = email
        ? (
            await db
              .select()
              .from(s.groupInvites)
              .where(
                and(
                  eq(s.groupInvites.id, inviteId),
                  eq(s.groupInvites.email, email),
                ),
              )
              .limit(1)
          )[0]
        : undefined;
      if (!inv) throw new NotFound("invite");
      const host = inv.groupId;

      const myRows = await db
        .select({ groupId: s.groupMembers.groupId })
        .from(s.groupMembers)
        .where(eq(s.groupMembers.userId, user.id));
      if (myRows.some((r) => r.groupId === host))
        throw new Conflict("もうこのグループのメンバーです");
      const mine = myRows[0]?.groupId;
      if (
        !mine ||
        myRows.length !== 1 ||
        (await countOf(s.groupMembers, mine)) > 1
      )
        throw new Conflict(
          "今のグループにほかのメンバーがいるので参加できません",
        );
      if ((await countOf(s.groupMembers, host)) >= GROUP_MAX_MEMBERS)
        throw new Conflict("このグループは人数がいっぱいです");

      // 上の確認はここまでの「よくある場合の分かりやすいエラー」用の下見でしかない。
      // 実際に条件が保たれているかは、この直後の batch の中で改めて確かめる（TOCTOU 対策）。
      // group_members.group_id はサブクエリにし、条件が1つでも崩れていれば NULL になる
      // → NOT NULL 制約違反でこの INSERT が失敗し、D1 の batch はここも含めて全部戻る。
      // これにより「確認したあとに、招待が取り消された／自分か相手のグループの人数が変わった／
      // 別の招待を同時に受けた」などの競合を、DB 側の1回の判定だけで安全に防ぐ。
      const guardedGroupId = sql`(select i.group_id from group_invites i
        where i.id = ${inv.id} and i.email = ${email} and i.group_id = ${host}
          and (select count(*) from group_members m where m.group_id = ${host}) < ${GROUP_MAX_MEMBERS}
          and (select count(*) from group_members m where m.group_id = ${mine}) = 1
          and exists (select 1 from group_members m where m.group_id = ${mine} and m.user_id = ${user.id})
          and not exists (select 1 from group_members m where m.user_id = ${user.id} and m.group_id <> ${mine}))`;

      // batch に渡す1つ1つを名前つきの変数にしてから並べる。結果もこの名前で分割代入して取り出す
      // ので、並びを入れ替えると（変数名を書き忘れない限り）結果の取り違えが起きにくい。
      const insertMember = db.insert(s.groupMembers).values({
        groupId: guardedGroupId,
        userId: user.id,
        role: "member",
      });
      const deleteMyMembership = db
        .delete(s.groupMembers)
        .where(
          and(
            eq(s.groupMembers.groupId, mine),
            eq(s.groupMembers.userId, user.id),
          ),
        );
      const deleteCollidingMarks = db.delete(s.shoppingMarks).where(
        and(
          eq(s.shoppingMarks.groupId, mine),
          sql`exists (select 1 from shopping_marks h where h.group_id = ${host}
              and h.key = ${s.shoppingMarks.key} and h.kind = ${s.shoppingMarks.kind})`,
        ),
      );
      const deleteCollidingReports = db.delete(s.importReports).where(
        and(
          eq(s.importReports.groupId, mine),
          sql`exists (select 1 from import_reports h where h.group_id = ${host}
              and h.url = ${s.importReports.url})`,
        ),
      );
      // 献立はぶつかっても両方残す。参加する側の行の position を、招待した側の同じ枠の
      // 最大 + 1 だけ後ろへずらす（無ければ 0 のまま）。group_id を付け替える movePlans より
      // 前に、別の文で流す：同じ文で group_id も変えると、相関サブクエリがすでに付け替えた
      // 行を拾い、参加する側の品同士の順番が崩れることがあるため。
      // 同じ枠に同じレシピが入ることは無い（レシピの id はグループごとに別）。
      const shiftMyPlans = db
        .update(s.mealPlans)
        .set({
          position: sql`${s.mealPlans.position} + coalesce((select max(h.position) + 1
            from meal_plans h where h.group_id = ${host}
              and h.date = ${s.mealPlans.date} and h.meal = ${s.mealPlans.meal}), 0)`,
        })
        .where(eq(s.mealPlans.groupId, mine));
      const moveRecipes = db
        .update(s.recipes)
        .set({ groupId: host })
        .where(eq(s.recipes.groupId, mine))
        .returning({ id: s.recipes.id });
      const moveVersions = db
        .update(s.recipeVersions)
        .set({ groupId: host })
        .where(eq(s.recipeVersions.groupId, mine));
      const moveMemos = db
        .update(s.recipeMemos)
        .set({ groupId: host })
        .where(eq(s.recipeMemos.groupId, mine));
      const moveImages = db
        .update(s.recipeImages)
        .set({ groupId: host })
        .where(eq(s.recipeImages.groupId, mine));
      const movePlans = db
        .update(s.mealPlans)
        .set({ groupId: host })
        .where(eq(s.mealPlans.groupId, mine));
      const moveMarks = db
        .update(s.shoppingMarks)
        .set({ groupId: host })
        .where(eq(s.shoppingMarks.groupId, mine));
      const moveReports = db
        .update(s.importReports)
        .set({ groupId: host })
        .where(eq(s.importReports.groupId, mine));
      const deleteInvite = db
        .delete(s.groupInvites)
        .where(eq(s.groupInvites.id, inv.id));
      const deleteMyGroup = db.delete(s.groups).where(eq(s.groups.id, mine));

      // 1つのトランザクションで：条件を確かめながら参加 → ぶつかる印・報告は招待した側を残し、献立は後ろに並べる →
      // 残りを付け替える → 1人グループを消す。
      // (注) db.run(sql`...`) は D1 の db.batch() の中では使えない（drizzle-orm の SQLiteRaw に
      // batch 用の .stmt が無く落ちる。実機で確認済み）。同じ SQL を .delete().where() + exists(...) で書く。
      let results;
      try {
        results = await db.batch([
          insertMember,
          deleteMyMembership,
          deleteCollidingMarks,
          deleteCollidingReports,
          shiftMyPlans,
          moveRecipes,
          moveVersions,
          moveMemos,
          moveImages,
          movePlans,
          moveMarks,
          moveReports,
          deleteInvite,
          deleteMyGroup,
        ]);
      } catch (err) {
        console.error(err);
        // group_members への参加 INSERT が NOT NULL／一意制約で失敗したときだけ、競合として
        // 404/409 に変換する。それ以外（コードのバグ・D1 の一時的な不調など）はそのまま投げ、
        // handleError の 500 に任せる（レースを装って本当のバグを隠さない）。
        if (!isJoinRaceError(err)) throw err;

        // 条件が崩れていた（招待が取り消された／人数が変わった／同時に別の招待を受けたなど）。
        // 何も変わっていないので、招待がまだ有効かどうかで案内を分ける。
        const stillThere = email
          ? await db
              .select({ id: s.groupInvites.id })
              .from(s.groupInvites)
              .where(
                and(
                  eq(s.groupInvites.id, inv.id),
                  eq(s.groupInvites.email, email),
                ),
              )
              .limit(1)
          : [];
        if (!stillThere[0]) throw new NotFound("invite");
        throw new Conflict("状況が変わりました。もう一度開いてください");
      }

      // 並びは上の db.batch([...]) と同じ。6番目（index 5）が moveRecipes
      const [, , , , , movedRecipeRows] = results;
      return { movedRecipes: movedRecipeRows.length };
    },
  };
}
