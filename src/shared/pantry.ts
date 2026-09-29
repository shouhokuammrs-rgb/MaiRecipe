// 冷蔵庫（棚卸し）の純粋な関数と入力の検証。AI は使わない。
import { z } from "zod";
import { addDays, isDate } from "./dates";
import { canonicalName, shopSection } from "./ingredients";

/** 期限が「近い」とみなす日数（今日から数えてこの日数以内。過ぎたものも近い） */
export const PANTRY_SOON_DAYS = 3;

/** 「玉ねぎ にんじん、豚こま」を名前の配列にする。名寄せして重複を消す */
export function splitPantryInput(text: string): string[] {
  const names = text
    .split(/[\s\u3000、,，]+/)
    .map(canonicalName)
    .filter(Boolean);
  return [...new Set(names)];
}

/** 調味料はいつも家にある扱いで、冷蔵庫には入れない */
export function isSeasoning(name: string): boolean {
  return shopSection(canonicalName(name)) === "調味料";
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
}

export function addedLabel(addedOn: string, today: string): string {
  const d = daysBetween(addedOn, today);
  if (d <= 0) return "今日入れた";
  if (d === 1) return "昨日入れた";
  return `${d}日前に入れた`;
}

export function isExpiringSoon(expiresOn: string | null, today: string) {
  return expiresOn !== null && expiresOn <= addDays(today, PANTRY_SOON_DAYS);
}

export function sortPantry<
  T extends { name: string; expiresOn: string | null; addedOn: string },
>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.expiresOn !== b.expiresOn) {
      if (a.expiresOn === null) return 1;
      if (b.expiresOn === null) return -1;
      return a.expiresOn < b.expiresOn ? -1 : 1;
    }
    if (a.addedOn !== b.addedOn) return a.addedOn > b.addedOn ? -1 : 1;
    return a.name.localeCompare(b.name, "ja");
  });
}

const pantryName = z.string().trim().min(1).max(40);

export const pantryAddSchema = z.object({
  names: z.array(pantryName).min(1).max(30),
});

export const pantryPatchSchema = z
  .object({
    amount: z
      .string()
      .trim()
      .max(40)
      .nullable()
      .optional()
      .transform((v) => (v === "" ? null : v)),
    expiresOn: z
      .string()
      .refine(isDate, "日付を確認してください")
      .nullable()
      .optional(),
  })
  .refine((p) => p.amount !== undefined || p.expiresOn !== undefined, {
    message: "直す項目がありません",
  });

export const shoppingHaveSchema = z.object({
  name: pantryName,
  value: z.boolean(),
});
