// グループをまたぐ操作はここだけ（自分宛ての招待を読む・参加する）。
// 宛先はセッションのユーザーの「確認済み」のメールだけで決める。クライアントから group_id は受け取らない。
import { and, count, eq, sql } from "drizzle-orm";
import { GROUP_MAX_MEMBERS, normalizeEmail } from "../../shared/group";
import type { SessionUser } from "../app-env";
import { Conflict, NotFound, type Db } from "./index";
import * as s from "./schema";

type Meal = "breakfast" | "lunch" | "dinner";

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

      const movedRecipes = await countOf(s.recipes, mine);
      const keptPlans = await db.all<{ date: string; meal: Meal }>(sql`
        select m.date as date, m.meal as meal from meal_plans m
        where m.group_id = ${mine}
          and exists (select 1 from meal_plans h
                      where h.group_id = ${host} and h.date = m.date and h.meal = m.meal)
        order by m.date, m.meal`);

      // 1つのトランザクションで：ぶつかる行は招待した側を残す → 残りを付け替える → 1人グループを消す
      // (注) db.run(sql`...`) は D1 の db.batch() の中では使えない（drizzle-orm の SQLiteRaw に
      // batch 用の .stmt が無く落ちる。実機で確認済み）。同じ SQL を .delete().where() + exists(...) で書く。
      await db.batch([
        db.delete(s.mealPlans).where(
          and(
            eq(s.mealPlans.groupId, mine),
            sql`exists (select 1 from meal_plans h where h.group_id = ${host}
                and h.date = ${s.mealPlans.date} and h.meal = ${s.mealPlans.meal})`,
          ),
        ),
        db.delete(s.shoppingMarks).where(
          and(
            eq(s.shoppingMarks.groupId, mine),
            sql`exists (select 1 from shopping_marks h where h.group_id = ${host}
                and h.key = ${s.shoppingMarks.key} and h.kind = ${s.shoppingMarks.kind})`,
          ),
        ),
        db.delete(s.importReports).where(
          and(
            eq(s.importReports.groupId, mine),
            sql`exists (select 1 from import_reports h where h.group_id = ${host}
                and h.url = ${s.importReports.url})`,
          ),
        ),
        db
          .update(s.recipes)
          .set({ groupId: host })
          .where(eq(s.recipes.groupId, mine)),
        db
          .update(s.recipeVersions)
          .set({ groupId: host })
          .where(eq(s.recipeVersions.groupId, mine)),
        db
          .update(s.recipeMemos)
          .set({ groupId: host })
          .where(eq(s.recipeMemos.groupId, mine)),
        db
          .update(s.recipeImages)
          .set({ groupId: host })
          .where(eq(s.recipeImages.groupId, mine)),
        db
          .update(s.mealPlans)
          .set({ groupId: host })
          .where(eq(s.mealPlans.groupId, mine)),
        db
          .update(s.shoppingMarks)
          .set({ groupId: host })
          .where(eq(s.shoppingMarks.groupId, mine)),
        db
          .update(s.importReports)
          .set({ groupId: host })
          .where(eq(s.importReports.groupId, mine)),
        db
          .delete(s.groupMembers)
          .where(
            and(
              eq(s.groupMembers.groupId, mine),
              eq(s.groupMembers.userId, user.id),
            ),
          ),
        db
          .insert(s.groupMembers)
          .values({ groupId: host, userId: user.id, role: "member" }),
        db.delete(s.groupInvites).where(eq(s.groupInvites.id, inv.id)),
        db.delete(s.groups).where(eq(s.groups.id, mine)),
      ]);
      return { movedRecipes, keptPlans };
    },
  };
}
