// メモから、レシピの変更案を AI に出してもらう（#23 / DEC-027）。
// ここは純粋な部分（頼む文を作る・返事を確かめる・選んだ変更を入れる）。AI を呼ぶのは src/api/ai/ だけ。
// 変更案ごとに「メモのどの言葉から出たか」を付けさせ、その言葉が本当にメモにあるかをここで確かめる。
// 無ければ「AI の推測」として分けて見せる（出典の照合）。保存は、人が選んで確かめてから
import { z } from "zod";
import { LIMITS } from "./constants";
import type { Ingredient } from "./recipe";
import { TIP_MAX, TIPS_MAX, type Tip } from "./tips";

export type MemoRecipe = {
  title: string;
  servings: number | null;
  ingredients: Ingredient[];
  steps: string[];
  tips: Tip[];
  /** 手順ごとの動画の場面（あれば、手順を足し引きしてもずれないようにそろえる） */
  stepTimes?: (number | null)[];
};

export type MemoChange = (
  | {
      kind: "ingredient";
      action: "update";
      /** 元のレシピでの番号（1始まり） */
      index: number;
      name: string;
      amount: string;
    }
  | { kind: "ingredient"; action: "remove"; index: number }
  | { kind: "ingredient"; action: "add"; name: string; amount: string }
  | { kind: "step"; action: "update"; index: number; text: string }
  | { kind: "step"; action: "remove"; index: number }
  /** after：元のレシピのこの番号の手順の後に入れる（0 は先頭・null は最後） */
  | { kind: "step"; action: "add"; after: number | null; text: string }
  | { kind: "tip"; action: "add"; step: number | null; text: string }
) & {
  /** なぜそうするか（短く） */
  reason: string;
  /** メモの中の、もとになった言葉（メモに無ければ空） */
  quote: string;
  /** quote が本当にメモにあるか。false は AI の推測 */
  grounded: boolean;
};

export function buildMemoPrompt(recipe: MemoRecipe, memo: string) {
  const system = [
    "あなたは、作った人のメモをもとにレシピを直す手伝いをします。",
    "メモに書いてあることを、材料・手順・コツの具体的な変更に置きかえてください。",
    "必ず次の JSON だけを返す（前後に説明や ``` を付けない）：",
    '{"changes":[{"kind":"ingredient","action":"update","index":2,"name":"砂糖","amount":"大さじ1","reason":"なぜ（短く）","quote":"メモの中の、もとになった言葉をそのまま"}]}',
    "kind と action の組み合わせ：",
    '- 材料を変える {"kind":"ingredient","action":"update","index":番号,"name":"…","amount":"…"}',
    '- 材料を消す {"kind":"ingredient","action":"remove","index":番号}',
    '- 材料を足す {"kind":"ingredient","action":"add","name":"…","amount":"…"}',
    '- 手順を変える {"kind":"step","action":"update","index":番号,"text":"…"}',
    '- 手順を消す {"kind":"step","action":"remove","index":番号}',
    '- 手順を足す {"kind":"step","action":"add","after":この番号の手順の後（先頭は0、最後なら null）,"text":"…"}',
    '- コツを足す {"kind":"tip","action":"add","step":手順の番号か null,"text":"…"}',
    "決まり：",
    "- 番号は、下の今のレシピの番号（1始まり）",
    "- メモに書いてあることだけを変更にする。メモに無いことを足すときは quote を空にする",
    "- quote はメモの文をそのまま短く抜き出す（言いかえない）",
    "- 分量は「大さじ1」「200g」のように今の書き方にそろえる",
    "- 変える必要が無ければ changes を空の配列にする",
  ].join("\n");
  const user = [
    `料理：${recipe.title}${recipe.servings ? `（${recipe.servings}人分）` : ""}`,
    "材料：",
    ...recipe.ingredients.map((i, k) =>
      `${k + 1}. ${i.name} ${i.amount}`.trim(),
    ),
    "作り方：",
    ...recipe.steps.map((s, k) => `${k + 1}. ${s}`),
    ...(recipe.tips.length
      ? [
          "コツ：",
          ...recipe.tips.map(
            (t) => `- ${t.step ? `手順${t.step}：` : ""}${t.text}`,
          ),
        ]
      : []),
    "",
    "--- 作った人のメモ ---",
    memo,
  ].join("\n");
  return { system, user };
}

const str = (max: number) =>
  z
    .unknown()
    .transform((v) =>
      typeof v === "string" || typeof v === "number"
        ? String(v).replace(/\s+/g, " ").trim().slice(0, max)
        : "",
    );
const num = z
  .unknown()
  .transform((v) =>
    typeof v === "number" && Number.isInteger(v)
      ? v
      : typeof v === "string" && /^\d+$/.test(v.trim())
        ? Number(v)
        : null,
  );

const rawChange = z.object({
  kind: z.string(),
  action: z.string(),
  index: num.optional(),
  after: num.optional(),
  step: num.optional(),
  name: str(LIMITS.ingredientNameMax).optional(),
  amount: str(LIMITS.amountMax).optional(),
  text: str(LIMITS.stepMax).optional(),
  reason: str(80).optional(),
  quote: str(80).optional(),
});

/** 句読点・空白・記号の違いは無視してメモと照らし合わせる */
const squash = (s: string) =>
  s.normalize("NFKC").replace(/[\s、。・,.!?！？「」『』（）()]/g, "");

const MAX_CHANGES = 15;

/** メモの言葉とみなす最短の長さ（「。」や1文字はどのメモにもあるので数えない） */
const QUOTE_MIN = 2;

/**
 * AI の返事を確かめて、使える変更案だけにする。
 * 返事が読めなければ null（「案が無い」の空の配列と分ける）
 */
export function parseMemoChanges(
  raw: string,
  recipe: MemoRecipe,
  memo: string,
): MemoChange[] | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  const list = (json as { changes?: unknown })?.changes;
  if (!Array.isArray(list)) return null;
  /** 同じ材料・手順への2つ目以降の「変える・消す」は使わない（どちらが効くか分からなくなる） */
  const touched = new Set<string>();
  const memoKey = squash(memo);
  const nIng = recipe.ingredients.length;
  const nStep = recipe.steps.length;
  const inRange = (n: number | null | undefined, max: number) =>
    n !== null && n !== undefined && n >= 1 && n <= max;
  const out: MemoChange[] = [];
  for (const item of list) {
    const p = rawChange.safeParse(item);
    if (!p.success) continue;
    const c = p.data;
    const quote = c.quote ?? "";
    const q = squash(quote);
    const grounded = q.length >= QUOTE_MIN && memoKey.includes(q);
    const meta = {
      reason: c.reason ?? "",
      quote: grounded ? quote : "",
      grounded,
    };
    let change: MemoChange | null = null;
    if (c.kind === "ingredient") {
      if (c.action === "update" && inRange(c.index, nIng) && c.name) {
        const before = recipe.ingredients[c.index! - 1]!;
        const amount = c.amount ?? before.amount;
        if (before.name !== c.name || before.amount !== amount)
          change = {
            kind: "ingredient",
            action: "update",
            index: c.index!,
            name: c.name,
            amount,
            ...meta,
          };
      } else if (c.action === "remove" && inRange(c.index, nIng))
        change = {
          kind: "ingredient",
          action: "remove",
          index: c.index!,
          ...meta,
        };
      else if (c.action === "add" && c.name)
        change = {
          kind: "ingredient",
          action: "add",
          name: c.name,
          amount: c.amount ?? "",
          ...meta,
        };
    } else if (c.kind === "step") {
      if (c.action === "update" && inRange(c.index, nStep) && c.text) {
        if (recipe.steps[c.index! - 1] !== c.text)
          change = {
            kind: "step",
            action: "update",
            index: c.index!,
            text: c.text,
            ...meta,
          };
      } else if (c.action === "remove" && inRange(c.index, nStep))
        change = { kind: "step", action: "remove", index: c.index!, ...meta };
      else if (c.action === "add" && c.text) {
        // 範囲外の番号は、どこに入れたいのか分からないので使わない
        if (c.after === null || c.after === undefined)
          change = {
            kind: "step",
            action: "add",
            after: null,
            text: c.text,
            ...meta,
          };
        else if (c.after === 0 || inRange(c.after, nStep))
          change = {
            kind: "step",
            action: "add",
            after: c.after,
            text: c.text,
            ...meta,
          };
      }
    } else if (c.kind === "tip" && c.action === "add" && c.text) {
      change = {
        kind: "tip",
        action: "add",
        step: inRange(c.step, nStep) ? c.step! : null,
        text: c.text.slice(0, TIP_MAX),
        ...meta,
      };
    }
    if (change && (change.action === "update" || change.action === "remove")) {
      const key = `${change.kind}:${(change as { index: number }).index}`;
      if (touched.has(key)) change = null;
      else touched.add(key);
    }
    if (change) out.push(change);
    if (out.length >= MAX_CHANGES) break;
  }
  return out;
}

/** 選んだ変更を、今のレシピに入れる（番号は元のレシピの番号で読む） */
export function applyMemoChanges(
  recipe: MemoRecipe,
  changes: MemoChange[],
): MemoRecipe {
  if (!changes.length) return recipe;
  // 材料
  const ings: (Ingredient | null)[] = recipe.ingredients.map((i) => ({ ...i }));
  const addedIngs: Ingredient[] = [];
  for (const c of changes) {
    if (c.kind !== "ingredient") continue;
    if (c.action === "update" && ings[c.index - 1])
      ings[c.index - 1] = { name: c.name, amount: c.amount };
    else if (c.action === "remove") ings[c.index - 1] = null;
    else if (c.action === "add")
      addedIngs.push({ name: c.name, amount: c.amount });
  }
  // 手順：元の番号を持ったまま並べ、最後に新しい番号を振る
  type Row = { orig: number | null; text: string };
  const rows: (Row | null)[] = recipe.steps.map((text, k) => ({
    orig: k + 1,
    text,
  }));
  const inserts = new Map<number | "end", string[]>();
  for (const c of changes) {
    if (c.kind !== "step") continue;
    if (c.action === "update" && rows[c.index - 1])
      rows[c.index - 1] = { orig: c.index, text: c.text };
    else if (c.action === "remove") rows[c.index - 1] = null;
    else if (c.action === "add") {
      const key = c.after ?? "end";
      inserts.set(key, [...(inserts.get(key) ?? []), c.text]);
    }
  }
  const ordered: Row[] = [];
  for (const t of inserts.get(0) ?? []) ordered.push({ orig: null, text: t });
  rows.forEach((r, k) => {
    if (r) ordered.push(r);
    for (const t of inserts.get(k + 1) ?? [])
      ordered.push({ orig: null, text: t });
  });
  for (const t of inserts.get("end") ?? [])
    ordered.push({ orig: null, text: t });
  /** 元の手順の番号 → 新しい番号（消えた手順は null） */
  const renumber = (orig: number | null): number | null => {
    if (orig === null) return null;
    const at = ordered.findIndex((r) => r.orig === orig);
    return at >= 0 ? at + 1 : null;
  };
  const tips: Tip[] = (
    [
      ...recipe.tips.map((t) => ({ ...t, step: renumber(t.step) })),
      ...changes
        .filter((c) => c.kind === "tip")
        .map((c) => ({
          step: renumber((c as { step: number | null }).step),
          text: (c as { text: string }).text,
        })),
    ] as Tip[]
  ).slice(0, TIPS_MAX);
  // 保存できる件数を超えないように（超えた分は入れない）
  const keptRows = ordered.slice(0, LIMITS.stepsMax);
  return {
    ...recipe,
    ingredients: [
      ...ings.filter((i): i is Ingredient => i !== null),
      ...addedIngs,
    ].slice(0, LIMITS.ingredientsMax),
    steps: keptRows.map((r) => r.text),
    ...(recipe.stepTimes?.length === recipe.steps.length
      ? {
          stepTimes: keptRows.map((r) =>
            r.orig ? (recipe.stepTimes![r.orig - 1] ?? null) : null,
          ),
        }
      : {}),
    tips,
  };
}
