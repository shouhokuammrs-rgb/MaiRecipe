// レシピの栄養の目安（DEC-038）。AI は使わない。数字は成分表から計算する。
// 「日本食品標準成分表（八訂）増補2023年」の値（nutrition-data.ts）に、材料名と分量を当てはめる。
// 分量をグラムに直すところで誤差が出るので、画面には細かい数字ではなく「多い／ふつう／少なめ」で出す。
import { parseNumber } from "./amount";
import {
  canonicalName,
  isStapleCanonical,
  sectionOfCanonical,
} from "./ingredients";
import { FOOD_ROWS, type FoodRow } from "./nutrition-data";

/** 並びは nutrition-data.ts の per100g と同じ（scripts/nutrition/build.py の COLS） */
export const NUTRIENT_IDS = [
  "iron",
  "calcium",
  "protein",
  "fiber",
  "vitaminA",
  "vitaminB1",
  "vitaminC",
  "vitaminD",
] as const;
export type NutrientId = (typeof NUTRIENT_IDS)[number];

/**
 * daily は「栄養素等表示基準値（2025）」（18歳以上・食品表示基準 別表第10）。
 * 性別や年齢で分けない 1 つの目安として使う（人ごとの必要量ではない）
 */
export const NUTRIENTS: Record<
  NutrientId,
  { label: string; unit: string; daily: number; about: string }
> = {
  iron: {
    label: "鉄",
    unit: "mg",
    daily: 6.5,
    about: "レバー・貝・青菜・大豆製品に多い",
  },
  calcium: {
    label: "カルシウム",
    unit: "mg",
    daily: 700,
    about: "乳製品・小魚・青菜・大豆製品に多い",
  },
  protein: {
    label: "たんぱく質",
    unit: "g",
    daily: 85,
    about: "肉・魚・卵・大豆製品に多い",
  },
  fiber: {
    label: "食物繊維",
    unit: "g",
    daily: 20,
    about: "野菜・きのこ・海藻・豆に多い",
  },
  vitaminA: {
    label: "ビタミンA",
    unit: "μg",
    daily: 770,
    about: "レバー・にんじん・かぼちゃ・青菜に多い",
  },
  vitaminB1: {
    label: "ビタミンB1",
    unit: "mg",
    daily: 1.0,
    about: "豚肉・大豆・玄米に多い",
  },
  vitaminC: {
    label: "ビタミンC",
    unit: "mg",
    daily: 100,
    about: "ピーマン・ブロッコリー・果物・いもに多い",
  },
  vitaminD: {
    label: "ビタミンD",
    unit: "μg",
    daily: 9.0,
    about: "魚・きのこ・卵に多い",
  },
};

export const NUTRITION_SOURCE =
  "日本食品標準成分表（八訂）増補2023年から引用して計算";

export function isNutrientId(x: unknown): x is NutrientId {
  return (
    typeof x === "string" && (NUTRIENT_IDS as readonly string[]).includes(x)
  );
}

type Food = FoodRow & { re: RegExp };
const FOODS: Food[] = FOOD_ROWS.map((f) => ({
  ...f,
  re: new RegExp(f.pattern),
}));
const FOOD_CACHE = new Map<string, Food | null>();

/** 名寄せ済みの材料名から、成分表の食材を探す。分からなければ null（当て推量はしない） */
export function foodForCanonical(n: string): FoodRow | null {
  const hit = FOOD_CACHE.get(n);
  if (hit !== undefined) return hit;
  const food = FOODS.find((f) => f.re.test(n)) ?? null;
  if (FOOD_CACHE.size >= 5000) FOOD_CACHE.clear();
  FOOD_CACHE.set(n, food);
  return food;
}

export function foodFor(name: string): FoodRow | null {
  return foodForCanonical(canonicalName(name));
}

/** 単位の書き方をそろえる（「コ」「ケ」→ 個、「かけ」→ 片 …） */
const UNIT_ALIASES: [RegExp, string][] = [
  [/^(?:個|コ|こ|ケ|ヶ|ケ|玉子)$/, "個"],
  [/^(?:本|ほん)$/, "本"],
  [/^(?:枚|まい)$/, "枚"],
  [/^(?:束|把|わ)$/, "束"],
  [/^(?:袋|ふくろ)$/, "袋"],
  [/^(?:パック|pack|P|p)$/, "パック"],
  [/^(?:丁|ちょう)$/, "丁"],
  [/^(?:片|かけ|カケ|かけら)$/, "片"],
  [/^(?:玉|たま)$/, "玉"],
  [/^(?:株|かぶ)$/, "株"],
  [/^(?:缶|かん)$/, "缶"],
  [/^(?:切れ|切|きれ)$/, "切れ"],
  [/^(?:尾|匹|び)$/, "尾"],
  [/^(?:房|ふさ)$/, "房"],
  [/^(?:節|ふし)$/, "節"],
  [/^(?:膳|ぜん)$/, "膳"],
  [/^(?:杯|はい|ぱい)$/, "杯"],
  [/^合$/, "合"],
  [/^(?:cm|センチ|㎝)$/i, "cm"],
  [/^腹$/, "腹"],
  [/^(?:粒|つぶ)$/, "粒"],
  [/^枝$/, "枝"],
];

const NUM = String.raw`\d+\/\d+|\d+(?:\.\d+)?(?:と\d+\/\d+)?`;
/** 「約200g」「1枚（250g）」のように、グラムが書いてあればそれを使う */
const GRAMS = new RegExp(
  String.raw`(${NUM})\s*(kg|ｋｇ|g|ｇ|グラム|キロ)`,
  "i",
);
const LIQUID = new RegExp(String.raw`(${NUM})\s*(ml|cc|l|リットル)`, "i");
const SPOON = new RegExp(String.raw`(大さじ|小さじ)\s*(${NUM})`);
const CUP = new RegExp(String.raw`(?:(${NUM})\s*カップ|カップ\s*(${NUM}))`);
const COUNT = new RegExp(
  String.raw`^(?:約|およそ)?(大|中|小)?(${NUM})(?:\s*[〜~～\-－]\s*(?:${NUM}))?\s*([^\d\s(（]*)`,
);
/** 量が書いていないが、入れても栄養の計算にほぼ響かない書き方 */
const TINY =
  /少々|適量|適宜|ひとつまみ|ひとつかみ|お好み|好みで|少量|ふたつまみ/;
const SIZE: Record<string, number> = { 大: 1.3, 中: 1, 小: 0.7 };

const unitKey = (raw: string): string | null => {
  const u = raw.replace(/分$/, "");
  for (const [re, key] of UNIT_ALIASES) if (re.test(u)) return key;
  return null;
};

/**
 * 分量の文字列を、その食材のグラムに直す。直せなければ null（当て推量はしない）。
 * 「少々」「適量」は 0g（量が分からないが、計算できない扱いにはしない）
 */
export function gramsOf(amount: string, food: FoodRow): number | null {
  const s = (amount ?? "").normalize("NFKC").trim();
  if (!s) return null;
  let m = s.match(GRAMS);
  if (m) {
    const n = parseNumber(m[1]!);
    if (n === null) return null;
    return /kg|キロ/i.test(m[2]!) ? n * 1000 : n;
  }
  m = s.match(SPOON);
  if (m) {
    const n = parseNumber(m[2]!);
    const per = food.units["大さじ"];
    if (n === null || per === undefined) return null;
    return m[1] === "大さじ" ? n * per : (n * per) / 3;
  }
  m = s.match(CUP);
  if (m) {
    const n = parseNumber((m[1] ?? m[2])!);
    const per = food.units["カップ"];
    if (n === null || per === undefined) return null;
    return n * per;
  }
  m = s.match(LIQUID);
  if (m) {
    const n = parseNumber(m[1]!);
    if (n === null) return null;
    const ml = /^(?:l|リットル)$/i.test(m[2]!) ? n * 1000 : n;
    const cup = food.units["カップ"];
    // 1カップ = 200ml。カップの重さが分からない食材は、水と同じ重さとみなさない
    return cup === undefined ? null : (ml * cup) / 200;
  }
  m = s.match(COUNT);
  if (m) {
    const n = parseNumber(m[2]!);
    if (n === null) return null;
    const raw = m[3] ?? "";
    const counted = Object.keys(food.units).filter(
      (u) => u !== "大さじ" && u !== "カップ",
    );
    // 単位が無い（「卵 2」）ときは、その食材のいちばん普通の数え方で数える
    const key = raw === "" ? (counted[0] ?? null) : unitKey(raw);
    const per = key ? food.units[key] : undefined;
    if (per === undefined) return null;
    return n * per * (SIZE[m[1] ?? "中"] ?? 1);
  }
  return TINY.test(s) ? 0 : null;
}

export type NutritionIngredient = { name: string; amount: string };
export type NutritionPart = {
  name: string;
  grams: number;
  /** 1人前あたり。並びは NUTRIENT_IDS */
  values: number[];
};
export type RecipeNutrition = {
  /** 1人前あたり。並びは NUTRIENT_IDS */
  perServing: number[];
  /** 計算に入れた材料（多い順に並べるのは使う側） */
  parts: NutritionPart[];
  /** 計算できた材料の数・計算できなかった材料の名前（調味料は数えない） */
  known: number;
  unknown: string[];
  /** 何人分で割ったか。レシピに書いていなければ 2 とみなす */
  servings: number;
  servingsAssumed: boolean;
  /** 目安として出してよいか（材料の半分以上が計算できた） */
  enough: boolean;
};

export const DEFAULT_SERVINGS = 2;
const zeros = () => NUTRIENT_IDS.map(() => 0);

/** レシピ 1 つの、1人前あたりの栄養の目安 */
export function recipeNutrition(
  ingredients: NutritionIngredient[],
  servings: number | null | undefined,
): RecipeNutrition {
  const people = servings && servings > 0 ? servings : DEFAULT_SERVINGS;
  const perServing = zeros();
  const parts: NutritionPart[] = [];
  const unknown: string[] = [];
  for (const ing of ingredients) {
    const name = canonicalName(ing.name);
    if (!name) continue;
    const food = foodForCanonical(name);
    const grams = food ? gramsOf(ing.amount, food) : null;
    if (!food || grams === null) {
      // 調味料・水は、計算できなくても「分からない材料」に数えない（量が少なく、響きにくい）
      const minor =
        isStapleCanonical(name) ||
        ["調味料", "飲み物"].includes(sectionOfCanonical(name));
      if (!minor) unknown.push(name);
      continue;
    }
    // 殻つきで量る貝は、食べられる分だけを数える
    const eaten = grams * food.edible;
    const values = food.per100g.map((v) => (v * eaten) / 100 / people);
    values.forEach((v, i) => (perServing[i]! += v));
    parts.push({ name, grams, values });
  }
  // 調味料だけ計算できても、料理の目安にはならない
  const main = parts.filter(
    (p) => !isStapleCanonical(p.name) && p.grams > 0,
  ).length;
  return {
    perServing,
    parts,
    known: main,
    unknown,
    servings: people,
    servingsAssumed: !(servings && servings > 0),
    enough: main > 0 && main >= unknown.length,
  };
}

export type NutrientLevel = "high" | "mid" | "low";
export const LEVEL_LABEL: Record<NutrientLevel, string> = {
  high: "多い",
  mid: "ふつう",
  low: "少なめ",
};
/** 1人前で、1日の目安の 1/4 以上なら「多い」、1/10 以上なら「ふつう」 */
export const LEVEL_HIGH = 1 / 4;
export const LEVEL_MID = 1 / 10;

export function levelOf(id: NutrientId, perServing: number): NutrientLevel {
  const ratio = perServing / NUTRIENTS[id].daily;
  return ratio >= LEVEL_HIGH ? "high" : ratio >= LEVEL_MID ? "mid" : "low";
}

const indexOf = (id: NutrientId) => NUTRIENT_IDS.indexOf(id);

/** このレシピで「多い」栄養素（多い順）。目安として出せないレシピは空 */
export function highNutrients(n: RecipeNutrition): NutrientId[] {
  if (!n.enough) return [];
  return NUTRIENT_IDS.filter(
    (id) => levelOf(id, n.perServing[indexOf(id)]!) === "high",
  ).sort(
    (a, b) =>
      n.perServing[indexOf(b)]! / NUTRIENTS[b].daily -
      n.perServing[indexOf(a)]! / NUTRIENTS[a].daily,
  );
}

/** その栄養素を主に運んでいる材料の名前（多い順・最大 max 個） */
export function mainSources(
  n: RecipeNutrition,
  id: NutrientId,
  max = 2,
): string[] {
  const i = indexOf(id);
  const total = n.perServing[i]!;
  if (total <= 0) return [];
  return [...n.parts]
    .filter((p) => p.values[i]! / total >= 0.15)
    .sort((a, b) => b.values[i]! - a.values[i]!)
    .slice(0, max)
    .map((p) => p.name);
}

export type NutritionRecipe = {
  id: string;
  title: string;
  servings: number | null;
  ingredients: NutritionIngredient[];
};
export type NutrientRank = {
  id: string;
  title: string;
  level: NutrientLevel;
  /** 1日の目安に対する割合（0.25 = 4分の1）。並べるための値で、画面に細かくは出さない */
  ratio: number;
  sources: string[];
};
export type NutrientRanking = {
  ranked: NutrientRank[];
  /** 材料や分量が読めず、目安を出せなかったレシピの数 */
  skipped: number;
};

/** 手持ちのレシピを、選んだ栄養素が多い順に並べる（「少なめ」は出さない） */
export function rankByNutrient(
  recipes: NutritionRecipe[],
  id: NutrientId,
): NutrientRanking {
  const i = indexOf(id);
  const ranked: NutrientRank[] = [];
  let skipped = 0;
  for (const r of recipes) {
    const n = recipeNutrition(r.ingredients, r.servings);
    if (!n.enough) {
      skipped++;
      continue;
    }
    const level = levelOf(id, n.perServing[i]!);
    if (level === "low") continue;
    ranked.push({
      id: r.id,
      title: r.title,
      level,
      ratio: n.perServing[i]! / NUTRIENTS[id].daily,
      sources: mainSources(n, id),
    });
  }
  ranked.sort(
    (a, b) => b.ratio - a.ratio || a.title.localeCompare(b.title, "ja"),
  );
  return { ranked, skipped };
}
