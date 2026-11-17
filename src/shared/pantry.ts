// 冷蔵庫（棚卸し）の純粋な関数と入力の検証。AI は使わない。
import { z } from "zod";
import { LIMITS } from "./constants";
import { addDays, isDate } from "./dates";
import { canonicalName, isStapleCanonical, shopSection } from "./ingredients";

/**
 * 冷蔵庫の室（DEC-033）。並びは冷蔵庫の上から：冷蔵室 → チルド → ドアポケット → 野菜室 → 冷凍室。
 * 常温（じゃがいも・米・缶詰など）は冷蔵庫の外の棚として最後に出す
 */
export const FRIDGE_ZONES = [
  "冷蔵室",
  "チルド",
  "ドアポケット",
  "野菜室",
  "冷凍室",
  "常温",
] as const;
export type FridgeZone = (typeof FRIDGE_ZONES)[number];

// 野菜・果物のうち、ふつうは冷蔵庫に入れないもの
const ROOM_TEMP_PRODUCE =
  /じゃがいも|ジャガイモ|馬鈴薯|玉ねぎ|玉葱|タマネギ|たまねぎ|さつまいも|サツマイモ|里芋|かぼちゃ|カボチャ|南瓜|バナナ|ごぼう|ゴボウ/;
// 米・パン・麺のうち、冷蔵庫に入れるもの（ゆで麺・生麺・皮）。それ以外（米・乾麺・パン）は常温
const CHILLED_STAPLE =
  /ゆで|茹で|生麺|中華麺|焼きそば|焼そば|生パスタ|餅|もち$/;

/** 名前から、ふつう入れる室を決める（売り場の判定を下敷きにする。AI は使わない） */
export function fridgeZone(name: string): FridgeZone {
  const n = canonicalName(name);
  if (/冷凍|アイス/.test(n)) return "冷凍室";
  const section = shopSection(n);
  switch (section) {
    case "冷凍食品":
      return "冷凍室";
    case "野菜・果物":
      return ROOM_TEMP_PRODUCE.test(n) ? "常温" : "野菜室";
    case "魚":
    case "肉":
      return "チルド";
    case "卵・豆腐・乳製品":
      return /牛乳|ミルク|豆乳/.test(n) ? "ドアポケット" : "冷蔵室";
    case "飲み物":
      return "ドアポケット";
    case "調味料":
      return /粉$|パン粉/.test(n) ? "常温" : "ドアポケット";
    case "乾物・缶詰":
      return "常温";
    case "米・パン・麺":
      return CHILLED_STAPLE.test(n) ? "冷蔵室" : "常温";
    default:
      return "冷蔵室";
  }
}

/** 室ごとに分ける。室は FRIDGE_ZONES の順、室の中は渡された順のまま。空の室も返す */
export function groupByZone<T extends { zone: FridgeZone }>(
  items: T[],
): { zone: FridgeZone; items: T[] }[] {
  return FRIDGE_ZONES.map((zone) => ({
    zone,
    items: items.filter((i) => i.zone === zone),
  }));
}

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
  return isStapleCanonical(canonicalName(name));
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

const pantryName = z.string().trim().min(1).max(LIMITS.ingredientNameMax);

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
    /** 置き場所。null で「おまかせ」（名前から決める）に戻す（DEC-033） */
    zone: z.enum(FRIDGE_ZONES).nullable().optional(),
  })
  .refine(
    (p) =>
      p.amount !== undefined ||
      p.expiresOn !== undefined ||
      p.zone !== undefined,
    {
      message: "直す項目がありません",
    },
  );

export const shoppingHaveSchema = z.object({
  name: pantryName,
  value: z.boolean(),
});
