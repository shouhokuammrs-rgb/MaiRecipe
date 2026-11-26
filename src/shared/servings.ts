// 何人分か（servings）と、人数に合わせた分量の換算。AI は使わない。
// 読めない分量（少々・適量・ひとつまみ）はそのまま残す。
import { formatNumber, parseNumber } from "./amount";
import type { Ingredient } from "./recipe";

export const SERVINGS_MIN = 1;
export const SERVINGS_MAX = 20;

const inRange = (n: number) =>
  Number.isInteger(n) && n >= SERVINGS_MIN && n <= SERVINGS_MAX ? n : null;

const half = (s: string) => s.normalize("NFKC");

const KANJI: Record<string, string> = {
  一: "1",
  二: "2",
  三: "3",
  四: "4",
  五: "5",
  六: "6",
  七: "7",
  八: "8",
  九: "9",
  十: "10",
};
const K = "一二三四五六七八九十百千";
/**
 * 1 文字の漢数字（二人分・一〜二人前）を数字にする。「十二」「二十」のように並ぶものは触らない（読み違えるより読まない）。
 * 材料の見出しと recipeYield にだけ使う（文の中の「一人前の職人」「十人十色」を人数と読まないため）
 */
const kanjiDigits = (s: string) =>
  s.replace(
    new RegExp(`(?<![${K}])[一二三四五六七八九十](?![${K}])`, "g"),
    (c) => KANJI[c]!,
  );

const RANGE = String.raw`(?:(?:人|名)?\s*[〜~\-–]\s*\d+\s*)?`;
/** 文のどこにあっても人数と読める書き方（「人用」「2人」は、鍋の大きさや別の話のことがあるので入れない） */
const PEOPLE = new RegExp(
  String.raw`(\d+)\s*${RANGE}(?:人分|人前|名分|名様分)`,
);
const BARE = String.raw`(\d+)\s*${RANGE}(?:人分|人前|名分|名様分|人用|人|名)(?![気目暮あ以])`;
/** recipeYield（人数を書く欄）の中の人数 */
const PEOPLE_IN_YIELD = new RegExp(BARE);
/** 行が「材料」で始まる見出しで、そのすぐ後ろに人数がある（「【材料】（2人）」「■材料 3名」「材料2人分：」） */
const DECO = String.raw`[\s【\[■□▼▽◆◇●○・☆★#＜<〈《「『(（]*`;
const HEADING_WITH_PEOPLE = new RegExp(
  String.raw`^${DECO}材料[\s】\]＞>〉》」』)）:：/／・]*[（(\[【<＜]?\s*約?\s*${BARE}`,
);
/** 「材料」だけの見出し（次の行の人数を見てよい） */
const PURE_HEADING = new RegExp(
  String.raw`^${DECO}(?:材料|ingredients)[\s】\]＞>〉》」』)）:：]*$`,
  "i",
);
/** 人数だけが書いてある行（「（2〜3人）」「2名分」） */
const PEOPLE_ONLY_LINE = new RegExp(
  String.raw`^\s*[（(\[【<＜]?\s*約?\s*${BARE}\s*[)）\]】>＞]?\s*$`,
);
const SERVINGS_EN = /(\d+)\s*(?:(?:[〜~\-–]|to)\s*\d+\s*)?servings?\b/i;
/** recipeYield の英語（"Makes 4" "Serves 6"） */
const YIELD_EN = /(?:serves|makes)\s*(\d+)\b/i;
/** 行の頭にある英語の人数（"Serves 4" "Servings: 4" "Yield: 4 servings"） */
const LINE_EN = /^\s*(?:serves|servings|yield)\s*[:：]?\s*(\d+)\b/i;
const HEADING_EN = /^[\s#*-]*ingredients\b/i;

/** 構造化データの recipeYield（"4人前" "4 servings" 4 ["4","4人分"]）から人数。人数でなければ null */
export function parseServings(raw: unknown): number | null {
  if (Array.isArray(raw)) {
    for (const x of raw) {
      const n = parseServings(x);
      if (n) return n;
    }
    return null;
  }
  if (typeof raw === "number") return inRange(raw);
  if (typeof raw !== "string") return null;
  const s = kanjiDigits(half(raw)).trim();
  if (/^\d+$/.test(s)) return inRange(Number(s));
  // recipeYield は人数を書く欄なので、「2人」「3名」も人数として読む
  const m =
    s.match(PEOPLE_IN_YIELD) ?? s.match(SERVINGS_EN) ?? s.match(YIELD_EN);
  return m ? inRange(Number(m[1])) : null;
}

/**
 * 「材料」の見出しの行か、その次の行にある人数（「【材料】(2人分)」）。無ければ null。
 * 概要欄の「本日1人前限定」のような、材料と関係ない人数を拾わないため。
 * 「2人」「3名」「二人分」は、行が「材料」で始まり、すぐ後ろに書いてあるときだけ読む
 * （「材料費は2人で500円」「材料3つ！3人の子どもが完食」を人数と読まない）
 */
export function servingsNearIngredients(text: string): number | null {
  const lines = half(text).split(/\r?\n/);
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k]!;
    const next = lines[k + 1] ?? "";
    let m: RegExpMatchArray | null = null;
    if (/材料/.test(line)) {
      m =
        kanjiDigits(line).match(HEADING_WITH_PEOPLE) ??
        line.match(PEOPLE) ??
        next.match(PEOPLE) ??
        (PURE_HEADING.test(line)
          ? kanjiDigits(next).match(PEOPLE_ONLY_LINE)
          : null);
    } else if (HEADING_EN.test(line)) {
      m = line.match(SERVINGS_EN) ?? next.match(LINE_EN);
    }
    if (m) return inRange(Number(m[1]));
  }
  return null;
}

/** 材料の見出しの人数。無ければ文の中の最初の「2人分」「4人前」か、行の頭の "Serves 4"。どちらも無ければ null */
export function servingsFromText(text: string): number | null {
  const near = servingsNearIngredients(text);
  if (near) return near;
  const s = half(text);
  const m = s.match(PEOPLE);
  if (m) return inRange(Number(m[1]));
  for (const line of s.split(/\r?\n/)) {
    const en = line.match(LINE_EN);
    if (en) return inRange(Number(en[1]));
  }
  return null;
}

/** この人数のレシピは、元のレシピから人数を探すか。again：前に探して無かったので探し直す（DEC-039） */
export function findPlan(
  id: string,
  servings: (number | null)[],
  again: Set<string>,
): "first" | "again" | null {
  if (servings.length === 0 || servings.some((n) => (n ?? 0) > 0)) return null;
  if (servings.every((n) => n === null)) return "first";
  return again.has(id) ? null : "again";
}

const NUM = String.raw`\d+\/\d+|\d+(?:\.\d+)?(?:と\d+\/\d+)?`;
const MAIN = new RegExp(
  String.raw`^(各|約)?(大さじ|小さじ)?\s*(${NUM})(?:\s*([〜~～\-－])\s*(${NUM}))?(.*)$`,
);
const INNER = new RegExp(
  String.raw`([（(]\s*(?:約)?\s*)(${NUM})(\s*(?:g|kg|ml|mL|cc|個|本|枚|切れ)\s*[)）])`,
  "g",
);
/** 小数にしない単位（量りで量るもの） */
const WHOLE_UNIT = /^\s*(?:g|ml|mL|cc)/;

function fmt(n: number, rest: string): string {
  // g・ml は分数にしない（10以上は整数、それより少なければ小数1桁）
  if (WHOLE_UNIT.test(rest))
    return String(n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);
  return formatNumber(n);
}

function snapSpoon(x: number): number {
  const q = Math.round(x * 4) / 4;
  const t = Math.round(x * 3) / 3;
  return Math.abs(q - x) <= Math.abs(t - x) ? q : t;
}

/** 分量を倍率で換算する（"大さじ2" × 0.5 → "大さじ1"）。読めなければそのまま */
export function scaleAmount(amount: string, factor: number): string {
  if (!amount || factor === 1 || !(factor > 0)) return amount;
  // 全角の数字・記号は半角に（「大さじ 2」の空白は MAIN が読む）
  const s = amount.replace(/[０-９．／]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );
  const m = s.match(MAIN);
  if (!m) return amount;
  const [, pre = "", spoonRaw = "", a, sep, b, restRaw = ""] = m;
  const qa = parseNumber(a!);
  const qb = b ? parseNumber(b) : null;
  if (qa === null) return amount;
  let spoon = spoonRaw;
  let k = factor;
  let x = qa * k;
  // 大さじ1/2 より少なければ小さじ、小さじ3以上は大さじにする（範囲のないときだけ）
  if (!b && spoon === "大さじ" && x < 0.5) {
    spoon = "小さじ";
    k *= 3;
    x = qa * k;
  } else if (!b && spoon === "小さじ" && x >= 3) {
    spoon = "大さじ";
    k /= 3;
    x = qa * k;
  }
  // 小さじ1/4 より少ない量は計りにくいので「少々」
  if (!b && spoon === "小さじ" && x < 0.24) return "少々";
  // 大さじ・小さじは計れる量（1/4・1/3 刻み）にそろえる
  if (spoon && !b) x = snapSpoon(x);
  const rest = restRaw.replace(
    INNER,
    (_, open: string, n: string, close: string) => {
      const q = parseNumber(n);
      return q === null
        ? `${open}${n}${close}`
        : `${open}${fmt(q * factor, close)}${close}`;
    },
  );
  const range = b && qb !== null ? `${sep}${fmt(qb * k, rest)}` : "";
  return `${pre}${spoon}${fmt(x, rest)}${range}${rest}`;
}

/** 材料の分量を、元の人数 from から to 人分にする。元の人数が分からなければそのまま */
export function scaleIngredients<T extends Ingredient>(
  list: T[],
  from: number | null,
  to: number,
): T[] {
  if (!from || from === to) return list;
  const f = to / from;
  return list.map((i) => ({ ...i, amount: scaleAmount(i.amount, f) }));
}
