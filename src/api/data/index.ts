// DB に触れる唯一の場所。グループの判定はセッションからだけ行い（クライアントから来た
// group_id は使わない）、すべての読み書きを forGroup(db, groupId) 経由にする。
// D1 には RLS が無いので、ここで必ず group_id を条件に入れる（docs/spec.md §6）。
// D1 は1つのクエリに渡せる値が100個までなので、id の IN リストは使わず group_id で絞る。
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  max,
  sql,
} from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { Ingredient } from "../../shared/recipe";
import type { Tip } from "../../shared/tips";
import { fitStepTimes } from "../../shared/scenes";
import type { RecoRecipe } from "../../shared/recommend";
import { LIMITS } from "../../shared/constants";
import { diffVersions } from "../../shared/recipe";
import { GROUP_MAX_MEMBERS, normalizeEmail } from "../../shared/group";
import { canonicalName } from "../../shared/ingredients";
import { sourceKey } from "../../shared/source-key";
import { isSeasoning, sortPantry } from "../../shared/pantry";
import type { SessionUser } from "../app-env";
import * as s from "./schema";

export type Db = DrizzleD1Database<typeof s>;

/** 同時に読み取れる数（グループごと）。AI の無料枠を一度に使い切らないため */
const IMPORT_JOBS_RUNNING_MAX = 5;
/**
 * これより長く「読み取り中」のままなら、止まったとみなす。
 * Workflow の読み取り（5分まで × やり直し1回 ＋ 待ち）より長くする
 */
const IMPORT_JOB_STUCK_MS = 35 * 60_000;

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

export type PantryItem = {
  id: string;
  name: string;
  amount: string | null;
  expiresOn: string | null;
  addedOn: string;
};

export type RecipeHeader = {
  id: string;
  title: string;
  category: string;
  genre: string;
  timeLabel: string;
  hasImage: boolean;
  /** 出典の画像の URL（null：まだ探していない・""：無かった）。DEC-023 */
  coverUrl: string | null;
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
  /** 何人分か（null：分からない・0：出典を探したが書いていなかった） */
  servings: number | null;
  ingredients: Ingredient[];
  steps: string[];
  /** コツ・ポイント（DEC-024） */
  tips: Tip[];
  /** 手順ごとの、動画の中の開始の秒（無ければ空の配列） */
  stepTimes: (number | null)[];
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
  servings?: number | null;
  ingredients: Ingredient[];
  steps: string[];
  tips?: Tip[];
  stepTimes?: (number | null)[];
};

export class NotFound extends Error {}

export type CookedRow = {
  id: string;
  versionSeq: number | null;
  servings: number;
  cookedOn: string;
  cookedBy: string;
  note: string;
  /** 自分の評価（他の人の評価と食べた記録は本人のものなので返さない。DEC-030） */
  myRating: "again" | "ok" | "meh" | null;
  /** 自分がこの回を食べたか */
  iAte: boolean;
  createdAt: number;
};

/** レシピごとのまとめ（一覧の絞り込みに使う。cooked は新しい順） */
export function cookedStats(cooked: CookedRow[]) {
  return {
    count: cooked.length,
    lastCookedOn: cooked[0]?.cookedOn ?? null,
    again: cooked.filter((c) => c.myRating === "again").length,
    myLatestRating: cooked.find((c) => c.myRating)?.myRating ?? null,
  };
}
export class Forbidden extends Error {}
export class BadInput extends Error {}
export class Conflict extends Error {}

type VersionDb = typeof s.recipeVersions.$inferSelect;
const toVersion = (v: VersionDb): VersionRow => ({
  id: v.id,
  seq: v.seq,
  kind: v.kind,
  title: v.title,
  category: v.category,
  genre: v.genre,
  timeLabel: v.timeLabel,
  servings: v.servings,
  ingredients: v.ingredients,
  steps: v.steps,
  tips: v.tips ?? [],
  stepTimes: v.stepTimes ?? [],
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

  async function ownCookLog(cookLogId: string) {
    const r = await db
      .select({ id: s.cookLogs.id })
      .from(s.cookLogs)
      .where(and(eq(s.cookLogs.id, cookLogId), eq(s.cookLogs.groupId, groupId)))
      .limit(1);
    if (!r[0]) throw new NotFound("cookLog");
  }

  /** レシピの作った記録（新しい順）。評価と食べた人は名前で返す（id は出さない） */
  async function cookedOf(
    recipeId: string,
    userId?: string,
  ): Promise<CookedRow[]> {
    const logs = await db
      .select({
        id: s.cookLogs.id,
        versionSeq: s.cookLogs.versionSeq,
        servings: s.cookLogs.servings,
        cookedOn: s.cookLogs.cookedOn,
        cookedBy: s.user.name,
        note: s.cookLogs.note,
        createdAt: s.cookLogs.createdAt,
      })
      .from(s.cookLogs)
      .leftJoin(s.user, eq(s.user.id, s.cookLogs.cookedBy))
      .where(
        and(eq(s.cookLogs.recipeId, recipeId), eq(s.cookLogs.groupId, groupId)),
      )
      .orderBy(desc(s.cookLogs.cookedOn), desc(s.cookLogs.createdAt));
    if (!logs.length) return [];
    const ids = logs.map((l) => l.id);
    // 評価と食べた記録は本人のものだけ読む（他の人の分はグループに出さない）
    const [ratings, meals] = userId
      ? await Promise.all([
          db
            .select({
              cookLogId: s.cookRatings.cookLogId,
              rating: s.cookRatings.rating,
            })
            .from(s.cookRatings)
            .where(
              and(
                inArray(s.cookRatings.cookLogId, ids),
                eq(s.cookRatings.userId, userId),
              ),
            ),
          db
            .select({ cookLogId: s.mealLogs.cookLogId })
            .from(s.mealLogs)
            .where(
              and(
                inArray(s.mealLogs.cookLogId, ids),
                eq(s.mealLogs.userId, userId),
              ),
            ),
        ])
      : [[], []];
    return logs.map((l) => ({
      id: l.id,
      versionSeq: l.versionSeq,
      servings: l.servings,
      cookedOn: l.cookedOn,
      cookedBy: l.cookedBy ?? "",
      note: l.note,
      myRating: ratings.find((x) => x.cookLogId === l.id)?.rating ?? null,
      iAte: meals.some((x) => x.cookLogId === l.id),
      createdAt: l.createdAt.getTime(),
    }));
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

  /** 自分のグループの献立の1行。無い・他のグループなら NotFound。過ぎた日なら BadInput */
  async function editablePlanItem(id: string, today: string) {
    const r = await db
      .select({
        id: s.mealPlans.id,
        date: s.mealPlans.date,
        meal: s.mealPlans.meal,
        position: s.mealPlans.position,
      })
      .from(s.mealPlans)
      .where(and(eq(s.mealPlans.id, id), eq(s.mealPlans.groupId, groupId)))
      .limit(1);
    if (!r[0]) throw new NotFound("plan");
    if (r[0].date < today) throw new BadInput("過ぎた日の献立は変えられません");
    return r[0];
  }

  /** 自分のグループの冷蔵庫の1行。無い・他のグループなら NotFound */
  async function ownPantryItem(id: string) {
    const r = await db
      .select({ id: s.pantryItems.id })
      .from(s.pantryItems)
      .where(and(eq(s.pantryItems.id, id), eq(s.pantryItems.groupId, groupId)))
      .limit(1);
    if (!r[0]) throw new NotFound("pantry");
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
        coverUrl: r.coverUrl,
        videoUrl: r.videoUrl,
        sourceUrl: r.sourceUrl,
        versionCount: latestNo.get(r.id) ?? 1,
        updatedAt: r.updatedAt.getTime(),
      }));
    },

    async getRecipe(recipeId: string, userId?: string) {
      const r = await recipeRow(recipeId);
      const [versions, cooked, memos] = await Promise.all([
        versionsOf(recipeId),
        cookedOf(recipeId, userId),
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
        coverUrl: r.coverUrl,
        createdAt: r.createdAt.getTime(),
        updatedAt: r.updatedAt.getTime(),
        versions,
        memos: memos.map((m): MemoRow => ({
          id: m.id,
          text: m.text,
          appliedVersionId: m.appliedVersionId,
          createdAt: m.createdAt.getTime(),
        })),
        cooked,
        cookedStats: cookedStats(cooked),
      };
    },

    /**
     * 作った！（DEC-030）。作った記録は共有。食べた人の分だけ本人の食べた記録を入れ、
     * 作った人の評価は本人のものとして入れる。使い切った食材は自分のグループの行だけ消す。
     * 食べた人はグループのメンバーに限る（それ以外は BadInput）
     */
    async addCooked(
      recipeId: string,
      userId: string,
      input: {
        versionId: string | null;
        servings: number;
        eaters: { userId: string; portion: number }[];
        rating: "again" | "ok" | "meh" | null;
        note: string;
        usedPantryIds: string[];
      },
      today: string,
    ): Promise<string> {
      const r = await recipeRow(recipeId);
      const versions = await versionsOf(recipeId);
      const version = input.versionId
        ? versions.find((v) => v.id === input.versionId)
        : versions[versions.length - 1];
      if (!version) throw new NotFound("version");
      if (input.eaters.length) {
        const members = await db
          .select({ userId: s.groupMembers.userId })
          .from(s.groupMembers)
          .where(eq(s.groupMembers.groupId, groupId));
        const ok = new Set(members.map((m) => m.userId));
        if (input.eaters.some((e) => !ok.has(e.userId)))
          throw new BadInput("食べた人はグループのメンバーだけ選べます");
        const seen = new Set<string>();
        for (const e of input.eaters) {
          if (seen.has(e.userId)) throw new BadInput("同じ人が2回あります");
          seen.add(e.userId);
        }
      }
      const id = newId();
      const batch: Parameters<typeof db.batch>[0][number][] = [
        db.insert(s.cookLogs).values({
          id,
          groupId,
          recipeId,
          versionId: version.id,
          versionSeq: version.seq,
          servings: input.servings,
          cookedOn: today,
          cookedBy: userId,
          note: input.note,
        }),
      ];
      if (input.rating)
        batch.push(
          db
            .insert(s.cookRatings)
            .values({ cookLogId: id, userId, rating: input.rating }),
        );
      for (const e of input.eaters)
        batch.push(
          db.insert(s.mealLogs).values({
            id: newId(),
            userId: e.userId,
            date: today,
            kind: "cooked",
            cookLogId: id,
            title: r.title,
            portion: e.portion,
          }),
        );
      if (input.usedPantryIds.length)
        batch.push(
          db
            .delete(s.pantryItems)
            .where(
              and(
                eq(s.pantryItems.groupId, groupId),
                inArray(s.pantryItems.id, input.usedPantryIds),
              ),
            ),
        );
      await db.batch(batch as [(typeof batch)[number], ...typeof batch]);
      return id;
    },

    /** 期間に作った記録（おすすめ・AI 献立の「最近作った」用。レシピの名前つき） */
    async cookedBetween(
      from: string,
      to: string,
    ): Promise<{ recipeId: string; date: string; title: string }[]> {
      const rows = await db
        .select({
          recipeId: s.cookLogs.recipeId,
          date: s.cookLogs.cookedOn,
          title: s.recipes.title,
        })
        .from(s.cookLogs)
        .innerJoin(s.recipes, eq(s.recipes.id, s.cookLogs.recipeId))
        .where(
          and(
            eq(s.cookLogs.groupId, groupId),
            gte(s.cookLogs.cookedOn, from),
            lte(s.cookLogs.cookedOn, to),
          ),
        )
        .orderBy(desc(s.cookLogs.cookedOn));
      return rows;
    },

    /** 作った記録に自分の評価を付ける（null で消す）。他のグループの記録は 404 */
    async rateCooked(
      cookLogId: string,
      userId: string,
      rating: "again" | "ok" | "meh" | null,
    ) {
      await ownCookLog(cookLogId);
      if (!rating) {
        await db
          .delete(s.cookRatings)
          .where(
            and(
              eq(s.cookRatings.cookLogId, cookLogId),
              eq(s.cookRatings.userId, userId),
            ),
          );
        return;
      }
      await db
        .insert(s.cookRatings)
        .values({ cookLogId, userId, rating })
        .onConflictDoUpdate({
          target: [s.cookRatings.cookLogId, s.cookRatings.userId],
          set: { rating },
        });
    },

    /** 作った記録を消す（食べた記録・評価も一緒に消える） */
    async deleteCooked(cookLogId: string) {
      await ownCookLog(cookLogId);
      await db
        .delete(s.cookLogs)
        .where(
          and(eq(s.cookLogs.id, cookLogId), eq(s.cookLogs.groupId, groupId)),
        );
    },

    /**
     * 同じ出典（URL・YouTube の動画）のレシピがグループにあれば返す（二重の取り込みを知らせる）。
     * 表記の揺れをそろえて比べるので、グループのレシピの出典を読んで JS で突き合わせる
     */
    async findBySource(
      url: string,
    ): Promise<{ id: string; title: string } | null> {
      const key = sourceKey(url);
      if (!key) return null;
      const rows = await db
        .select({
          id: s.recipes.id,
          title: s.recipes.title,
          sourceUrl: s.recipes.sourceUrl,
          videoUrl: s.recipes.videoUrl,
        })
        .from(s.recipes)
        .where(inGroup)
        .orderBy(desc(s.recipes.updatedAt));
      const hit = rows.find((r) =>
        [r.sourceUrl, r.videoUrl].some((u) => u && sourceKey(u) === key),
      );
      return hit ? { id: hit.id, title: hit.title } : null;
    },

    /** 出典の画像の URL を覚える（"" は「無かった」）。他のグループのレシピなら何もしない */
    async setCoverUrl(recipeId: string, coverUrl: string) {
      await db
        .update(s.recipes)
        .set({ coverUrl })
        .where(and(eq(s.recipes.id, recipeId), eq(s.recipes.groupId, groupId)));
    },

    /**
     * 出典から分かった人数を、人数の無い版に書き足す（取り込み前に保存したレシピ用）。
     * 0 は「探したが書いていなかった」（もう探さない）。人が決めた人数は上書きしない
     */
    async fillServings(recipeId: string, servings: number) {
      await recipeRow(recipeId);
      await db
        .update(s.recipeVersions)
        .set({ servings })
        .where(
          and(
            eq(s.recipeVersions.recipeId, recipeId),
            versionInGroup,
            isNull(s.recipeVersions.servings),
          ),
        );
    },

    async createRecipe(
      input: RecipeFields & {
        sourceUrl: string | null;
        videoUrl: string | null;
        coverUrl?: string | null;
        origin: "import" | "own" | "ai";
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
          coverUrl: input.coverUrl ?? null,
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
          servings: input.servings ?? null,
          ingredients: input.ingredients,
          steps: input.steps,
          tips: input.tips ?? [],
          stepTimes: fitStepTimes(input.stepTimes, input.steps.length),
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
      // 人数を渡さなかった（古い画面）ときは前の版のまま
      // 0（出典にも無かった）の版から「分からない」で直したときも 0 のまま（もう探さない）
      const servings =
        input.servings === undefined ||
        (input.servings === null && last.servings === 0)
          ? last.servings
          : input.servings;
      // 場面の時刻を渡さなかった（古い画面）ときは、手順が同じなら前の版のまま
      const stepTimes =
        input.stepTimes ??
        (JSON.stringify(input.steps) === JSON.stringify(last.steps)
          ? last.stepTimes
          : []);
      // コツを渡さなかった（古い画面）ときは前の版のまま
      // 手順が減ったときは、無くなった手順のコツを全体のコツにする
      const tips =
        input.tips ??
        last.tips.map((t) =>
          t.step !== null && t.step > input.steps.length
            ? { ...t, step: null }
            : t,
        );
      if (JSON.stringify(tips) !== JSON.stringify(last.tips))
        changes.push("コツを直した");
      if ((last.servings || null) !== (servings || null))
        changes.push(servings ? `${servings}人分にした` : "人数 → なし");
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
          servings,
          ingredients: input.ingredients,
          steps: input.steps,
          tips,
          stepTimes: fitStepTimes(stepTimes, input.steps.length),
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

    /** おすすめ用：レシピの分類・更新日時と、最新版の材料 */
    async recommendRecipes(): Promise<RecoRecipe[]> {
      const [latest, rows] = await Promise.all([
        latestVersionsInGroup(),
        db
          .select({
            id: s.recipes.id,
            title: s.recipes.title,
            category: s.recipes.category,
            genre: s.recipes.genre,
            updatedAt: s.recipes.updatedAt,
          })
          .from(s.recipes)
          .where(inGroup),
      ]);
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        category: r.category,
        genre: r.genre,
        updatedAt: r.updatedAt.getTime(),
        ingredients: latest.get(r.id)?.ingredients ?? [],
      }));
    },

    // ---- 献立（1つの枠に並び順つきで複数の品）
    async listPlans(from: string, to: string) {
      return db
        .select({
          id: s.mealPlans.id,
          date: s.mealPlans.date,
          meal: s.mealPlans.meal,
          position: s.mealPlans.position,
          recipeId: s.mealPlans.recipeId,
          servings: s.mealPlans.servings,
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
        .orderBy(
          asc(s.mealPlans.date),
          sql`case ${s.mealPlans.meal} when 'breakfast' then 0 when 'lunch' then 1 else 2 end`,
          asc(s.mealPlans.position),
          asc(s.mealPlans.id),
        );
    },

    /**
     * 枠の最後に1品足す。同じ枠に同じレシピがあれば何もしない。
     * position は「その枠の最大 + 1」を INSERT の中のサブクエリで決める（Worker で数えない）。
     */
    async addPlan(
      date: string,
      meal: "breakfast" | "lunch" | "dinner",
      recipeId: string,
    ) {
      await recipeRow(recipeId);
      await db
        .insert(s.mealPlans)
        .values({
          id: newId(),
          groupId,
          date,
          meal,
          recipeId,
          position: sql`(select coalesce(max(p.position) + 1, 0) from meal_plans p
            where p.group_id = ${groupId} and p.date = ${date} and p.meal = ${meal})`,
        })
        .onConflictDoNothing();
    },

    /** 1品だけ外す */
    async deletePlanItem(id: string, today: string) {
      await editablePlanItem(id, today);
      await db
        .delete(s.mealPlans)
        .where(and(eq(s.mealPlans.id, id), eq(s.mealPlans.groupId, groupId)));
    },

    /** 献立の1品を何人分作るか（null でふだんの人数）。過ぎた日・他のグループは変えられない */
    async setPlanServings(id: string, servings: number | null, today: string) {
      const item = await editablePlanItem(id, today);
      await db
        .update(s.mealPlans)
        .set({ servings })
        .where(
          and(eq(s.mealPlans.id, item.id), eq(s.mealPlans.groupId, groupId)),
        );
    },

    /**
     * 1つ上・下の品と入れ替える。端なら何もしない。
     * 並びは listPlans と同じ「position → id」の順で決める。position が同じ行が
     * 複数あるとき（移行前のデータや同時書き込みで起き得る）、その枠の全品を今の並び順で
     * 0, 1, 2, … と振り直してから隣と入れ替える。そうしないと、position が同じ2行を
     * 単純に入れ替えても値が変わらず、見た目の順が動かないため。
     * 枠の中の品数は普通は数品なので、枠ごと読み直しても軽い。
     */
    async movePlanItem(id: string, direction: "up" | "down", today: string) {
      const item = await editablePlanItem(id, today);
      const rows = await db
        .select({ id: s.mealPlans.id, position: s.mealPlans.position })
        .from(s.mealPlans)
        .where(
          and(
            eq(s.mealPlans.groupId, groupId),
            eq(s.mealPlans.date, item.date),
            eq(s.mealPlans.meal, item.meal),
          ),
        )
        .orderBy(asc(s.mealPlans.position), asc(s.mealPlans.id));
      const index = rows.findIndex((r) => r.id === item.id);
      const swapWith = direction === "up" ? index - 1 : index + 1;
      if (index < 0 || swapWith < 0 || swapWith >= rows.length) return;
      const reordered = [...rows];
      [reordered[index], reordered[swapWith]] = [
        reordered[swapWith]!,
        reordered[index]!,
      ];
      const updates = reordered
        .map((r, newPosition) => ({
          id: r.id,
          oldPosition: r.position,
          newPosition,
        }))
        .filter((r) => r.oldPosition !== r.newPosition);
      if (!updates.length) return;
      const queries = updates.map((u) =>
        db
          .update(s.mealPlans)
          .set({ position: u.newPosition })
          .where(
            and(eq(s.mealPlans.id, u.id), eq(s.mealPlans.groupId, groupId)),
          ),
      );
      await db.batch(
        queries as [(typeof queries)[number], ...(typeof queries)[number][]],
      );
    },

    /**
     * 枠を丸ごと空にする。画面からは使わないが、古い画面（PWA のキャッシュ）のために残す。
     * 枠に2品以上あるとき、古い画面は「どれか1品だけ消す」つもりでこれを呼んでいる可能性が
     * 高いので、消さずに Conflict（409）にする。1品以下なら今までどおり消す。
     */
    async deletePlan(date: string, meal: "breakfast" | "lunch" | "dinner") {
      const slotCond = and(
        eq(s.mealPlans.groupId, groupId),
        eq(s.mealPlans.date, date),
        eq(s.mealPlans.meal, meal),
      );
      const [row] = await db
        .select({ n: count() })
        .from(s.mealPlans)
        .where(slotCond);
      if ((row?.n ?? 0) >= 2) throw new Conflict("画面を新しくしてください");
      await db.delete(s.mealPlans).where(slotCond);
    },

    // ---- 冷蔵庫（調味料は入れない・出さない。名前は名寄せ後）
    async listPantry(): Promise<PantryItem[]> {
      const rows = await db
        .select({
          id: s.pantryItems.id,
          name: s.pantryItems.name,
          amount: s.pantryItems.amount,
          expiresOn: s.pantryItems.expiresOn,
          addedOn: s.pantryItems.addedOn,
        })
        .from(s.pantryItems)
        .where(eq(s.pantryItems.groupId, groupId));
      return sortPantry(rows.filter((r) => !isSeasoning(r.name)));
    },

    /** 名寄せして入れる。空・調味料・すでにあるものは skipped。1行ずつの INSERT を batch で流す（D1 の値の上限のため） */
    async addPantry(
      names: string[],
      today: string,
    ): Promise<{ added: string[]; skipped: string[] }> {
      const skipped: string[] = [];
      const wanted: string[] = [];
      for (const raw of names) {
        const name = canonicalName(raw);
        if (!name || isSeasoning(name) || wanted.includes(name)) {
          skipped.push(name || raw);
          continue;
        }
        wanted.push(name);
      }
      if (!wanted.length) return { added: [], skipped };
      const inserts = wanted.map((name) =>
        db
          .insert(s.pantryItems)
          .values({ id: newId(), groupId, name, addedOn: today })
          .onConflictDoNothing()
          .returning({ name: s.pantryItems.name }),
      );
      const results = await db.batch(
        inserts as [(typeof inserts)[number], ...(typeof inserts)[number][]],
      );
      const added: string[] = [];
      results.forEach((rows, i) => {
        if (rows.length) added.push(wanted[i]!);
        else skipped.push(wanted[i]!);
      });
      return { added, skipped };
    },

    async updatePantry(
      id: string,
      patch: { amount?: string | null; expiresOn?: string | null },
    ) {
      await ownPantryItem(id);
      await db
        .update(s.pantryItems)
        .set(patch)
        .where(
          and(eq(s.pantryItems.id, id), eq(s.pantryItems.groupId, groupId)),
        );
    },

    async deletePantry(id: string) {
      await ownPantryItem(id);
      await db
        .delete(s.pantryItems)
        .where(
          and(eq(s.pantryItems.id, id), eq(s.pantryItems.groupId, groupId)),
        );
    },

    async removePantryByName(name: string) {
      await db
        .delete(s.pantryItems)
        .where(
          and(
            eq(s.pantryItems.groupId, groupId),
            eq(s.pantryItems.name, canonicalName(name)),
          ),
        );
    },

    async pantryNames(): Promise<Set<string>> {
      const rows = await db
        .select({ name: s.pantryItems.name })
        .from(s.pantryItems)
        .where(eq(s.pantryItems.groupId, groupId));
      return new Set(rows.map((r) => r.name));
    },

    // ---- 買い物リスト
    async shoppingSources(from: string, to: string) {
      const [plans, latest] = await Promise.all([
        db
          .select({
            recipeId: s.mealPlans.recipeId,
            title: s.recipes.title,
            people: s.mealPlans.servings,
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
          ),
        latestVersionsInGroup(),
      ]);
      return plans.map((p) => {
        const v = latest.get(p.recipeId);
        return {
          recipeTitle: p.title,
          ingredients: v?.ingredients ?? [],
          servings: v?.servings || null,
          people: p.people,
        };
      });
    },

    /** 調味料のうち「家にない」印が付いているもの（名寄せ後の名前） */
    async seasoningsOut(): Promise<Set<string>> {
      const rows = await db
        .select({ key: s.shoppingMarks.key })
        .from(s.shoppingMarks)
        .where(
          and(
            eq(s.shoppingMarks.groupId, groupId),
            eq(s.shoppingMarks.kind, "home"),
            eq(s.shoppingMarks.value, false),
          ),
        );
      return new Set(rows.map((r) => r.key));
    },

    async setSeasoningOut(name: string, out: boolean) {
      const key = canonicalName(name);
      if (out) {
        await db
          .insert(s.shoppingMarks)
          .values({ groupId, key, kind: "home", value: false })
          .onConflictDoUpdate({
            target: [
              s.shoppingMarks.groupId,
              s.shoppingMarks.key,
              s.shoppingMarks.kind,
            ],
            set: { value: false, updatedAt: new Date() },
          });
      } else {
        await db
          .delete(s.shoppingMarks)
          .where(
            and(
              eq(s.shoppingMarks.groupId, groupId),
              eq(s.shoppingMarks.key, key),
              eq(s.shoppingMarks.kind, "home"),
            ),
          );
      }
    },

    /** 読めなかった URL を覚えておく。同じ URL は1件だけ。上限を超えたら false */
    async addImportReport(url: string, userId: string): Promise<boolean> {
      const [row] = await db
        .select({ n: count() })
        .from(s.importReports)
        .where(eq(s.importReports.groupId, groupId));
      if ((row?.n ?? 0) >= LIMITS.importReportsMax) {
        // 報告済みの URL なら、送り直しは何もしないだけ
        const same = await db
          .select({ id: s.importReports.id })
          .from(s.importReports)
          .where(
            and(
              eq(s.importReports.groupId, groupId),
              eq(s.importReports.url, url),
            ),
          )
          .limit(1);
        return same.length > 0;
      }
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

    // ---- 裏で進める取り込み（DEC-022）
    /** 読み取りを始める。動いているものが多すぎるときは null */
    async createImportJob(
      url: string,
      userId: string,
      /** 保存済みのレシピの読み直し（グループのレシピでなければ NotFound） */
      recipeId?: string,
    ): Promise<string | null> {
      if (recipeId) await recipeRow(recipeId);
      const [row] = await db
        .select({ n: count() })
        .from(s.importJobs)
        .where(
          and(
            eq(s.importJobs.groupId, groupId),
            eq(s.importJobs.status, "running"),
            // 止まったまま残ったものは数えない（いつまでも始められなくならないように）
            gte(
              s.importJobs.updatedAt,
              new Date(Date.now() - IMPORT_JOB_STUCK_MS),
            ),
          ),
        );
      if ((row?.n ?? 0) >= IMPORT_JOBS_RUNNING_MAX) return null;
      const id = newId();
      await db.insert(s.importJobs).values({
        id,
        groupId,
        url,
        recipeId: recipeId ?? null,
        createdBy: userId,
        status: "running",
        updatedAt: new Date(),
      });
      return id;
    },

    /** 読み終えた（または読めなかった）結果を入れる。他のグループの id なら何もしない */
    async finishImportJob(
      id: string,
      outcome: { result: unknown } | { error: string },
    ) {
      await db
        .update(s.importJobs)
        .set(
          "result" in outcome
            ? {
                status: "done",
                result: JSON.stringify(outcome.result),
                updatedAt: new Date(),
              }
            : {
                status: "failed",
                error: outcome.error.slice(0, 300),
                updatedAt: new Date(),
              },
        )
        .where(
          and(
            eq(s.importJobs.id, id),
            eq(s.importJobs.groupId, groupId),
            eq(s.importJobs.status, "running"),
          ),
        );
    },

    /** 最近の読み取り（1日以内）。長く止まったままのものは「読めなかった」として返す */
    async listImportJobs(now = Date.now()) {
      const rows = await db
        .select()
        .from(s.importJobs)
        .where(
          and(
            eq(s.importJobs.groupId, groupId),
            gte(s.importJobs.createdAt, new Date(now - 24 * 3600_000)),
          ),
        )
        .orderBy(desc(s.importJobs.createdAt))
        .limit(20);
      return rows.map((r) => {
        const stuck =
          r.status === "running" &&
          now - r.updatedAt.getTime() > IMPORT_JOB_STUCK_MS;
        return {
          id: r.id,
          url: r.url,
          recipeId: r.recipeId,
          status: stuck ? ("failed" as const) : r.status,
          result: r.result ? (JSON.parse(r.result) as unknown) : null,
          error: stuck
            ? "時間がかかりすぎたので止めました。もう一度試してください。"
            : r.error,
          createdAt: r.createdAt.getTime(),
        };
      });
    },

    /** 確かめ終わった（保存した・やめた）読み取りを消す */
    async deleteImportJob(id: string) {
      await db
        .delete(s.importJobs)
        .where(and(eq(s.importJobs.id, id), eq(s.importJobs.groupId, groupId)));
    },

    // ---- いっしょに使う人（グループのメンバーと招待）
    async groupInfo(userId: string) {
      const [g, members, invites] = await Promise.all([
        db
          .select({ name: s.groups.name, servings: s.groups.servings })
          .from(s.groups)
          .where(eq(s.groups.id, groupId))
          .limit(1),
        db
          .select({
            id: s.user.id,
            name: s.user.name,
            role: s.groupMembers.role,
          })
          .from(s.groupMembers)
          .innerJoin(s.user, eq(s.user.id, s.groupMembers.userId))
          .where(eq(s.groupMembers.groupId, groupId))
          // created_at は秒までしか無いので、同じ秒に増えたメンバー同士は順序が定まらない。
          // owner（招待した人）を先頭に固定し、created_at → user_id の順で最後まで決める。
          .orderBy(
            sql`case when ${s.groupMembers.role} = 'owner' then 0 else 1 end`,
            asc(s.groupMembers.createdAt),
            asc(s.groupMembers.userId),
          ),
        db
          .select({ id: s.groupInvites.id, email: s.groupInvites.email })
          .from(s.groupInvites)
          .where(eq(s.groupInvites.groupId, groupId))
          .orderBy(asc(s.groupInvites.createdAt)),
      ]);
      return {
        name: g[0]?.name ?? "",
        servings: g[0]?.servings ?? 2,
        members: members.map((m) => ({
          id: m.id,
          name: m.name,
          isMe: m.id === userId,
          role: m.role,
        })),
        invites,
      };
    },

    /** ふだん作る人数 */
    async householdServings(): Promise<number> {
      const g = await db
        .select({ servings: s.groups.servings })
        .from(s.groups)
        .where(eq(s.groups.id, groupId))
        .limit(1);
      return g[0]?.servings ?? 2;
    },

    async setHouseholdServings(servings: number) {
      await db
        .update(s.groups)
        .set({ servings, updatedAt: new Date() })
        .where(eq(s.groups.id, groupId));
    },

    /** email は正規化済み。同じ相手への招待は何もしない */
    async addInvite(email: string, me: SessionUser) {
      if (email === normalizeEmail(me.email))
        throw new BadInput("自分は招待できません");
      const [members, invites] = await Promise.all([
        db
          .select({ email: s.user.email })
          .from(s.groupMembers)
          .innerJoin(s.user, eq(s.user.id, s.groupMembers.userId))
          .where(eq(s.groupMembers.groupId, groupId)),
        db
          .select({ email: s.groupInvites.email })
          .from(s.groupInvites)
          .where(eq(s.groupInvites.groupId, groupId)),
      ]);
      if (members.some((m) => normalizeEmail(m.email) === email))
        throw new Conflict("この人はもうメンバーです");
      if (invites.some((i) => i.email === email)) return;
      if (members.length + invites.length >= GROUP_MAX_MEMBERS)
        throw new Conflict(
          `いっしょに使えるのは自分以外${GROUP_MAX_MEMBERS - 1}人までです`,
        );
      await db
        .insert(s.groupInvites)
        .values({ id: newId(), groupId, email, invitedBy: me.id })
        .onConflictDoNothing();
    },

    async cancelInvite(id: string) {
      const r = await db
        .delete(s.groupInvites)
        .where(
          and(eq(s.groupInvites.id, id), eq(s.groupInvites.groupId, groupId)),
        )
        .returning({ id: s.groupInvites.id });
      if (!r.length) throw new NotFound("invite");
    },
  };
}

export type GroupRepo = ReturnType<typeof forGroup>;
