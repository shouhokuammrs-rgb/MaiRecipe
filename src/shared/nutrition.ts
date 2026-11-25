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
/**
 * 食材の名前を含んでいても、その食材そのものではない書き方（だし・ジャム・ジュース・粉・料理名など）。
 * 部分一致で別の物を拾わないよう、先に外す
 */
const NOT_THE_FOOD =
  /だし|出汁|ジャム|ジュース|パウダー|ミルク$|の素|エキス|茶$|ケーキ|カツ$|エッグ|詰め|佃煮|ロール(?!いか)|ソース$|たこ焼き|タコス|たこ糸|とろろ昆布|青のり|韓国のり|のりたま|塩辛|ちくわぶ|いかり豆|糸$|絹揚げ|ドライ|(?:みかん|フルーツ|桃|パイン)缶|スープ|ドレッシング|風味|チップス?$|フレーク$|スターチ|ペースト|ピューレ/;
/** 上の書き方に当たっても、成分表に行がある物（オイスターソースなど） */
const STILL_FOOD =
  /オイスターソース|ウスターソース|中濃ソース|とんかつソース|^ソース$|ドライパック|ツナ/;

export function foodForCanonical(n: string): FoodRow | null {
  const hit = FOOD_CACHE.get(n);
  if (hit !== undefined) return hit;
  const food =
    NOT_THE_FOOD.test(n) && !STILL_FOOD.test(n)
      ? null
      : (FOODS.find((f) => f.re.test(n)) ?? null);
  if (FOOD_CACHE.size >= 5000) FOOD_CACHE.clear();
  FOOD_CACHE.set(n, food);
  return food;
}

export function foodFor(name: string): FoodRow | null {
  return foodForCanonical(canonicalName(name));
}

/** 単位の書き方をそろえる（「コ」「ケ」→ 個、「かけ」→ 片 …）。長い書き方を先に当てる */
const UNIT_FORMS: [string, string[]][] = [
  ["パック", ["パック", "pack", "P", "p"]],
  ["切れ", ["切れ", "きれ", "切"]],
  ["片", ["かけら", "かけ", "カケ", "片"]],
  ["個", ["個", "コ", "こ", "ケ", "ヶ", "ヵ"]],
  ["本", ["本"]],
  ["枚", ["枚", "葉"]],
  ["束", ["束", "把", "わ"]],
  ["袋", ["袋"]],
  ["丁", ["丁"]],
  ["玉", ["玉"]],
  ["株", ["株"]],
  ["缶", ["缶"]],
  ["尾", ["尾", "匹"]],
  ["房", ["房"]],
  ["節", ["節"]],
  ["膳", ["膳"]],
  ["杯", ["杯", "はい", "ぱい"]],
  ["合", ["合"]],
  ["cm", ["cm", "センチ"]],
  ["腹", ["腹"]],
  ["粒", ["粒"]],
  ["枝", ["枝"]],
  ["串", ["串"]],
];

const NUM = String.raw`\d+\/\d+|\d+(?:\.\d+)?(?:と\d+\/\d+)?`;
const RANGE = String.raw`(?:\s*(?:[〜~\-、,]|から)\s*(?:${NUM}))?`;
/** 「約200g」「1枚（250g）」のように、グラムが書いてあればそれを使う（幅があれば少ない方） */
const GRAMS = new RegExp(
  String.raw`(${NUM})${RANGE}\s*(kg|g|グラム|キロ)(?:\s*[×xX*]\s*(\d+))?`,
  "i",
);
/** 「2個(1個200g)」「2パック(各150g)」は、数 × 1つ分の重さ */
const EACH_GRAMS = new RegExp(
  String.raw`^(${NUM})[^\d(]*\((?:各|1\D{1,3}?)\s*(${NUM})\s*(?:g|グラム)`,
  "i",
);
const LIQUID = new RegExp(
  String.raw`(${NUM})${RANGE}\s*(ml|cc|l|リットル)`,
  "i",
);
const SPOON = new RegExp(String.raw`(大さじ|小さじ)\s*(${NUM})`);
const CUP = new RegExp(String.raw`(?:(${NUM})\s*カップ|カップ\s*(${NUM}))`);
const COUNT = new RegExp(
  String.raw`^(大|中|小)?(${NUM})${RANGE}\s*([^\d\s(]*)`,
);
/** 量が書いていないが、入れても栄養の計算にほぼ響かない書き方 */
const TINY =
  /少々|適量|適宜|ひとつまみ|ひとつかみ|お好み|好みで|少量|ふたつまみ/;
const SIZE: Record<string, number> = { 大: 1.3, 中: 1, 小: 0.7 };
/** 単位の無い数字を「個数」とみなす上限。「豚肉 200」を 200 パックと読まないため */
const BARE_COUNT_MAX = 10;
const KANJI_DIGIT: Record<string, string> = {
  一: "1",
  二: "2",
  三: "3",
  四: "4",
  五: "5",
};

/** 分量の書き方をそろえる（½ → 1/2、ひとかけ → 1かけ、半丁 → 1/2丁、1個半 → 1.5個 …） */
function tidy(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/⁄/g, "/")
    .replace(/[〜～－–—]/g, "~")
    .replace(/大匙/g, "大さじ")
    .replace(/小匙/g, "小さじ")
    .trim()
    .replace(/^(?:約|およそ|全形|茶碗|お茶碗|どんぶり|丼)\s*/, "")
    .replace(/^(?:[SML](?:サイズ)?|(大|中|小)玉)\s*(?=\d)/i, "$1")
    .replace(/^ひと/, "1")
    .replace(/^ふた/, "2")
    .replace(/^[一二三四五](?=[^\d])/, (c) => KANJI_DIGIT[c]!)
    .replace(/^半(分|個|丁|玉|束|本|枚|身|株|袋|パック)/, (_, u: string) =>
      u === "分" ? "1/2" : u === "身" ? "1/2尾" : `1/2${u}`,
    )
    .replace(/^(\d+)\s+(\d+\/\d+)/, "$1と$2")
    .replace(/^(\d+)(\D{1,3}?)半/, (_, n: string, u: string) => `${n}.5${u}`);
}

const unitKey = (raw: string): string | null => {
  for (const [key, forms] of UNIT_FORMS)
    if (forms.some((f) => raw.startsWith(f))) return key;
  return null;
};

/**
 * 分量の文字列を、その食材のグラムに直す。直せなければ null（当て推量はしない）。
 * 「少々」「適量」は 0g（量が分からないが、計算できない扱いにはしない）
 */
export function gramsOf(amount: string, food: FoodRow): number | null {
  const s = tidy(amount ?? "");
  if (!s) return null;
  let m = s.match(EACH_GRAMS);
  if (m) {
    const a = parseNumber(m[1]!);
    const b = parseNumber(m[2]!);
    return a === null || b === null ? null : a * b;
  }
  m = s.match(GRAMS);
  if (m) {
    const n = parseNumber(m[1]!);
    if (n === null) return null;
    return (/kg|キロ/i.test(m[2]!) ? n * 1000 : n) * (m[3] ? Number(m[3]) : 1);
  }
  const spoon = (kind: string, text: string) => {
    const n = parseNumber(text);
    const per = food.units["大さじ"];
    if (n === null || per === undefined) return null;
    return kind === "大さじ" ? n * per : (n * per) / 3;
  };
  m = s.match(SPOON);
  if (m) return spoon(m[1]!, m[2]!);
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
  if (TINY.test(s)) return 0;
  m = s.match(COUNT);
  if (m) {
    const n = parseNumber(m[2]!);
    if (n === null) return null;
    const raw = m[3] ?? "";
    // 「大2」「小1」は大さじ・小さじの略
    if (raw === "" && (m[1] === "大" || m[1] === "小"))
      return spoon(m[1] === "大" ? "大さじ" : "小さじ", m[2]!);
    const counted = Object.keys(food.units).filter(
      (u) => u !== "大さじ" && u !== "カップ",
    );
    // 単位が無い（「卵 2」「玉ねぎ 1つ」）ときは、その食材のいちばん普通の数え方で数える
    const bare = raw === "" || raw.startsWith("つ");
    if (bare && n > BARE_COUNT_MAX) return null;
    const key = bare ? (counted[0] ?? null) : unitKey(raw);
    const per = key ? food.units[key] : undefined;
    if (per === undefined) return null;
    return n * per * (SIZE[m[1] ?? "中"] ?? 1);
  }
  return null;
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
/** 煮汁・漬けだれ・合わせ調味料になり、全部は食べないことが多い調味料（nutrition-data の key） */
const LIQUID_SEASONINGS = new Set([
  "醤油",
  "みりん",
  "酒",
  "酢",
  "めんつゆ",
  "ポン酢",
  "ウスターソース",
  "オイスターソース",
  "味噌",
]);
/** だしを取って捨てることが多い物（塩昆布・刻み昆布など、食べる昆布は数える） */
const DASHI_ONLY =
  /^(?:かつお節|鰹節|削り節|かつおぶし|花かつお)$|^(?:だし|出汁|乾燥)?(?:昆布|こんぶ)$/;
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
    const section = sectionOfCanonical(name);
    const food = foodForCanonical(name);
    // 煮汁・漬けだれになる調味料と、だしを取って捨てる物は数えない。食べる量が分からず、
    // 数えると「醤油から鉄」「かつお節から鉄」のように、食べていない分で「多い」が出る。
    // ごま・粉・きな粉・塩昆布のように食べ切る物は数える
    if (food && (LIQUID_SEASONINGS.has(food.key) || DASHI_ONLY.test(name)))
      continue;
    const grams = food ? gramsOf(ing.amount, food) : null;
    // 肉・魚が「適量」のときは、主役の量が分からないので「分からない材料」に数える
    const mainUnknown = grams === 0 && (section === "肉" || section === "魚");
    if (!food || grams === null || mainUnknown) {
      // 調味料・水は、計算できなくても「分からない材料」に数えない（量が少なく、響きにくい）
      const minor =
        isStapleCanonical(name) || ["調味料", "飲み物"].includes(section);
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
/**
 * 1人前で、1日の目安の 1/3 以上（1食ぶんをこの一品でまかなえる）なら「多い」、1/6 以上なら「ふつう」。
 * はじめは 1/4 と 1/10 だったが、実際のレシピでは半分以上が「多い」になり、印の意味が無かった
 */
export const LEVEL_HIGH = 1 / 3;
export const LEVEL_MID = 1 / 6;

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
  /** 1日の目安に対する割合（0.33 = 3分の1）。並べるための値で、画面に細かくは出さない */
  ratio: number;
  sources: string[];
  /** 人数が書かれていないので、2人分として計算した */
  servingsAssumed: boolean;
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
      servingsAssumed: n.servingsAssumed,
    });
  }
  ranked.sort(
    (a, b) => b.ratio - a.ratio || a.title.localeCompare(b.title, "ja"),
  );
  return { ranked, skipped };
}
