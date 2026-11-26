// 「このレシピに足すなら」（DEC-038 の 2 回目）。AI は使わない。
// 足しやすい食材の表（量と、合う料理の種類）から、選んだ栄養が増える順に出す。
// 栄養の数字はここに書かない（成分表の値 nutrition-data.ts から、足す量ぶんを計算する）。
import { canonicalName } from "./ingredients";
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
import { scaleAmount } from "./servings";

/**
 * 料理の種類。料理の名前だけから決める（作り方の文は見ない。「鍋に湯を沸かす」「汁気を切る」
 * 「和える」のような、どの料理にも出る言葉で取り違えるため）
 */
export const DISH_KINDS = ["麺", "飯", "卵", "汁", "和", "炒", "煮"] as const;
export type DishKind = (typeof DISH_KINDS)[number];
/** mix = 料理に混ぜる／side = 種類が分からない・焼き物・揚げ物なので、添える物だけ／none = 出さない */
export type AddMode = "mix" | "side" | "none";

/** お菓子・たれなど、栄養を足す相手ではない物 */
const NOT_A_DISH =
  /プリン|ケーキ|クッキー|どら焼き|大学芋|焼き芋|ゼリー|アイス|マフィン|タルト|団子|ぜんざい|ドーナツ|パフェ|チョコ|スコーン|たれ$|タレ$|ドレッシング|ソース$|ジャム|ジュース|スムージー|ドリンク/;

/** 上から順に当て、最初に当たった 1 つを使う（「焼きそば」は麺、「カレーライス」は煮、「親子丼」は飯） */
const KIND_RULES: [DishKind, RegExp][] = [
  [
    "麺",
    /パスタ|スパゲ|うどん|そば(?!粉)|ラーメン|そうめん|麺|ペペロンチーノ|ナポリタン|カルボナーラ|冷やし中華|ビーフン/,
  ],
  ["飯", /ドライカレー|キーマ/],
  ["煮", /カレー|シチュー|ハヤシ/],
  [
    "飯",
    /丼|チャーハン|炒飯|ピラフ|おにぎり|炊き込み|リゾット|雑炊|おかゆ|お粥|カオマンガイ|茶漬け|釜飯|天津飯|ご飯$|ごはん$|ライス$|寿司|ビビンバ|オムライス/,
  ],
  [
    "卵",
    /卵焼き|玉子焼き|オムレツ|スクランブル|[ニに][ラら](たま|玉)|かに玉|卵とじ|茶碗蒸し|目玉焼き/,
  ],
  [
    "汁",
    /スープ|味噌汁|みそ汁|豚汁|けんちん汁|すまし汁|お吸い物|(?<![回土中])鍋(?!焼|しぎ|肉)|チゲ|ポトフ|ミネストローネ|スンドゥブ|しゃぶしゃぶ|すき焼き|おでん|水炊き|チャウダー/,
  ],
  [
    "和",
    /和え|あえ|サラダ(?!チキン)|ナムル|おひたし|お浸し|マリネ|酢の物|浅漬け|冷奴|冷しゃぶ/,
  ],
  ["炒", /炒め|チャンプルー|回鍋肉|ソテー|きんぴら|麻婆|青椒肉絲|チンジャオ/],
  ["煮", /煮(?!卵|干し)|肉じゃが|角煮|[ぶブ][りリ]大根|豚バラ大根/],
];

export function dishKind(title: string): DishKind | null {
  return KIND_RULES.find(([, re]) => re.test(title))?.[0] ?? null;
}

type Addable = {
  /** nutrition-data.ts の key */
  key: string;
  /** 2人分の料理に足す量（人数に合わせて換算して出す） */
  amount: string;
  /** 合う料理の種類。「添」は、焼き物・揚げ物などに添えられる物 */
  fits: string;
  /** 画面に出す名前（key と違うときだけ） */
  label?: string;
  /** 缶詰（上位が缶詰だらけにならないよう、1 つまでにする） */
  can?: true;
};

/** 足しやすい食材。量は台所での一般的な目安 */
export const ADDABLES: Addable[] = [
  { key: "小松菜", amount: "1/2束", fits: "炒煮汁麺添" },
  { key: "ほうれん草", amount: "1/2束", fits: "炒煮汁和麺卵添" },
  { key: "春菊", amount: "1/2束", fits: "汁和" },
  { key: "水菜", amount: "1/2束", fits: "汁和添" },
  { key: "チンゲン菜", amount: "1株", fits: "炒煮汁" },
  { key: "にら", amount: "1/2束", fits: "炒汁卵麺" },
  { key: "豆苗", amount: "1袋", fits: "炒汁和" },
  { key: "ブロッコリー", amount: "1/2個", fits: "炒煮和汁麺添" },
  { key: "キャベツ", amount: "1/8個", fits: "炒汁煮添" },
  { key: "ピーマン", amount: "2個", fits: "炒煮添" },
  { key: "パプリカ", amount: "1/2個", fits: "炒和煮添" },
  { key: "にんじん", amount: "1/2本", fits: "炒煮汁和飯添" },
  { key: "かぼちゃ", amount: "1/8個", fits: "煮汁添" },
  { key: "ミニトマト", amount: "6個", fits: "和麺添" },
  { key: "じゃがいも", amount: "1個", fits: "煮汁添" },
  { key: "さつまいも", amount: "1/2本", fits: "煮汁飯添" },
  { key: "ごぼう", amount: "1/2本", fits: "煮炒汁飯" },
  { key: "えのき", amount: "1袋", fits: "汁煮炒" },
  { key: "まいたけ", amount: "1パック", fits: "炒汁煮飯麺添" },
  {
    key: "きくらげ",
    amount: "大さじ2",
    fits: "炒汁",
    label: "きくらげ（乾燥）",
  },
  { key: "干ししいたけ", amount: "3枚", fits: "煮汁飯" },
  { key: "ひじき", amount: "大さじ3", fits: "煮飯和", label: "ひじき（乾燥）" },
  { key: "切り干し大根", amount: "1/2袋", fits: "煮和" },
  { key: "木綿豆腐", amount: "1/2丁", fits: "汁煮炒", label: "豆腐" },
  { key: "厚揚げ", amount: "1/2枚", fits: "炒煮汁" },
  { key: "油揚げ", amount: "2枚", fits: "汁煮飯炒" },
  { key: "高野豆腐", amount: "2枚", fits: "煮汁" },
  { key: "納豆", amount: "2パック", fits: "飯" },
  { key: "大豆", amount: "1袋", fits: "煮汁和", label: "大豆（水煮）" },
  { key: "ミックスビーンズ", amount: "1袋", fits: "和汁" },
  { key: "卵", amount: "2個", fits: "炒汁飯麺" },
  { key: "チーズ", amount: "2枚", fits: "麺卵" },
  { key: "粉チーズ", amount: "大さじ2", fits: "麺和" },
  { key: "しらす", amount: "大さじ3", fits: "飯和卵麺" },
  { key: "桜えび", amount: "大さじ2", fits: "炒飯卵麺和" },
  { key: "さば缶", amount: "1缶", fits: "麺和汁", can: true },
  { key: "あさり缶", amount: "1缶", fits: "汁麺", can: true },
  { key: "ごま", amount: "大さじ2", fits: "和炒飯麺" },
];

/** 同じ仲間の食材。レシピにどれかが入っていれば、仲間は勧めない（絹豆腐があるのに豆腐、など） */
const FAMILIES: string[][] = [
  ["木綿豆腐", "絹豆腐"],
  ["あさり", "あさり缶", "あさり（むき身）", "しじみ"],
  ["さば", "さば缶"],
  ["しいたけ", "干ししいたけ"],
  ["トマト", "トマト缶", "ミニトマト"],
  ["卵", "卵黄", "卵白", "うずら卵"],
  ["チーズ", "モッツァレラ", "クリームチーズ", "粉チーズ"],
  ["ひじき", "ひじき（戻したもの）"],
  ["大豆", "ミックスビーンズ", "小豆"],
  ["えび", "桜えび"],
  ["ピーマン", "パプリカ"],
];
const FAMILY_OF = new Map<string, string[]>();
for (const f of FAMILIES) for (const k of f) FAMILY_OF.set(k, f);

/** 栄養ごとの一言（とり方のこつ。広く知られていることだけ） */
export const NUTRIENT_TIPS: Partial<Record<NutrientId, string>> = {
  iron: "野菜や豆の鉄は、ビタミンC の多い野菜や、肉・魚と一緒だと吸収されやすくなります。",
  calcium: "ビタミンD（魚・きのこに多い）は、カルシウムの吸収を助けます。",
  vitaminA: "ビタミンA は油に溶けるので、油を使う料理と相性がよい栄養です。",
  vitaminC:
    "ビタミンC は熱と水に弱いので、加熱は短めに。汁ごと食べると逃しにくくなります。",
  vitaminB1:
    "ビタミンB1 は水に溶けやすいので、汁ごと食べると逃しにくくなります。",
};

export type Addition = {
  key: string;
  name: string;
  /** 見ている人数に合わせた量 */
  amount: string;
  /** 今の段階が分かるときだけ入る */
  before: NutrientLevel | null;
  after: NutrientLevel;
  /** 足す分だけの、1日の目安に対する割合（1人前。並べるための値） */
  gain: number;
};
export type Additions = {
  mode: AddMode;
  /** このレシピは、もうその栄養が「多い」 */
  alreadyHigh: boolean;
  /** 人数が書かれていないので、2人分として量を出した */
  servingsAssumed: boolean;
  items: Addition[];
};

/** 表の量は 2人分の料理に足す量 */
const TABLE_SERVINGS = 2;
/** 足す分が 1日の目安のこれ未満なら、足す意味が薄いので出さない */
export const ADD_MIN_GAIN = 1 / 12;
export const ADD_MAX = 5;

/**
 * このレシピに足すと、選んだ栄養が増える食材（増える順）。
 * - 料理の種類が名前から分かれば、その料理に混ぜられる物。分からなければ、添えられる物だけ
 * - すでに入っている食材と、その仲間は出さない
 * - 量は、見ている人数（showFor）に合わせて換算する。1人前の増え方は人数によらない
 */
export function suggestAdditions(
  recipe: {
    title: string;
    ingredients: NutritionIngredient[];
    servings: number | null | undefined;
  },
  id: NutrientId,
  showFor?: number | null,
): Additions {
  const now = recipeNutrition(recipe.ingredients, recipe.servings);
  const base = {
    alreadyHigh: false,
    servingsAssumed: now.servingsAssumed,
    items: [] as Addition[],
  };
  if (NOT_A_DISH.test(recipe.title) || recipe.ingredients.length === 0)
    return { ...base, mode: "none" };
  const kind = dishKind(recipe.title);
  const mode: AddMode = kind ? "mix" : "side";
  const i = NUTRIENT_IDS.indexOf(id);
  const before = now.enough ? levelOf(id, now.perServing[i]!) : null;
  if (before === "high") return { ...base, mode, alreadyHigh: true };

  const have = new Set<string>();
  for (const x of recipe.ingredients) {
    const key = foodForCanonical(canonicalName(x.name))?.key;
    if (!key) continue;
    have.add(key);
    for (const k of FAMILY_OF.get(key) ?? []) have.add(k);
  }
  const people = showFor && showFor > 0 ? showFor : now.servings;
  const all: (Addition & { can: boolean })[] = [];
  for (const a of ADDABLES) {
    if (have.has(a.key) || !a.fits.includes(kind ?? "添")) continue;
    const food = foodByKey(a.key);
    const grams = food ? gramsOf(a.amount, food) : null;
    if (!food || grams === null) continue;
    const add = (food.per100g[i]! * grams * food.edible) / 100 / TABLE_SERVINGS;
    const gain = add / NUTRIENTS[id].daily;
    if (gain < ADD_MIN_GAIN) continue;
    const after = levelOf(id, (now.enough ? now.perServing[i]! : 0) + add);
    // 今の目安が出せないレシピでは、足す分だけで「ふつう」に届く物だけ出す
    if (before === null && after === "low") continue;
    all.push({
      key: a.key,
      name: a.label ?? a.key,
      amount: scaleAmount(a.amount, people / TABLE_SERVINGS),
      before,
      after,
      gain,
      can: !!a.can,
    });
  }
  all.sort((x, y) => y.gain - x.gain);
  const items: Addition[] = [];
  let cans = 0;
  for (const { can, ...item } of all) {
    if (can && cans++ >= 1) continue;
    items.push(item);
    if (items.length >= ADD_MAX) break;
  }
  return { ...base, mode, items };
}
