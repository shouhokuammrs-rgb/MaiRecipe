// 「AI で読み取る」の純粋な部分（プロンプトを作る・返事を読む・元の文と照らし合わせる）。
// AI を呼ぶのは src/api/ai/ だけ。ここは Cloudflare にも AI の会社にも依存しない。
// DEC-012：押した時だけ動く。DEC-011：保存するのは材料と手順だけ。
import { z } from "zod";
import { LIMITS } from "./constants";
import { normalizeGroups } from "./groups";
import { aliasesOf } from "./ingredients";
import type { Ingredient } from "./recipe";

/** AI に渡す元の文の上限（文字）。無料枠を守るため長すぎる文は切る */
export const AI_SOURCE_MAX = 8000;

export const aiReadSchema = z
  .object({
    url: z.string().trim().url().max(2000).optional(),
    text: z.string().trim().min(1).max(20_000).optional(),
    title: z.string().trim().max(200).optional(),
  })
  .refine((v) => v.url || v.text, { message: "URL か文章を入れてください" });
export type AiReadInput = z.infer<typeof aiReadSchema>;

export function buildReadPrompt(source: string, title: string) {
  const system = [
    "あなたは料理レシピの文章から、材料と作り方だけを取り出す係です。",
    "必ず次の JSON だけを返してください。前後に説明や ``` を付けないでください。",
    '{"title":"料理名","ingredients":[{"name":"材料名","amount":"分量"}],"steps":["手順1","手順2"],"time":"調理時間（分かれば。例：20分）"}',
    "決まり：",
    "- 文章に書いてある材料と手順だけを使う。書いていない材料・分量・手順を想像で足さない",
    "- 分量が書いていなければ amount は空文字にする",
    '- 材料が「A」「B」「★」「タレ」などのまとまりに分かれているときは、材料名の頭に【A】のように付ける（例：{"name":"【A】しょうゆ","amount":"大さじ1"}）。手順の「Aを加える」はそのまま書く',
    "- 手順は短い文に分け、番号は付けない",
    "- 宣伝・リンク・あいさつ・チャプター（00:00 など）は無視する",
    "- 料理が複数あるときは、いちばん主な料理を1つだけ取り出す",
    "- レシピが見つからなければ ingredients と steps を空の配列にする",
  ].join("\n");
  const user = `料理名の手がかり：${title || "（なし）"}\n\n--- 文章 ---\n${source.slice(0, AI_SOURCE_MAX)}`;
  return { system, user };
}

/**
 * 動画を見て読むときの指示（Gemini に動画と一緒に渡す）。
 * 概要欄があれば手がかりとして添える（材料と分量は概要欄の方が正確なことが多い）
 */
export function buildVideoPrompt(title: string, description: string): string {
  return [
    "この料理動画を見て、材料と作り方を取り出してください。",
    "必ず次の JSON だけを返してください。前後に説明や ``` を付けないでください。",
    '{"title":"料理名","ingredients":[{"name":"材料名","amount":"分量"}],"steps":["手順1","手順2"],"time":"調理時間（分かれば。例：20分）"}',
    "決まり：",
    "- 動画の中で実際に話している・映っている・字幕に出ている内容だけを使う。想像で足さない",
    "- 手順は動画の順に、短い文に分ける。番号は付けない。火加減・時間・目安（「きつね色になるまで」など）は残す",
    "- 材料名と分量は、概要欄に書いてあればそれを使う（投稿者が書いた正確な値）。手順は動画から取る",
    "- 分量が分からなければ amount は空文字にする",
    '- 材料が「A」「B」「★」「タレ」などのまとまりに分かれているときは、材料名の頭に【A】のように付ける（例：{"name":"【A】しょうゆ","amount":"大さじ1"}）。手順の「Aを加える」はそのまま書く',
    "- 宣伝・あいさつ・雑談は無視する",
    "- 料理が複数あるときは、いちばん主な料理を1つだけ取り出す",
    "- レシピの動画でなければ ingredients と steps を空の配列にする",
    "",
    `料理名の手がかり：${title || "（なし）"}`,
    description
      ? `--- 概要欄（参考） ---\n${description.slice(0, AI_SOURCE_MAX)}`
      : "",
  ]
    .filter((l, i, a) => l || a[i - 1])
    .join("\n");
}

const aiRecipeSchema = z.object({
  title: z.string().optional().default(""),
  ingredients: z
    .array(
      z.object({
        name: z.string(),
        amount: z.union([z.string(), z.number()]).optional().default(""),
      }),
    )
    .default([]),
  steps: z
    .array(z.union([z.string(), z.object({ text: z.string() })]))
    .default([]),
  time: z.string().optional().default(""),
});

export type AiRecipe = {
  title: string;
  ingredients: Ingredient[];
  steps: string[];
  timeLabel: string;
};

/** AI の返事から最初の JSON オブジェクトを取り出して読む。読めなければ null */
export function parseAiRecipe(raw: string): AiRecipe | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  const r = aiRecipeSchema.safeParse(json);
  if (!r.success) return null;
  const clip = (s: string, n: number) =>
    s.replace(/\s+/g, " ").trim().slice(0, n);
  const ingredients = r.data.ingredients
    .map((i) => ({
      name: clip(i.name, LIMITS.ingredientNameMax),
      amount: clip(String(i.amount ?? ""), LIMITS.amountMax),
    }))
    .filter((i) => i.name)
    .slice(0, LIMITS.ingredientsMax);
  const steps = r.data.steps
    .map((s) => clip(typeof s === "string" ? s : s.text, LIMITS.stepMax))
    .map((s) => s.replace(/^(\d+|[①-⑳])[.)．、\s]*/u, ""))
    .filter(Boolean)
    .slice(0, LIMITS.stepsMax);
  if (!ingredients.length && !steps.length) return null;
  return {
    title: clip(r.data.title, LIMITS.titleMax),
    // (A)・★ などの書き方の揺れも【A】にそろえる
    ingredients: normalizeGroups(ingredients),
    steps,
    timeLabel: clip(r.data.time, 20),
  };
}

const squash = (s: string) =>
  s.normalize("NFKC").replace(/[\s・、,（）()「」『』【】[\]]/g, "");

/**
 * 材料名が元の文に本当にあるか照らし合わせる（AI の想像で足された材料を見つける）。
 * 消さずに名前を返し、画面で「要確認」として知らせる
 */
export function findUnverified(
  ingredients: Ingredient[],
  source: string,
): string[] {
  const src = squash(source);
  return ingredients
    .filter((i) => {
      const base = i.name.replace(/[（(].*?[）)]/g, "");
      const candidates = [i.name, base, ...aliasesOf(base)].map(squash);
      return !candidates.some((c) => c && src.includes(c));
    })
    .map((i) => i.name);
}

export function unverifiedNotice(names: string[]): string | null {
  if (!names.length) return null;
  return `「${names.join("」「")}」は元の文に見つかりませんでした（AI が足したかもしれません）。確かめて、要らなければ消してください。`;
}
