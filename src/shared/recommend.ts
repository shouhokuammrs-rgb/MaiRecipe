// 冷蔵庫と献立から、保存したレシピに点数を付けて「今日のおすすめ」を作る。AI は使わない。
import { addDays } from "./dates";
import { canonicalName, matchesIngredient } from "./ingredients";
import { isExpiringSoon, isSeasoning } from "./pantry";
import type { Ingredient } from "./recipe";

export const RECO_SLOTS = ["main", "side", "soup"] as const;
export type RecoSlot = (typeof RECO_SLOTS)[number];
export const RECO_LIMIT = 10;

export type RecoRecipe = {
  id: string;
  title: string;
  category: string;
  updatedAt: number;
  ingredients: Ingredient[];
};
export type RecoPantry = { name: string; expiresOn: string | null };
export type RecoPlan = { recipeId: string; date: string };
export type Reco = {
  id: string;
  title: string;
  category: string;
  /** 冷蔵庫にある主な材料（レシピ側の表記） */
  have: string[];
  /** have のうち期限が近いもの */
  soon: string[];
};
export type RecoLists = Record<RecoSlot, Reco[]>;

/** 期限が近い食材1つあたりの加点 */
const SOON_BONUS = 15;
/** 過去7日の献立に入っていたときの減点 */
const RECENT_PENALTY = 25;
/** 今日から6日後までの献立に入っているときの減点 */
const PLANNED_PENALTY = 60;

export function slotOf(category: string): RecoSlot | null {
  if (category === "主菜" || category === "丼") return "main";
  if (category === "副菜") return "side";
  if (category === "汁物") return "soup";
  return null;
}

export function scoreRecipe(
  r: RecoRecipe,
  pantry: RecoPantry[],
  plans: RecoPlan[],
  today: string,
): { score: number; have: string[]; soon: string[] } {
  // 調味料を除き、名寄せした名前で重複を消した「主な材料」（表記はレシピ側の最初のもの）
  const seen = new Set<string>();
  const main: string[] = [];
  for (const ing of r.ingredients) {
    const c = canonicalName(ing.name);
    if (!c || isSeasoning(c) || seen.has(c)) continue;
    seen.add(c);
    main.push(ing.name.trim());
  }
  const have: string[] = [];
  const soon: string[] = [];
  for (const name of main) {
    const hit = pantry.find((p) => matchesIngredient(p.name, name));
    if (!hit) continue;
    have.push(name);
    if (isExpiringSoon(hit.expiresOn, today)) soon.push(name);
  }
  let score = main.length ? (have.length / main.length) * 100 : 0;
  score += soon.length * SOON_BONUS;
  const mine = plans.filter((p) => p.recipeId === r.id);
  if (mine.some((p) => p.date >= addDays(today, -7) && p.date < today))
    score -= RECENT_PENALTY;
  if (mine.some((p) => p.date >= today && p.date <= addDays(today, 6)))
    score -= PLANNED_PENALTY;
  return { score, have, soon };
}

export function rankRecommendations(
  recipes: RecoRecipe[],
  pantry: RecoPantry[],
  plans: RecoPlan[],
  today: string,
): RecoLists {
  const scored = recipes
    .map((r) => ({
      r,
      slot: slotOf(r.category),
      ...scoreRecipe(r, pantry, plans, today),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.r.updatedAt - a.r.updatedAt ||
        a.r.title.localeCompare(b.r.title, "ja"),
    );
  const lists: RecoLists = { main: [], side: [], soup: [] };
  for (const x of scored) {
    if (!x.slot || lists[x.slot].length >= RECO_LIMIT) continue;
    lists[x.slot].push({
      id: x.r.id,
      title: x.r.title,
      category: x.r.category,
      have: x.have,
      soon: x.soon,
    });
  }
  return lists;
}

/** 組み合わせ番号 round と、分類ごとの ⇄ の回数から、今出すセットを選ぶ。レシピの無い分類は出さない */
export function pickSet(
  lists: RecoLists,
  round: number,
  swaps: Record<RecoSlot, number>,
): { slot: RecoSlot; reco: Reco }[] {
  const out: { slot: RecoSlot; reco: Reco }[] = [];
  for (const slot of RECO_SLOTS) {
    const list = lists[slot];
    if (!list.length) continue;
    out.push({ slot, reco: list[(round + swaps[slot]) % list.length]! });
  }
  return out;
}

/** 今日から14日以内で夜が空いている最初の日。無ければ今日 */
export function firstEmptyDinner(
  plans: { date: string; meal: string }[],
  today: string,
): string {
  for (let i = 0; i < 14; i++) {
    const d = addDays(today, i);
    if (!plans.some((p) => p.date === d && p.meal === "dinner")) return d;
  }
  return today;
}
