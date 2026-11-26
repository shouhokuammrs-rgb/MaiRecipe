// 「このレシピに足すなら」（DEC-038 の 2 回目）。AI は使わない。
// 足しやすい食材の表（量と、合う料理の種類）から、選んだ栄養が増える順に出す。
// 栄養の数字はここに書かない（成分表の値 nutrition-data.ts から、足す量ぶんを計算する）。
import {
  NUTRIENTS,
  NUTRIENT_IDS,
  foodByKey,
  foodForCanonical,
  gramsOf,
  levelOf,
  recipeNutrition,
  type NutrientId,
  type NutrientLevel,
  type NutritionIngredient,
} from "./nutrition";
import { canonicalName } from "./ingredients";

/** 料理の種類。名前と作り方の言葉から決める */
export const DISH_KINDS = [
  "炒",
  "煮",
  "汁",
  "和",
  "飯",
  "麺",
  "卵",
  "焼",
] as const;
export type DishKind = (typeof DISH_KINDS)[number];

const KIND_WORDS: Record<DishKind, RegExp> = {
  炒: /炒め|チャンプルー|回鍋肉|ソテー|きんぴら|野菜炒/,
  煮: /煮|おでん|カレー|シチュー|肉じゃが|角煮|含め/,
  汁: /スープ|汁|鍋|チゲ|ポトフ|ミネストローネ|スンドゥブ|豚汁|しゃぶ/,
  和: /和え|あえ|サラダ|ナムル|おひたし|お浸し|マリネ|酢の物|漬け/,
  飯: /ご飯|ごはん|丼|チャーハン|炒飯|ピラフ|おにぎり|炊き込み|リゾット|雑炊|カオマンガイ|ライス/,
  麺: /パスタ|スパゲ|うどん|そば|ラーメン|焼きそば|そうめん|麺|ペペロンチーノ|ナポリタン/,
  卵: /卵焼き|オムレツ|スクランブル|ニラたま|にら玉|かに玉|卵とじ|茶碗蒸し|親子/,
  焼: /焼き|グリル|ホイル|ロースト|ムニエル|ステーキ|照り焼|肉詰め|グラタン/,
};

/** 名前に当たればそれを優先し、当たらなければ作り方の言葉から決める */
export function dishKinds(title: string, steps: string[]): DishKind[] {
  const from = (text: string) =>
    DISH_KINDS.filter((k) => KIND_WORDS[k].test(text));
  const byTitle = from(title);
  return byTitle.length > 0 ? byTitle : from(steps.join(" "));
}

type Addable = {
  /** nutrition-data.ts の key */
  key: string;
  /** レシピ全体に足す量（2〜3人分の料理に無理なく足せる量） */
  amount: string;
  fits: string;
  /** 画面に出す名前（key と違うときだけ） */
  label?: string;
};

/** 足しやすい食材。量は台所での一般的な目安 */
export const ADDABLES: Addable[] = [
  { key: "小松菜", amount: "1/2束", fits: "炒煮汁麺" },
  { key: "ほうれん草", amount: "1/2束", fits: "炒煮汁和麺卵" },
  { key: "春菊", amount: "1/2束", fits: "汁煮和" },
  { key: "水菜", amount: "1/2束", fits: "汁和" },
  { key: "チンゲン菜", amount: "1株", fits: "炒煮汁" },
  { key: "にら", amount: "1/2束", fits: "炒汁卵麺" },
  { key: "豆苗", amount: "1袋", fits: "炒汁和" },
  { key: "ブロッコリー", amount: "1/2個", fits: "炒煮和汁焼麺" },
  { key: "キャベツ", amount: "1/8個", fits: "炒汁煮" },
  { key: "ピーマン", amount: "2個", fits: "炒焼煮" },
  { key: "パプリカ", amount: "1/2個", fits: "炒和焼煮" },
  { key: "にんじん", amount: "1/2本", fits: "炒煮汁和飯" },
  { key: "かぼちゃ", amount: "1/8個", fits: "煮汁焼" },
  { key: "ミニトマト", amount: "6個", fits: "和焼汁麺" },
  { key: "じゃがいも", amount: "1個", fits: "煮汁焼" },
  { key: "さつまいも", amount: "1/2本", fits: "煮汁飯" },
  { key: "ごぼう", amount: "1/2本", fits: "煮炒汁飯" },
  { key: "オクラ", amount: "5本", fits: "和汁炒" },
  { key: "しめじ", amount: "1パック", fits: "炒煮汁飯麺焼" },
  { key: "えのき", amount: "1袋", fits: "汁煮炒" },
  { key: "まいたけ", amount: "1パック", fits: "炒汁煮飯焼" },
  { key: "エリンギ", amount: "2本", fits: "炒焼" },
  {
    key: "きくらげ",
    amount: "大さじ2",
    fits: "炒汁",
    label: "きくらげ（乾燥）",
  },
  { key: "干ししいたけ", amount: "3枚", fits: "煮汁飯" },
  { key: "わかめ", amount: "大さじ1", fits: "汁和", label: "わかめ（乾燥）" },
  { key: "ひじき", amount: "大さじ2", fits: "煮飯和", label: "ひじき（乾燥）" },
  { key: "切り干し大根", amount: "1/2袋", fits: "煮和" },
  { key: "焼きのり", amount: "1枚", fits: "飯麺和" },
  { key: "木綿豆腐", amount: "1/2丁", fits: "汁煮炒", label: "豆腐" },
  { key: "厚揚げ", amount: "1/2枚", fits: "炒煮汁焼" },
  { key: "油揚げ", amount: "1枚", fits: "汁煮飯炒" },
  { key: "高野豆腐", amount: "2枚", fits: "煮汁" },
  { key: "納豆", amount: "2パック", fits: "飯麺和" },
  { key: "大豆", amount: "1袋", fits: "煮汁和飯", label: "大豆（水煮）" },
  { key: "ミックスビーンズ", amount: "1袋", fits: "和汁煮" },
  { key: "卵", amount: "2個", fits: "炒汁飯麺" },
  { key: "チーズ", amount: "2枚", fits: "焼麺" },
  { key: "粉チーズ", amount: "大さじ2", fits: "麺和汁" },
  { key: "牛乳", amount: "1カップ", fits: "汁煮" },
  { key: "しらす", amount: "大さじ3", fits: "飯和卵麺" },
  { key: "桜えび", amount: "大さじ2", fits: "炒飯卵麺和" },
  { key: "ツナ缶", amount: "1缶", fits: "和麺飯炒" },
  { key: "さば缶", amount: "1缶", fits: "煮汁麺飯和" },
  { key: "あさり缶", amount: "1缶", fits: "汁麺飯煮" },
  { key: "ごま", amount: "大さじ2", fits: "和炒飯麺" },
];

/** 栄養ごとの一言（とり方のこつ。広く知られていることだけ） */
export const NUTRIENT_TIPS: Partial<Record<NutrientId, string>> = {
  iron: "野菜や豆の鉄は、ビタミンC の多い野菜や、肉・魚と一緒だと吸収されやすくなります。",
  calcium:
    "カルシウムは、ビタミンD（魚・きのこ）と一緒だと吸収されやすくなります。",
  vitaminA: "ビタミンA は、油と一緒にとると吸収されやすくなります。",
  vitaminD: "ビタミンD は、油と一緒にとると吸収されやすくなります。",
  vitaminC:
    "ビタミンC は熱と水に弱いので、加熱は短めに。汁ごと食べると逃しにくくなります。",
  vitaminB1:
    "ビタミンB1 は水に溶けやすいので、汁ごと食べると逃しにくくなります。",
};

export type Addition = {
  key: string;
  name: string;
  amount: string;
  /** 足したあとの段階。今の段階が分かるときは before も入る */
  before: NutrientLevel | null;
  after: NutrientLevel;
  /** 足す分だけの、1日の目安に対する割合（並べるための値） */
  gain: number;
};

/** 足す分が 1日の目安のこれ未満なら、足す意味が薄いので出さない */
export const ADD_MIN_GAIN = 1 / 12;
export const ADD_MAX = 5;

/**
 * このレシピに足すと、選んだ栄養が増える食材（増える順）。
 * すでに入っている食材は出さない。料理の種類が分かるときは、合う食材だけに絞る
 */
export function suggestAdditions(
  recipe: {
    title: string;
    steps: string[];
    ingredients: NutritionIngredient[];
    servings: number | null | undefined;
  },
  id: NutrientId,
): Addition[] {
  const i = NUTRIENT_IDS.indexOf(id);
  const now = recipeNutrition(recipe.ingredients, recipe.servings);
  const have = new Set(
    recipe.ingredients
      .map((x) => foodForCanonical(canonicalName(x.name))?.key)
      .filter((k): k is string => !!k),
  );
  const kinds = dishKinds(recipe.title, recipe.steps);
  const out: Addition[] = [];
  for (const a of ADDABLES) {
    if (have.has(a.key)) continue;
    if (kinds.length > 0 && !kinds.some((k) => a.fits.includes(k))) continue;
    const food = foodByKey(a.key);
    const grams = food ? gramsOf(a.amount, food) : null;
    if (!food || grams === null) continue;
    const add = (food.per100g[i]! * grams * food.edible) / 100 / now.servings;
    const gain = add / NUTRIENTS[id].daily;
    if (gain < ADD_MIN_GAIN) continue;
    out.push({
      key: a.key,
      name: a.label ?? a.key,
      amount: a.amount,
      before: now.enough ? levelOf(id, now.perServing[i]!) : null,
      after: levelOf(id, (now.enough ? now.perServing[i]! : 0) + add),
      gain,
    });
  }
  return out.sort((x, y) => y.gain - x.gain).slice(0, ADD_MAX);
}
