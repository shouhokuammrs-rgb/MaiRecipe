// 何人分か（servings）と、人数に合わせた分量の換算。AI は使わない。
// 読めない分量（少々・適量・ひとつまみ）はそのまま残す。
import { formatNumber, parseNumber } from "./amount";
import type { Ingredient } from "./recipe";

export const SERVINGS_MIN = 1;
export const SERVINGS_MAX = 20;

const inRange = (n: number) =>
  Number.isInteger(n) && n >= SERVINGS_MIN && n <= SERVINGS_MAX ? n : null;

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
/** 全角を半角に、人数の漢数字（二人分・一人前）を数字にそろえる */
const half = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[一二三四五六七八九十](?=\s*(?:人|名))/g, (c) => KANJI[c]!);

const RANGE = String.raw`(?:[〜~\-–]\s*\d+\s*)?`;
/** 文のどこにあっても人数と読める書き方 */
const PEOPLE = new RegExp(
  String.raw`(\d+)\s*${RANGE}(?:人分|人前|名分|名様分|人用)`,
);
/** 材料の見出しのそばでだけ人数と読む書き方（「材料（2人）」「材料 3名」） */
const PEOPLE_AT_HEADING = new RegExp(
  String.raw`(\d+)\s*${RANGE}(?:人分|人前|名分|名様分|人用|人|名)(?![気目])`,
);
const SERVINGS_EN =
  /(\d+)\s*(?:(?:[〜~\-–]|to)\s*\d+\s*)?servings?\b|(?:serves|makes)\s*(\d+)\b/i;

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
  const s = half(raw).trim();
  if (/^\d+$/.test(s)) return inRange(Number(s));
  // recipeYield は人数を書く欄なので、「2人」「3名」も人数として読む
  const m = s.match(PEOPLE_AT_HEADING) ?? s.match(SERVINGS_EN);
  return m ? inRange(Number(m[1] ?? m[2])) : null;
}

/**
 * 「材料」の見出しの行か、その次の行にある人数（「【材料】(2人分)」）。無ければ null。
 * 概要欄の「本日1人前限定」のような、材料と関係ない人数を拾わないため
 */
export function servingsNearIngredients(text: string): number | null {
  const lines = half(text).split(/\r?\n/);
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k]!;
    if (!/材料|ingredients/i.test(line)) continue;
    // 見出しらしい短い行だけ（「材料の選び方を 3人の名人が…」のような文は見ない）
    if (line.length > 30) continue;
    const next = lines[k + 1] ?? "";
    const m =
      line.match(PEOPLE_AT_HEADING) ??
      line.match(SERVINGS_EN) ??
      // 次の行は、人数だけが書いてある行（「（2〜3人）」）に限る
      (next.length <= 12
        ? (next.match(PEOPLE_AT_HEADING) ?? next.match(SERVINGS_EN))
        : next.match(PEOPLE));
    if (m) return inRange(Number(m[1] ?? m[2]));
  }
  return null;
}

/** 材料の見出しの人数。無ければ文の中の最初の「2人分」「4人前」「4 servings」。どちらも無ければ null */
export function servingsFromText(text: string): number | null {
  const near = servingsNearIngredients(text);
  if (near) return near;
  const s = half(text);
  const m = s.match(PEOPLE) ?? s.match(SERVINGS_EN);
  return m ? inRange(Number(m[1] ?? m[2])) : null;
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
