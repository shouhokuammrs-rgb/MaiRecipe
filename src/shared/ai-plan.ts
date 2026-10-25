// AI に献立を考えてもらう（#15 の3つ目 / DEC-028）。ここは純粋な部分（頼む文を作る・返事を確かめる）。
// 使うのは自分たちが保存したレシピだけ。AI にはレシピを番号で渡し、返ってきた番号をレシピに戻す
// （AI が知らないレシピを作ったり、id を書き換えたりできないように）。保存は人が選んでから
import { z } from "zod";
import { MEALS, type Meal } from "./constants";

export type PlanRecipe = {
  id: string;
  title: string;
  category: string;
  genre: string;
  /** 主な材料（名前だけ） */
  ingredients: string[];
};

export type PlanInput = {
  /** 考える日（YYYY-MM-DD） */
  dates: string[];
  meals: Meal[];
  recipes: PlanRecipe[];
  pantry: { name: string; soon: boolean }[];
  /** 最近（過去7日）作ったレシピの名前 */
  recent: string[];
  /** 考える日にもう入っている献立 */
  planned: { date: string; meal: Meal; title: string }[];
  /** 「野菜多めで」などの希望（任意） */
  wish: string;
};

export type PlanSuggestion = {
  date: string;
  meal: Meal;
  recipeIds: string[];
  reason: string;
};

/** AI に渡すレシピの数の上限（長くなりすぎないように、最近のものから） */
export const PLAN_RECIPES_MAX = 80;
/** 1つの枠（日付×食事）に入れる品の上限 */
const ITEMS_MAX = 3;

const MEAL_NAMES: Record<Meal, string> = {
  breakfast: "朝食",
  lunch: "昼食",
  dinner: "夕食",
};
const WEEKDAYS = "日月火水木金土";
const weekday = (date: string) =>
  WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? "";

export const planSuggestSchema = z.object({
  /** 今日から何日分（1〜7） */
  days: z.number().int().min(1).max(7),
  meals: z.array(z.enum(MEALS)).min(1).max(3),
  wish: z.string().trim().max(100).default(""),
});

export function buildPlanPrompt(p: PlanInput) {
  const system = [
    "あなたは家庭の献立を考える手伝いをします。",
    "下の「保存しているレシピ」の中からだけ選んで、日ごとの献立を組んでください。新しいレシピは作らない。",
    "必ず次の JSON だけを返す（前後に説明や ``` を付けない）：",
    '{"plan":[{"date":"YYYY-MM-DD","meal":"dinner","items":[レシピの番号, ...],"reason":"なぜこの組み合わせか（30字くらい）"}]}',
    "決まり：",
    "- meal は breakfast・lunch・dinner のどれか。頼まれた日と食事だけ",
    "- 1食は主菜か主食を中心に、副菜・汁物を合わせて1〜3品",
    "- 期限が近い食材を使うレシピを先に。最近作ったものと、同じ材料・同じジャンルが続くのは避ける",
    "- もう献立が入っている食事は、足りない品だけを足す（無ければその食事は入れない）",
    "- 希望があれば、できるだけ合わせる",
    "- 合うレシピが無ければ、その食事は入れない",
  ].join("\n");
  const user = [
    "保存しているレシピ：",
    ...p.recipes.map(
      (r, k) =>
        `${k + 1}. ${r.title}（${r.category}・${r.genre}）${r.ingredients.length ? `材料：${r.ingredients.join("、")}` : ""}`,
    ),
    "",
    `冷蔵庫：${p.pantry.length ? p.pantry.map((i) => (i.soon ? `${i.name}（期限が近い）` : i.name)).join("、") : "（記録なし）"}`,
    `最近作った：${p.recent.length ? p.recent.join("、") : "（なし）"}`,
    ...(p.planned.length
      ? [
          "もう入っている献立：",
          ...p.planned.map(
            (x) => `- ${x.date} ${MEAL_NAMES[x.meal]}：${x.title}`,
          ),
        ]
      : []),
    `希望：${p.wish || "（なし）"}`,
    "",
    "考える日と食事：",
    ...p.dates.flatMap((d) =>
      p.meals.map((m) => `- ${d}（${weekday(d)}）${MEAL_NAMES[m]}`),
    ),
  ].join("\n");
  return { system, user };
}

const slotSchema = z.object({
  date: z.string(),
  meal: z.string(),
  items: z.array(z.unknown()),
  reason: z.unknown().optional(),
});

const asNumber = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v)
    ? v
    : typeof v === "string" && /^\d+$/.test(v.trim())
      ? Number(v)
      : null;

/**
 * AI の返事を確かめて、保存しているレシピの献立案だけにする。
 * 頼んでいない日・食事、知らない番号、同じ枠の2つ目は捨てる。読めなければ null
 */
export function parsePlanSuggestion(
  raw: string,
  input: PlanInput,
): PlanSuggestion[] | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  const list = (json as { plan?: unknown })?.plan;
  if (!Array.isArray(list)) return null;
  const dates = new Set(input.dates);
  const meals = new Set<string>(input.meals);
  const seen = new Set<string>();
  const out: PlanSuggestion[] = [];
  for (const item of list) {
    const p = slotSchema.safeParse(item);
    if (!p.success) continue;
    const { date, meal } = p.data;
    if (!dates.has(date) || !meals.has(meal)) continue;
    const key = `${date}|${meal}`;
    if (seen.has(key)) continue;
    const ids: string[] = [];
    for (const v of p.data.items) {
      const n = asNumber(v);
      const r = n !== null ? input.recipes[n - 1] : undefined;
      if (r && !ids.includes(r.id)) ids.push(r.id);
      if (ids.length >= ITEMS_MAX) break;
    }
    if (!ids.length) continue;
    seen.add(key);
    out.push({
      date,
      meal: meal as Meal,
      recipeIds: ids,
      reason:
        typeof p.data.reason === "string"
          ? p.data.reason.replace(/\s+/g, " ").trim().slice(0, 60)
          : "",
    });
  }
  return out;
}
