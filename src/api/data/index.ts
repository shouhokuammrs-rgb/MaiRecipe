// DB に触れる唯一の場所。グループの判定はセッションからだけ行い（クライアントから来た
// group_id は使わない）、すべての読み書きを forGroup(db, groupId) 経由にする。
// D1 には RLS が無いので、ここで必ず group_id を条件に入れる（docs/spec.md §6）。
// D1 は1つのクエリに渡せる値が100個までなので、id の IN リストは使わず group_id で絞る。
import { and, asc, count, desc, eq, gte, lte, max, sql } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { Ingredient } from "../../shared/recipe";
import { LIMITS } from "../../shared/constants";
import { diffVersions } from "../../shared/recipe";
import * as s from "./schema";

export type Db = DrizzleD1Database<typeof s>;

export function openDb(d1: D1Database): Db {
  return drizzle(d1, { schema: s });
}

const newId = () => crypto.randomUUID();

/**
 * ログイン中のユーザーのグループ。まだ無ければ1人グループを作る。
 * 1人グループの id はユーザーごとに固定なので、同時に初回アクセスが来ても1つしかできない。
 */
export async function resolveGroupId(
  db: Db,
  userId: string,
  userName: string,
): Promise<string> {
  const found = await db
    .select({ groupId: s.groupMembers.groupId })
    .from(s.groupMembers)
    .where(eq(s.groupMembers.userId, userId))
    .orderBy(asc(s.groupMembers.createdAt), asc(s.groupMembers.groupId))
    .limit(1);
  if (found[0]) return found[0].groupId;
  const groupId = `personal-${userId}`;
  await db.batch([
    db
      .insert(s.groups)
      .values({ id: groupId, name: `${userName || "わたし"}のレシピ` })
      .onConflictDoNothing(),
    db
      .insert(s.groupMembers)
      .values({ groupId, userId, role: "owner" })
      .onConflictDoNothing(),
  ]);
  return groupId;
}

export type RecipeHeader = {
  id: string;
  title: string;
  category: string;
  genre: string;
  timeLabel: string;
  hasImage: boolean;
  videoUrl: string | null;
  sourceUrl: string | null;
  /** 最新版の番号（v◯ の表示用） */
  versionCount: number;
  updatedAt: number;
};

export type VersionRow = {
  id: string;
  seq: number;
  kind: "original" | "memo" | "manual";
  title: string;
  category: string;
  genre: string;
  timeLabel: string;
  ingredients: Ingredient[];
  steps: string[];
  changes: string[];
  createdAt: number;
};

export type MemoRow = {
  id: string;
  text: string;
  appliedVersionId: string | null;
  createdAt: number;
};

export type RecipeFields = {
  title: string;
  category: string;
  genre: string;
  timeLabel: string;
  ingredients: Ingredient[];
  steps: string[];
};

export class NotFound extends Error {}
export class Forbidden extends Error {}

type VersionDb = typeof s.recipeVersions.$inferSelect;
const toVersion = (v: VersionDb): VersionRow => ({
  id: v.id,
  seq: v.seq,
  kind: v.kind,
  title: v.title,
  category: v.category,
  genre: v.genre,
  timeLabel: v.timeLabel,
  ingredients: v.ingredients,
  steps: v.steps,
  changes: v.changes,
  createdAt: v.createdAt.getTime(),
});

/** SQL の LIKE で、% と _ と \ をそのままの文字として探す */
function likeContains(column: typeof s.recipes.title, term: string) {
  const escaped = term.replace(/[\\%_]/g, "\\$&");
  return sql`${column} LIKE ${`%${escaped}%`} ESCAPE '\\'`;
}

export function forGroup(db: Db, groupId: string) {
  const inGroup = eq(s.recipes.groupId, groupId);
  const versionInGroup = eq(s.recipeVersions.groupId, groupId);

  async function recipeRow(recipeId: string) {
    const r = await db
      .select()
      .from(s.recipes)
      .where(and(eq(s.recipes.id, recipeId), inGroup))
      .limit(1);
    if (!r[0]) throw new NotFound("recipe");
    return r[0];
  }

  async function versionsOf(recipeId: string): Promise<VersionRow[]> {
    const rows = await db
      .select()
      .from(s.recipeVersions)
      .where(and(eq(s.recipeVersions.recipeId, recipeId), versionInGroup))
      .orderBy(asc(s.recipeVersions.seq));
    return rows.map(toVersion);
  }

  /** グループの全レシピの最新版（残っている版のうち seq が最大のもの） */
  async function latestVersionsInGroup(): Promise<Map<string, VersionRow>> {
    const rows = await db
      .select()
      .from(s.recipeVersions)
      .where(
        and(
          versionInGroup,
          sql`${s.recipeVersions.seq} = (select max(v2.seq) from recipe_versions v2 where v2.recipe_id = ${s.recipeVersions.recipeId})`,
        ),
      );
    return new Map(rows.map((v) => [v.recipeId, toVersion(v)]));
  }

  /** 最新版の中身を見出し（recipes）に写す。版を消したあとに使う */
  async function syncHeaderFromLatest(recipeId: string) {
    const vs = await versionsOf(recipeId);
    const last = vs[vs.length - 1];
    if (!last) return;
    await db
      .update(s.recipes)
      .set({
        title: last.title,
        category: last.category,
        genre: last.genre,
        timeLabel: last.timeLabel,
        updatedAt: new Date(),
      })
      .where(and(eq(s.recipes.id, recipeId), inGroup));
  }

  return {
    groupId,

    async listRecipes(opts: {
      q?: string;
      category?: string;
      genre?: string;
    }): Promise<RecipeHeader[]> {
      const conds = [inGroup];
      if (opts.category) conds.push(eq(s.recipes.category, opts.category));
      if (opts.genre) conds.push(eq(s.recipes.genre, opts.genre));
      if (opts.q) conds.push(likeContains(s.recipes.title, opts.q));
      const [rows, latest] = await Promise.all([
        db
          .select()
          .from(s.recipes)
          .where(and(...conds))
          .orderBy(desc(s.recipes.updatedAt))
          .limit(500),
        db
          .select({
            recipeId: s.recipeVersions.recipeId,
            n: max(s.recipeVersions.seq),
          })
          .from(s.recipeVersions)
          .where(versionInGroup)
          .groupBy(s.recipeVersions.recipeId),
      ]);
      const latestNo = new Map(
        latest.map((c) => [c.recipeId, Number(c.n ?? 1)]),
      );
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        category: r.category,
        genre: r.genre,
        timeLabel: r.timeLabel,
        hasImage: r.hasImage,
        videoUrl: r.videoUrl,
        sourceUrl: r.sourceUrl,
        versionCount: latestNo.get(r.id) ?? 1,
        updatedAt: r.updatedAt.getTime(),
      }));
    },

    async getRecipe(recipeId: string) {
      const r = await recipeRow(recipeId);
      const [versions, memos] = await Promise.all([
        versionsOf(recipeId),
        db
          .select()
          .from(s.recipeMemos)
          .where(
            and(
              eq(s.recipeMemos.recipeId, recipeId),
              eq(s.recipeMemos.groupId, groupId),
            ),
          )
          .orderBy(asc(s.recipeMemos.createdAt)),
      ]);
      return {
        id: r.id,
        title: r.title,
        category: r.category,
        genre: r.genre,
        timeLabel: r.timeLabel,
        sourceUrl: r.sourceUrl,
        videoUrl: r.videoUrl,
        origin: r.origin,
        hasImage: r.hasImage,
        createdAt: r.createdAt.getTime(),
        updatedAt: r.updatedAt.getTime(),
        versions,
        memos: memos.map((m): MemoRow => ({
          id: m.id,
          text: m.text,
          appliedVersionId: m.appliedVersionId,
          createdAt: m.createdAt.getTime(),
        })),
      };
    },

    async createRecipe(
      input: RecipeFields & {
        sourceUrl: string | null;
        videoUrl: string | null;
        origin: "import" | "own";
      },
      userId: string,
    ): Promise<string> {
      const id = newId();
      await db.batch([
        db.insert(s.recipes).values({
          id,
          groupId,
          authorId: userId,
          title: input.title,
          category: input.category,
          genre: input.genre,
          timeLabel: input.timeLabel,
          sourceUrl: input.sourceUrl,
          videoUrl: input.videoUrl,
          origin: input.origin,
          lastSeq: 1,
        }),
        db.insert(s.recipeVersions).values({
          id: newId(),
          recipeId: id,
          groupId,
          seq: 1,
          kind: "original",
          title: input.title,
          category: input.category,
          genre: input.genre,
          timeLabel: input.timeLabel,
          ingredients: input.ingredients,
          steps: input.steps,
          changes: [],
          createdBy: userId,
        }),
      ]);
      return id;
    },

    /**
     * 新しい版を積む。前の版と何も変わらなければ null（版を増やさない）。
     * memoId を渡すと、そのメモを「この版に反映した」と記録する。
     */
    async addVersion(
      recipeId: string,
      input: RecipeFields & { memoId?: string },
      userId: string,
    ) {
      const r = await recipeRow(recipeId);
      const vs = await versionsOf(recipeId);
      const last = vs[vs.length - 1];
      if (!last) throw new NotFound("version");
      const changes = diffVersions(last, input);
      if (last.category !== input.category)
        changes.unshift(`カテゴリ → ${input.category}`);
      if (last.genre !== input.genre)
        changes.unshift(`ジャンル → ${input.genre}`);
      if (last.timeLabel !== input.timeLabel)
        changes.push(`時間 → ${input.timeLabel || "なし"}`);
      if (!changes.length) return null;

      let memoId: string | undefined;
      if (input.memoId) {
        const m = await db
          .select({ id: s.recipeMemos.id })
          .from(s.recipeMemos)
          .where(
            and(
              eq(s.recipeMemos.id, input.memoId),
              eq(s.recipeMemos.recipeId, recipeId),
              eq(s.recipeMemos.groupId, groupId),
            ),
          )
          .limit(1);
        if (!m[0]) throw new NotFound("memo");
        memoId = m[0].id;
      }
      const seq = Math.max(r.lastSeq, ...vs.map((v) => v.seq)) + 1;
      const versionId = newId();
      await db.batch([
        db.insert(s.recipeVersions).values({
          id: versionId,
          recipeId,
          groupId,
          seq,
          kind: memoId ? "memo" : "manual",
          title: input.title,
          category: input.category,
          genre: input.genre,
          timeLabel: input.timeLabel,
          ingredients: input.ingredients,
          steps: input.steps,
          changes,
          createdBy: userId,
        }),
        db
          .update(s.recipes)
          .set({
            title: input.title,
            category: input.category,
            genre: input.genre,
            timeLabel: input.timeLabel,
            lastSeq: seq,
            updatedAt: new Date(),
          })
          .where(and(eq(s.recipes.id, recipeId), inGroup)),
        ...(memoId
          ? [
              db
                .update(s.recipeMemos)
                .set({ appliedVersionId: versionId })
                .where(
                  and(
                    eq(s.recipeMemos.id, memoId),
                    eq(s.recipeMemos.groupId, groupId),
                  ),
                ),
            ]
          : []),
      ]);
      return { versionId, seq, changes };
    },

    /** 版を消す。元のレシピ（original）は消せない。反映していたメモは未反映に戻る */
    async deleteVersion(recipeId: string, versionId: string) {
      await recipeRow(recipeId);
      const v = await db
        .select({ kind: s.recipeVersions.kind })
        .from(s.recipeVersions)
        .where(
          and(
            eq(s.recipeVersions.id, versionId),
            eq(s.recipeVersions.recipeId, recipeId),
            versionInGroup,
          ),
        )
        .limit(1);
      if (!v[0]) throw new NotFound("version");
      if (v[0].kind === "original")
        throw new Forbidden("元のレシピは消せません");
      await db.batch([
        db
          .update(s.recipeMemos)
          .set({ appliedVersionId: null })
          .where(
            and(
              eq(s.recipeMemos.appliedVersionId, versionId),
              eq(s.recipeMemos.groupId, groupId),
            ),
          ),
        db
          .delete(s.recipeVersions)
          .where(and(eq(s.recipeVersions.id, versionId), versionInGroup)),
      ]);
      await syncHeaderFromLatest(recipeId);
    },

    async addMemo(recipeId: string, text: string, userId: string) {
      await recipeRow(recipeId);
      const id = newId();
      await db
        .insert(s.recipeMemos)
        .values({ id, recipeId, groupId, text, createdBy: userId });
      return id;
    },

    async deleteMemo(recipeId: string, memoId: string) {
      const res = await db
        .delete(s.recipeMemos)
        .where(
          and(
            eq(s.recipeMemos.id, memoId),
            eq(s.recipeMemos.recipeId, recipeId),
            eq(s.recipeMemos.groupId, groupId),
          ),
        )
        .returning({ id: s.recipeMemos.id });
      if (!res[0]) throw new NotFound("memo");
    },

    async deleteRecipe(recipeId: string) {
      const res = await db
        .delete(s.recipes)
        .where(and(eq(s.recipes.id, recipeId), inGroup))
        .returning({ id: s.recipes.id });
      if (!res[0]) throw new NotFound("recipe");
    },

    async putImage(recipeId: string, mime: string, data: ArrayBuffer) {
      await recipeRow(recipeId);
      const buf = Buffer.from(data);
      await db.batch([
        db
          .insert(s.recipeImages)
          .values({ recipeId, groupId, mime, data: buf })
          .onConflictDoUpdate({
            target: s.recipeImages.recipeId,
            set: { mime, data: buf },
            setWhere: eq(s.recipeImages.groupId, groupId),
          }),
        db
          .update(s.recipes)
          .set({ hasImage: true, updatedAt: new Date() })
          .where(and(eq(s.recipes.id, recipeId), inGroup)),
      ]);
    },

    async getImage(recipeId: string) {
      const r = await db
        .select({ mime: s.recipeImages.mime, data: s.recipeImages.data })
        .from(s.recipeImages)
        .where(
          and(
            eq(s.recipeImages.recipeId, recipeId),
            eq(s.recipeImages.groupId, groupId),
          ),
        )
        .limit(1);
      if (!r[0]) throw new NotFound("image");
      return r[0];
    },

    async deleteImage(recipeId: string) {
      await recipeRow(recipeId);
      await db.batch([
        db
          .delete(s.recipeImages)
          .where(
            and(
              eq(s.recipeImages.recipeId, recipeId),
              eq(s.recipeImages.groupId, groupId),
            ),
          ),
        db
          .update(s.recipes)
          .set({ hasImage: false, updatedAt: new Date() })
          .where(and(eq(s.recipes.id, recipeId), inGroup)),
      ]);
    },

    /** 「材料から探す」用：全レシピの最新版の材料 */
    async allLatestIngredients() {
      const latest = await latestVersionsInGroup();
      const rows = await db
        .select({ id: s.recipes.id, title: s.recipes.title })
        .from(s.recipes)
        .where(inGroup);
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        ingredients: latest.get(r.id)?.ingredients ?? [],
      }));
    },

    // ---- 献立
    async listPlans(from: string, to: string) {
      return db
        .select({
          date: s.mealPlans.date,
          meal: s.mealPlans.meal,
          recipeId: s.mealPlans.recipeId,
          title: s.recipes.title,
          category: s.recipes.category,
        })
        .from(s.mealPlans)
        .innerJoin(
          s.recipes,
          and(eq(s.recipes.id, s.mealPlans.recipeId), inGroup),
        )
        .where(
          and(
            eq(s.mealPlans.groupId, groupId),
            gte(s.mealPlans.date, from),
            lte(s.mealPlans.date, to),
          ),
        )
        .orderBy(asc(s.mealPlans.date));
    },

    async setPlan(
      date: string,
      meal: "breakfast" | "lunch" | "dinner",
      recipeId: string,
    ) {
      await recipeRow(recipeId);
      await db
        .insert(s.mealPlans)
        .values({ id: newId(), groupId, date, meal, recipeId })
        .onConflictDoUpdate({
          target: [s.mealPlans.groupId, s.mealPlans.date, s.mealPlans.meal],
          set: { recipeId },
        });
    },

    async deletePlan(date: string, meal: "breakfast" | "lunch" | "dinner") {
      await db
        .delete(s.mealPlans)
        .where(
          and(
            eq(s.mealPlans.groupId, groupId),
            eq(s.mealPlans.date, date),
            eq(s.mealPlans.meal, meal),
          ),
        );
    },

    // ---- 買い物リスト
    async shoppingSources(from: string, to: string) {
      const [plans, latest] = await Promise.all([
        db
          .select({ recipeId: s.mealPlans.recipeId, title: s.recipes.title })
          .from(s.mealPlans)
          .innerJoin(
            s.recipes,
            and(eq(s.recipes.id, s.mealPlans.recipeId), inGroup),
          )
          .where(
            and(
              eq(s.mealPlans.groupId, groupId),
              gte(s.mealPlans.date, from),
              lte(s.mealPlans.date, to),
            ),
          ),
        latestVersionsInGroup(),
      ]);
      return plans.map((p) => ({
        recipeTitle: p.title,
        ingredients: latest.get(p.recipeId)?.ingredients ?? [],
      }));
    },

    async shoppingMarks() {
      return db
        .select({
          key: s.shoppingMarks.key,
          kind: s.shoppingMarks.kind,
          value: s.shoppingMarks.value,
        })
        .from(s.shoppingMarks)
        .where(eq(s.shoppingMarks.groupId, groupId));
    },

    async setShoppingMark(
      key: string,
      kind: "home" | "bought",
      value: boolean,
    ) {
      await db
        .insert(s.shoppingMarks)
        .values({ groupId, key, kind, value })
        .onConflictDoUpdate({
          target: [
            s.shoppingMarks.groupId,
            s.shoppingMarks.key,
            s.shoppingMarks.kind,
          ],
          set: { value, updatedAt: new Date() },
        });
    },

    /** 読めなかった URL を覚えておく。同じ URL は1件だけ。上限を超えたら false */
    async addImportReport(url: string, userId: string): Promise<boolean> {
      const [row] = await db
        .select({ n: count() })
        .from(s.importReports)
        .where(eq(s.importReports.groupId, groupId));
      if ((row?.n ?? 0) >= LIMITS.importReportsMax) return false;
      await db
        .insert(s.importReports)
        .values({ id: newId(), groupId, url, createdBy: userId })
        .onConflictDoNothing();
      return true;
    },

    async listImportReports() {
      const rows = await db
        .select({
          url: s.importReports.url,
          createdAt: s.importReports.createdAt,
        })
        .from(s.importReports)
        .where(eq(s.importReports.groupId, groupId))
        .orderBy(desc(s.importReports.createdAt))
        .limit(200);
      return rows.map((r) => ({
        url: r.url,
        createdAt: r.createdAt.getTime(),
      }));
    },

    async clearBought() {
      await db
        .delete(s.shoppingMarks)
        .where(
          and(
            eq(s.shoppingMarks.groupId, groupId),
            eq(s.shoppingMarks.kind, "bought"),
          ),
        );
    },
  };
}

export type GroupRepo = ReturnType<typeof forGroup>;
