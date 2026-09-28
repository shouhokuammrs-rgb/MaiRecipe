// レシピの材料・手順の形と、版どうしの差分。画面と API で共有する。
import { z } from "zod";
import { formatAmount, parseAmount } from "./amount";
import { CATEGORIES, GENRES, LIMITS, MEALS } from "./constants";

export const ingredientSchema = z.object({
  name: z.string().trim().min(1).max(LIMITS.ingredientNameMax),
  amount: z.string().trim().max(LIMITS.amountMax).default(""),
});
export type Ingredient = z.infer<typeof ingredientSchema>;

const stepsSchema = z
  .array(z.string().trim().min(1).max(LIMITS.stepMax))
  .max(LIMITS.stepsMax);
const ingredientsSchema = z.array(ingredientSchema).max(LIMITS.ingredientsMax);

const videoUrl = z
  .string()
  .trim()
  .max(LIMITS.urlMax)
  .url()
  .refine((u) => /^https?:\/\//.test(u), "http(s) の URL だけ使えます");

/** 新しくレシピを作るとき（取り込み・手入力のどちらも） */
export const createRecipeSchema = z.object({
  title: z.string().trim().min(1).max(LIMITS.titleMax),
  category: z.enum(CATEGORIES),
  genre: z.enum(GENRES),
  timeLabel: z.string().trim().max(20).default(""),
  sourceUrl: videoUrl.nullable().default(null),
  videoUrl: videoUrl.nullable().default(null),
  origin: z.enum(["import", "own"]).default("import"),
  ingredients: ingredientsSchema,
  steps: stepsSchema,
});
export type CreateRecipeInput = z.infer<typeof createRecipeSchema>;

/** 編集して新しい版を作るとき。出典（sourceUrl）は変えられない */
export const newVersionSchema = z.object({
  title: z.string().trim().min(1).max(LIMITS.titleMax),
  category: z.enum(CATEGORIES),
  genre: z.enum(GENRES),
  timeLabel: z.string().trim().max(20).default(""),
  ingredients: ingredientsSchema,
  steps: stepsSchema,
  /** このメモを反映した版として記録する（任意） */
  memoId: z.string().optional(),
});
export type NewVersionInput = z.infer<typeof newVersionSchema>;

export const memoSchema = z.object({
  text: z.string().trim().min(1).max(LIMITS.memoMax),
});

export const mealPlanSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  meal: z.enum(MEALS),
  recipeId: z.string().min(1),
});

export const findSchema = z.object({
  terms: z.array(z.string().trim().min(1).max(30)).min(1).max(10),
});

export const importSchema = z.object({
  url: videoUrl,
});

export const shoppingMarkSchema = z.object({
  key: z.string().min(1).max(120),
  kind: z.enum(["home", "bought"]),
  value: z.boolean(),
});

/** 分量の表記を読みやすくそろえる（"大さじ 2" → "大さじ2"）。読めなければそのまま */
export function tidyAmount(raw: string): string {
  const p = parseAmount(raw);
  return p.qty === null ? raw.trim() : formatAmount(p);
}

/**
 * 版どうしの差分を、改良のあゆみに書く短い行にする。
 * 材料は名前で突き合わせ、同じ位置で名前が変わったものは「A → B」と書く。
 */
export function diffVersions(
  before: { title: string; ingredients: Ingredient[]; steps: string[] },
  after: { title: string; ingredients: Ingredient[]; steps: string[] },
): string[] {
  const out: string[] = [];
  if (before.title !== after.title) out.push(`レシピ名 → ${after.title}`);

  const oldBy = new Map(before.ingredients.map((i) => [i.name, i]));
  const newBy = new Map(after.ingredients.map((i) => [i.name, i]));
  const removed = before.ingredients.filter((i) => !newBy.has(i.name));
  const added = after.ingredients.filter((i) => !oldBy.has(i.name));

  for (const i of after.ingredients) {
    const o = oldBy.get(i.name);
    if (o && o.amount !== i.amount) {
      out.push(
        `${i.name} ${o.amount || "（分量なし）"} → ${i.amount || "（分量なし）"}`,
      );
    }
  }
  while (removed.length && added.length) {
    const a = removed.shift()!;
    const b = added.shift()!;
    out.push(
      `${a.name} → ${b.name}` +
        (a.amount !== b.amount && b.amount ? `（${b.amount}）` : ""),
    );
  }
  for (const i of added)
    out.push(`追加：${i.name}${i.amount ? " " + i.amount : ""}`);
  for (const i of removed) out.push(`削除：${i.name}`);

  const len = Math.max(before.steps.length, after.steps.length);
  let changed = 0;
  for (let k = 0; k < len; k++)
    if (before.steps[k] !== after.steps[k]) changed++;
  if (changed) out.push(`作り方を修正（${changed}か所）`);
  return out;
}

/** 分量の書き出し（"200g" "大さじ3" "各1パック" "1/2個" "少々"）。"1.8mm" のような商品名の一部は含めない */
const AMOUNT_HEAD =
  /^(?:各|約)?(?:大さじ|小さじ|[\d０-９][\d０-９./／〜~～と]*\s*(?:g|kg|ml|mL|cc|L|個|本|枚|切れ|片|かけ|束|袋|パック|缶|丁|カップ|合|杯|株|房|尾|玉|さじ|粒|人分|つまみ)(?![a-zA-Z])|少々|適量|適宜|ひとつまみ|少量)/;

/** 分量らしく始まっているか（"200g" "大さじ3" "少々"。"ダミー" や "1.8mm" は違う） */
export function startsWithAmount(s: string): boolean {
  return AMOUNT_HEAD.test(s.trim());
}

/** 取り込んだ材料の1行（"玉ねぎ 1個" "鶏むね肉300g" "塩 少々"）を名前と分量に分ける */
export function splitIngredientLine(line: string): Ingredient {
  const s = line.replace(/\s+/g, " ").trim();
  // 商品名に空白があるとき（"ブランド 商品 1.8mm 200g"）は、分量らしく始まる最初の区切りで分ける
  for (const m of s.matchAll(/[ :：…]+/g)) {
    const name = s.slice(0, m.index).trim();
    const amount = s.slice(m.index + m[0].length).trim();
    if (name && AMOUNT_HEAD.test(amount)) return { name, amount };
  }
  const bySpace = s.match(/^(.+?)[ \u3000:：…]+(.+)$/);
  if (bySpace && bySpace[1] && bySpace[2]) {
    return { name: bySpace[1].trim(), amount: bySpace[2].trim() };
  }
  const tail = s.match(
    /^(.+?)((?:大さじ|小さじ)[\d０-９./／と]+|[\d０-９./／と]+\s*(?:g|kg|ml|cc|L|個|本|枚|切れ|片|かけ|束|袋|パック|缶|丁|カップ|合|杯|株|房|尾|玉|さじ|つまみ)|少々|適量|適宜|ひとつまみ|少量)$/,
  );
  if (tail && tail[1] && tail[2])
    return { name: tail[1].trim(), amount: tail[2].trim() };
  return { name: s, amount: "" };
}
