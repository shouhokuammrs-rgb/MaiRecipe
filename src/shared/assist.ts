// お料理アシスタントの、画面にも AI の会社にも依存しない部分。
// ・その場ですぐ動く言葉（次・戻って・タイマー…）を見分ける
// ・「ねえ」から始まる相談を見分ける
// ・計量の換算は AI を使わずに計算で答える（間違えないように）
// ・AI への頼み方を作り、返事を読む（AI を呼ぶのは src/api/ai/ だけ）
import { z } from "zod";
import { findTimers, voiceCommand, type CookTimer } from "./cook";

const toHalf = (s: string) =>
  s.replace(/[０-９．／]/g, (d) =>
    String.fromCharCode(d.charCodeAt(0) - 0xfee0),
  );

/** 聞き取った言葉をそろえる（空白・句読点・前後の「オッケー」「ください」を落とす） */
function normalize(text: string): string {
  return toHalf(text)
    .replace(/[\s。、！!？?]/g, "")
    .replace(/^(?:オッケー|OK|ok|はい|えっと|じゃあ)+/, "")
    .replace(/(?:ください|お願いします|お願い)$/, "");
}

export type QuickAction =
  | { kind: "next" | "prev"; read: boolean }
  | { kind: "repeat" | "ingredients" }
  | { kind: "timer"; timer?: CookTimer }
  | { kind: "goto"; step: number };

/** その場ですぐ動く短い言葉。文や会話・相談なら null（「次に肉を焼く」では動かない） */
export function parseQuick(text: string): QuickAction | null {
  const t = normalize(text);
  if (!t) return null;

  const read = t.match(
    /^(次|つぎ|次の手順|前|まえ|前の手順)を?(?:読んで|よんで)$/,
  );
  if (read)
    return { kind: /^(次|つぎ)/.test(read[1]!) ? "next" : "prev", read: true };

  const goto =
    t.match(
      /^(?:手順|ステップ)(\d{1,2})(?:に(?:行って|進んで|戻って|して))?$/,
    ) ?? t.match(/^(\d{1,2})番目(?:の手順)?(?:に(?:行って|進んで|戻って))?$/);
  if (goto) return { kind: "goto", step: Number(goto[1]) };

  if (t.includes("タイマー")) {
    // 「5分のタイマー」の「の」は「3分の1」と違って時間なので、外してから読む
    const u = t.replace(/の(?=タイマー)/, "");
    const timer = findTimers(u)[0];
    const rest = timer ? u.replace(timer.label, "") : u;
    if (
      /^タイマーを?(?:かけて|セットして|セット|スタート|開始|して)?$/.test(rest)
    )
      return timer ? { kind: "timer", timer } : { kind: "timer" };
    return null;
  }

  const cmd = voiceCommand(t);
  if (cmd === "next" || cmd === "prev") return { kind: cmd, read: false };
  if (cmd === "repeat" || cmd === "ingredients") return { kind: cmd };
  if (cmd === "timer") return { kind: "timer" };
  return null;
}

/** 「ねえ、〜」「アシスタント、〜」で始まる言葉なら、呼びかけを外した質問を返す */
export function wakeQuestion(text: string): string | null {
  const m = text
    .trim()
    .match(/^(?:ねえ|ねぇ|ねー|ネエ|ネェ|ヘイ|アシスタント)[、,，\s]*(.*)$/s);
  if (!m) return null;
  const q = m[1]!.trim();
  return q.length >= 2 ? q : null;
}

// ---- 計量の換算（大さじ15ml・小さじ5ml・1カップ200ml） ----

type Unit = "大さじ" | "小さじ" | "カップ" | "ml";
const ML: Record<Unit, number> = { 大さじ: 15, 小さじ: 5, カップ: 200, ml: 1 };
const KANJI: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};
// 分数を先に試す（「1/2」を「1」と読まないように）
const AMOUNT =
  "(\\d+と\\d+/\\d+|\\d+/\\d+|\\d+(?:\\.\\d+)?|[一二三四五六七八九十]|半分|半)";

function amountOf(s: string): number | null {
  if (s === "半分" || s === "半") return 0.5;
  if (KANJI[s]) return KANJI[s]!;
  const mixed = s.match(/^(\d+)と(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** 0.5 → 1/2、13.33 → 13と1/3。きれいな分数にならなければ小数1桁 */
function friendly(v: number): string {
  const whole = Math.floor(v + 1e-9);
  const rest = v - whole;
  if (rest < 0.01) return String(whole);
  for (const [f, label] of [
    [1 / 4, "1/4"],
    [1 / 3, "1/3"],
    [1 / 2, "1/2"],
    [2 / 3, "2/3"],
    [3 / 4, "3/4"],
  ] as const)
    if (Math.abs(rest - f) < 0.01) return whole ? `${whole}と${label}` : label;
  return String(Math.round(v * 10) / 10);
}

const mlText = (v: number) => `${Math.round(v * 10) / 10}ml`;
const unitLabel = (u: Unit, n: number) =>
  u === "ml"
    ? mlText(n)
    : u === "カップ"
      ? `${friendly(n)}カップ`
      : `${u}${friendly(n)}`;

const UNITS: Unit[] = ["大さじ", "小さじ", "カップ", "ml"];
const ASK = /何|いくつ|どのくらい|どれくらい|どれだけ/;

/** 質問の中の量（大さじ1・1/2カップ・50ml…）を全部拾う */
function quantities(q: string) {
  const res = [
    new RegExp(`(大さじ|小さじ|カップ)${AMOUNT}`, "g"),
    new RegExp(`${AMOUNT}(カップ|ml)`, "g"),
  ];
  const found: { unit: Unit; amount: number; start: number; end: number }[] =
    [];
  for (const re of res)
    for (const m of q.matchAll(re)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      // 同じところを2回数えない（「カップ1」と「1カップ」が重なるとき）
      if (found.some((f) => start < f.end && end > f.start)) continue;
      const unitFirst = (UNITS as string[]).includes(m[1]!);
      const unit = (unitFirst ? m[1] : m[2]) as Unit;
      const amount = amountOf((unitFirst ? m[2] : m[1])!);
      if (amount != null && amount > 0)
        found.push({ unit, amount, start, end });
    }
  return found;
}

/**
 * 「大さじ1って小さじ何杯？」「50mlは大さじ何杯？」に計算で答える。
 * 重さ（g）・量が2つ以上ある・換算を聞いていない質問は null（AI に任せる）
 */
export function measureAnswer(question: string): string | null {
  const q = toHalf(question)
    .replace(/\s/g, "")
    .replace(/cc|ミリリットル|ミリ/g, "ml")
    .replace(/(\d)杯半/g, "$1と1/2")
    .replace(/(\d)と半分?(?![0-9])/g, "$1と1/2");
  if (/グラム|\d+g|何g/.test(q)) return null;
  if (!ASK.test(q)) return null;

  const found = quantities(q);
  if (found.length !== 1) return null;
  const { unit, amount, end } = found[0]!;

  // 聞かれた単位：「何ml」のように問いの直後、なければ「小さじ何杯」のように問いの直前
  const after = q.slice(end);
  const ai = after.search(ASK);
  if (ai < 0) return null;
  const right = after.slice(ai).replace(ASK, "");
  const left = after.slice(0, ai);
  const target =
    UNITS.find((u) => u !== unit && right.startsWith(u)) ??
    UNITS.filter((u) => u !== unit && left.includes(u)).sort(
      (a, b) => left.lastIndexOf(b) - left.lastIndexOf(a),
    )[0];
  if (!target) return null;

  const ml = amount * ML[unit];
  const from = unitLabel(unit, amount);
  if (target === "ml") return `${from}は${mlText(ml)}です。`;
  const n = ml / ML[target];
  const to =
    target === "カップ"
      ? `カップ${friendly(n)}杯`
      : `${target}${friendly(n)}杯`;
  return unit === "ml"
    ? `${from}は${to}です。`
    : `${from}は${to}です（${mlText(ml)}）。`;
}

// ---- AI への頼み方と返事 ----

export const assistInputSchema = z.object({
  recipeId: z.string().min(1).max(100),
  versionId: z.string().max(100).optional(),
  stepIndex: z.number().int().min(0).max(200),
  question: z.string().trim().min(1).max(300),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string().max(600),
      }),
    )
    .max(6)
    .default([]),
});
export type AssistInput = z.infer<typeof assistInputSchema>;

export function buildAssistPrompt(p: {
  title: string;
  ingredients: { name: string; amount: string }[];
  steps: string[];
  stepIndex: number;
  history: { role: "user" | "assistant"; text: string }[];
  question: string;
}) {
  const system = [
    "あなたは台所で一緒に料理をしている、頼れるお料理アシスタントです。",
    "相手は料理の途中で、手がふさがっています。答えは声で読み上げられます。",
    "決まり：",
    "- 2〜3文までの短い話し言葉で答える。箇条書き・記号・絵文字は使わない",
    "- 今のレシピと今の手順を踏まえて、具体的に答える（代わりの材料・分量の変え方・火加減・失敗したときの直し方など）",
    "- 分からないこと・自信がないことは、そう言う。食中毒など安全に関わることは、安全なほうを勧める",
    "- 料理と関係ない話には、短く答えてから料理に戻す",
    "- 相手が「タイマーをかけて」「手順3に行って」のように頼んだときだけ action を付ける。ほかは null",
    "必ず次の JSON だけを返す（前後に説明や ``` を付けない）：",
    '{"answer":"読み上げる答え","action":null}',
    'action の形：{"type":"timer","seconds":180,"label":"3分"} または {"type":"step","number":3}',
  ].join("\n");
  const n = p.steps.length;
  const cur = p.steps[p.stepIndex];
  const user = [
    `料理：${p.title}`,
    "材料（2人分）：",
    ...p.ingredients.map((i) => `- ${i.name} ${i.amount}`.trim()),
    "作り方：",
    ...p.steps.map((s, k) => `${k + 1}. ${s}`),
    cur ? `今の手順：${p.stepIndex + 1}. ${cur}（全${n}手順）` : "",
    p.history.length ? "直前のやりとり：" : "",
    ...p.history.map(
      (h) => `${h.role === "user" ? "相手" : "あなた"}：${h.text}`,
    ),
    `相手の質問：${p.question}`,
  ]
    .filter(Boolean)
    .join("\n");
  return { system, user };
}

const actionSchema = z.union([
  z.object({
    type: z.literal("timer"),
    seconds: z
      .number()
      .int()
      .min(1)
      .max(24 * 3600),
    label: z.string().max(20).optional(),
  }),
  z.object({
    type: z.literal("step"),
    number: z.number().int().min(1).max(200),
  }),
]);
export type AssistAction = z.infer<typeof actionSchema>;
export type AssistReply = { answer: string; action: AssistAction | null };

const clean = (s: string) =>
  s
    .replace(/```(?:json)?/g, "")
    .trim()
    .slice(0, 400);

/** AI の返事を読む。JSON でなければ文をそのまま答えにする。空なら null */
export function parseAssistReply(raw: string): AssistReply | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const j = JSON.parse(raw.slice(start, end + 1)) as {
        answer?: unknown;
        action?: unknown;
      };
      if (typeof j.answer === "string" && j.answer.trim()) {
        const a = actionSchema.safeParse(j.action);
        const action = a.success
          ? a.data.type === "timer"
            ? {
                ...a.data,
                label: a.data.label ?? `${Math.round(a.data.seconds / 60)}分`,
              }
            : a.data
          : null;
        return { answer: clean(j.answer), action };
      }
    } catch {
      // JSON でなければ下で文として扱う
    }
  }
  const text = clean(raw);
  // 途中で切れた JSON（「{"answer":"火を弱めて」）は読み上げない
  if (!text || text.startsWith("{") || text.includes('"answer"')) return null;
  return { answer: text, action: null };
}
