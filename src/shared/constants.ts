// 画面と API で共有する定数。Cloudflare に依存しない。

export const CATEGORIES = [
  "主菜",
  "副菜",
  "汁物",
  /** ご飯・麺・パン（丼もここ。DEC-020） */
  "主食",
  "デザート",
  "その他",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const GENRES = [
  "和食",
  "洋食",
  "中華",
  "韓国",
  "エスニック",
  "その他",
] as const;
export type Genre = (typeof GENRES)[number];

export const MEALS = ["breakfast", "lunch", "dinner"] as const;
export type Meal = (typeof MEALS)[number];
export const MEAL_LABELS: Record<Meal, string> = {
  breakfast: "朝",
  lunch: "昼",
  dinner: "夜",
};

/**
 * 買い物リストの売り場の分け方。並びは日本のスーパーのよくある回り方（入口の青果 → 奥の鮮魚・精肉 →
 * 日配 → 加工食品 → 冷凍・飲料）。家ごとに並び替えられる（DEC-032）
 */
export const SHOP_SECTIONS = [
  "野菜・果物",
  "魚",
  "肉",
  "卵・豆腐・乳製品",
  "調味料",
  "乾物・缶詰",
  "米・パン・麺",
  "冷凍食品",
  "飲み物",
  "その他",
] as const;
export type ShopSection = (typeof SHOP_SECTIONS)[number];

/** 版の種類 */
export const VERSION_KINDS = ["original", "memo", "manual"] as const;
export type VersionKind = (typeof VERSION_KINDS)[number];
export const VERSION_KIND_LABELS: Record<VersionKind, string> = {
  original: "元のレシピ",
  memo: "メモから更新",
  manual: "自分で編集",
};

export const LIMITS = {
  titleMax: 100,
  ingredientNameMax: 60,
  amountMax: 30,
  ingredientsMax: 60,
  stepMax: 500,
  stepsMax: 40,
  memoMax: 1000,
  urlMax: 2000,
  imageMaxBytes: 1_000_000,
  /** 読めなかった URL の報告（1グループあたり） */
  importReportsMax: 200,
} as const;
