// 作った！（DEC-030）。作った記録は共有（グループ）、誰が食べたか・評価は本人のもの。
// ここは純粋な部分（入力の形と、使った食材の候補）
import { z } from "zod";
import { canonicalName } from "./ingredients";
import { isSeasoning } from "./pantry";

/** 評価：また作る・ふつう・いまいち */
export const RATINGS = ["again", "ok", "meh"] as const;
export type Rating = (typeof RATINGS)[number];
export const RATING_LABELS: Record<Rating, string> = {
  again: "また作る",
  ok: "ふつう",
  meh: "いまいち",
};

/** 1人前の刻み（0.5 人前まで） */
const portionSchema = z
  .number()
  .min(0.5)
  .max(10)
  .refine((v) => Number.isInteger(v * 2), "0.5 刻みで入れてください");

export const cookedSchema = z.object({
  /** どの版で作ったか（省くと最新版） */
  versionId: z.string().min(1).nullable().default(null),
  /** 何人分作ったか */
  servings: z.number().int().min(1).max(20),
  /** 誰が何人前食べたか（グループのメンバーだけ。空でもよい＝食べた記録は付けない） */
  eaters: z
    .array(z.object({ userId: z.string().min(1), portion: portionSchema }))
    .max(10)
    .default([]),
  /** 作った人の評価（任意） */
  rating: z.enum(RATINGS).nullable().default(null),
  note: z.string().trim().max(300).default(""),
  /** 使い切った食材（冷蔵庫の行の id。自分のグループのものだけ消える） */
  usedPantryIds: z.array(z.string().min(1)).max(60).default([]),
});
export type CookedInput = z.infer<typeof cookedSchema>;

export const ratingSchema = z.object({ rating: z.enum(RATINGS).nullable() });

/** レシピの材料と名寄せで一致する冷蔵庫の行（使い切った候補）。調味料は冷蔵庫に無い前提なので除く */
export function pantryUsedBy<T extends { name: string }>(
  ingredients: { name: string }[],
  pantry: T[],
): T[] {
  const used = new Set(
    ingredients
      .map((i) => canonicalName(i.name.replace(/^【[^】]*】/, "")))
      .filter((n) => n && !isSeasoning(n)),
  );
  return pantry.filter((p) => used.has(canonicalName(p.name)));
}
