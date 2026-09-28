// 画面と API で共有する定数。Cloudflare に依存しない。

export const CATEGORIES = [
  "主菜",
  "副菜",
  "汁物",
  "丼",
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

/** 買い物リストの売り場の分け方（並び順もこの順） */
export const SHOP_SECTIONS = [
  "野菜・きのこ",
  "肉・魚・卵",
  "その他",
  "調味料",
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
