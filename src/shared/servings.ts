// 何人分か（servings）と、人数に合わせた分量の換算。AI は使わない。
// 読めない分量（少々・適量・ひとつまみ）はそのまま残す。
import { formatNumber, parseNumber } from "./amount";
import type { Ingredient } from "./recipe";

export const SERVINGS_MIN = 1;
export const SERVINGS_MAX = 20;

const inRange = (n: number) =>
  Number.isInteger(n) && n >= SERVINGS_MIN && n <= SERVINGS_MAX ? n : null;

const half = (s: string) => s.normalize("NFKC");

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
  const m =
    s.match(/(\d+)\s*(?:[〜~\-–]\s*\d+\s*)?(?:人分|人前|名分|人)/) ??
    s.match(/(\d+)\s*(?:[〜~\-–]\s*\d+\s*)?servings?/i) ??
    s.match(/serves\s*(\d+)/i);
  return m ? inRange(Number(m[1])) : null;
}

/** 文の中の最初の「2人分」「4人前」から人数（概要欄・材料の見出し）。無ければ null */
export function servingsFromText(text: string): number | null {
  const m = half(text).match(/(\d+)\s*(?:[〜~\-–]\s*\d+\s*)?(?:人分|人前)/);
  return m ? inRange(Number(m[1])) : null;
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
  if (WHOLE_UNIT.test(rest) && n >= 10) return String(Math.round(n));
  return formatNumber(n);
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
