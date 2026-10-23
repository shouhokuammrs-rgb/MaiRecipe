// コツ・ポイント（DEC-024）。手順とは別に持ち、料理モードではその手順のところに出す。
// 出典の文をそのまま持つことがあるので、自分たち（グループ）だけが見るメモとして扱い、公開はしない。
import { z } from "zod";

export const TIPS_MAX = 8;
export const TIP_MAX = 150;

export type Tip = {
  /** どの手順のコツか（1始まり）。全体のコツは null */
  step: number | null;
  text: string;
};

export const tipSchema = z.object({
  step: z.number().int().min(1).max(200).nullable(),
  text: z.string().trim().min(1).max(TIP_MAX),
});
export const tipsSchema = z.array(tipSchema).max(TIPS_MAX);

const BULLET = /^[・･\-－*＊●○◆◇■□▼▽★☆✅>＞※]+\s*/u;
const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";

const clip = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, TIP_MAX);

/** 文の中で指している手順（「手順3」「工程3」「3で」「③の」）。手順の数の範囲だけ */
function stepIn(text: string, stepCount: number): number | null {
  const s = text.normalize("NFKC");
  let n: number | null = null;
  const m = s.match(/(?:手順|工程|ステップ|STEP)\s*(\d{1,2})/i);
  if (m) n = Number(m[1]);
  else {
    const c = [...text].find((ch) => CIRCLED.includes(ch));
    if (c) n = CIRCLED.indexOf(c) + 1;
  }
  return n && n >= 1 && n <= stepCount ? n : null;
}

/** ページのコツ・ポイント欄の文から（行ごとに1つ） */
export function tipsFromText(text: string, stepCount = 0): Tip[] {
  return text
    .split(/\r?\n/)
    .map((l) => clip(l.replace(BULLET, "")))
    .filter(Boolean)
    .slice(0, TIPS_MAX)
    .map((t) => ({ step: stepIn(t, stepCount), text: t }));
}

/** AI の返事の tips（[{step, text}] か 文の配列）を読む。読めないものは捨てる */
export function parseAiTips(raw: unknown, stepCount: number): Tip[] {
  if (!Array.isArray(raw)) return [];
  const out: Tip[] = [];
  for (const x of raw) {
    const obj =
      typeof x === "string"
        ? { step: null, text: x }
        : x && typeof x === "object"
          ? (x as { step?: unknown; text?: unknown })
          : null;
    if (!obj || typeof obj.text !== "string") continue;
    const text = clip(obj.text);
    if (!text) continue;
    const n = Number(obj.step);
    const step =
      obj.step !== null && Number.isInteger(n) && n >= 1 && n <= stepCount
        ? n
        : null;
    out.push({ step, text });
    if (out.length >= TIPS_MAX) break;
  }
  return out;
}

/** その手順（1始まり）のコツ。null で全体のコツ */
export function tipsForStep(tips: Tip[], step: number | null): string[] {
  return tips.filter((t) => t.step === step).map((t) => t.text);
}
