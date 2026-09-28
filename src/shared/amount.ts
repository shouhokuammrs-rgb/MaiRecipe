// 分量の文字列（"大さじ1と1/2" "300g" "1/2個" "少々"）と数値の相互変換。
// 買い物リストで同じ材料を合計するために使う。読めない分量は qty=null のまま残す。

export type ParsedAmount = { qty: number | null; unit: string };

const PREFIX_UNITS = ["大さじ", "小さじ"] as const;

function toHalfWidth(s: string): string {
  return s
    .replace(/[０-９．／]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    )
    .replace(/\s+/g, "");
}

export function parseNumber(raw: string): number | null {
  const s = toHalfWidth(raw);
  let m = s.match(/^(\d+(?:\.\d+)?)と(\d+)\/(\d+)$/);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = s.match(/^(\d+)\/(\d+)$/);
  if (m) return Number(m[2]) === 0 ? null : Number(m[1]) / Number(m[2]);
  m = s.match(/^(\d+(?:\.\d+)?)$/);
  if (m) return Number(m[1]);
  return null;
}

export function parseAmount(raw: string): ParsedAmount {
  const s = toHalfWidth(raw ?? "");
  if (!s) return { qty: null, unit: "" };
  for (const u of PREFIX_UNITS) {
    if (s.startsWith(u)) {
      const n = parseNumber(s.slice(u.length));
      if (n !== null) return { qty: n, unit: u };
    }
  }
  const m = s.match(/^([\d./と]+)(.*)$/);
  if (m && m[1]) {
    const n = parseNumber(m[1]);
    if (n !== null) return { qty: n, unit: m[2] ?? "" };
  }
  return { qty: null, unit: s };
}

const FRACTIONS: [number, string][] = [
  [0.25, "1/4"],
  [1 / 3, "1/3"],
  [0.5, "1/2"],
  [2 / 3, "2/3"],
  [0.75, "3/4"],
];

export function formatNumber(x: number): string {
  const whole = Math.floor(x + 1e-9);
  const rest = x - whole;
  if (rest < 0.02) return String(whole);
  const f = FRACTIONS.find(([v]) => Math.abs(rest - v) < 0.02);
  if (!f) return String(Math.round(x * 10) / 10);
  return whole ? `${whole}と${f[1]}` : f[1];
}

export function formatAmount(a: ParsedAmount): string {
  if (a.qty === null) return a.unit;
  const n = formatNumber(a.qty);
  return (PREFIX_UNITS as readonly string[]).includes(a.unit)
    ? `${a.unit}${n}`
    : `${n}${a.unit}`;
}
