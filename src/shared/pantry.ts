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
  // 売り場の判定より先に見るもの（名前の一部が別の売り場に当たってしまうもの）
  if (/冷凍|^氷$|かき氷|アイス(クリーム)?$|ソフトクリーム/.test(n))
    return "冷凍室";
  if (/ジュース|コーラ|サイダー|ビール|炭酸|茶$|コーヒー/.test(n))
    return "ドアポケット";
  if (/ご飯|ごはん|残り|作りおき|作り置き/.test(n)) return "冷蔵室";
  if (/パン$|ベーグル|ミックス$/.test(n) && !/冷凍/.test(n)) return "常温";
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

/** 室ごとに分ける。室は order の順（省くと FRIDGE_ZONES）、室の中は渡された順のまま。空の室も返す */
export function groupByZone<T extends { zone: FridgeZone }>(
  items: T[],
  order: readonly FridgeZone[] = FRIDGE_ZONES,
): { zone: FridgeZone; items: T[] }[] {
  return order.map((zone) => ({
    zone,
    items: items.filter((i) => i.zone === zone),
  }));
}

/** 冷蔵庫の中の室（常温を除く）。並べ替えられるのはこの5つ。常温は冷蔵庫の外なのでいつも最後（DEC-034） */
export const INSIDE_ZONES = FRIDGE_ZONES.filter(
  (z): z is Exclude<FridgeZone, "常温"> => z !== "常温",
);

/** 保存した室の順番を今の室に合わせる。知らない室・常温は落とし、足りない室は元の順で後ろに足す */
export function resolveFridgeOrder(
  saved: readonly string[] | null | undefined,
): FridgeZone[] {
  const out: FridgeZone[] = [];
  for (const z of saved ?? [])
    if (
      (INSIDE_ZONES as readonly string[]).includes(z) &&
      !out.includes(z as FridgeZone)
    )
      out.push(z as FridgeZone);
  for (const z of INSIDE_ZONES) if (!out.includes(z)) out.push(z);
  return [...out, "常温"];
}

/** 室の中の並べ方（DEC-034）。家で1つ */
export const FRIDGE_SORTS = ["expires", "added", "name", "manual"] as const;
export type FridgeSort = (typeof FRIDGE_SORTS)[number];
export const FRIDGE_SORT_LABELS: Record<FridgeSort, string> = {
  expires: "期限が近い順",
  added: "入れた順",
  name: "名前順",
  manual: "手で並べた順",
};

export function sortPantryBy<
  T extends {
    name: string;
    expiresOn: string | null;
    addedOn: string;
    position?: number | null;
  },
>(items: T[], mode: FridgeSort): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, "ja");
  switch (mode) {
    case "added":
      return [...items].sort((a, b) =>
        a.addedOn !== b.addedOn
          ? a.addedOn > b.addedOn
            ? -1
            : 1
          : byName(a, b),
      );
    case "name":
      return [...items].sort(byName);
    case "manual": {
      // まだ並べていない品（後から入った品）は、後ろに期限が近い順で
      const placed = items
        .filter((i) => i.position != null)
        .sort((a, b) => a.position! - b.position!);
      const rest = sortPantry(items.filter((i) => i.position == null));
      return [...placed, ...rest];
    }
    default:
      return sortPantry(items);
  }
}

/**
 * 置き場所を変えたとき、何を書き換えるか（DEC-034）。
 * 冷凍は「今回だけ冷凍した」ことが多いので、冷凍室へはその品だけ（itemZone）。
 * ほかの室へは「この食材はここ」と名前ごとに覚える（pref）。いつもの室に戻したら覚えた分は消す
 */
export function planZoneMove(
  now: { auto: FridgeZone; pref: FridgeZone | null },
  target: FridgeZone | null,
): { itemZone: FridgeZone | null; pref: FridgeZone | null | "keep" } {
  if (target === null) return { itemZone: null, pref: null };
  const usual = now.pref ?? now.auto;
  if (target === "冷凍室" && usual !== "冷凍室")
    return { itemZone: "冷凍室", pref: "keep" };
  return { itemZone: null, pref: target === now.auto ? null : target };
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

/** まとめて移動。null は「おまかせ」に戻す */
export const moveIdsSchema = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1).max(100),
  zone: z.enum(FRIDGE_ZONES).nullable(),
});

/** 元に戻すための、移す前の状態（moveZones が返し、そのまま送り返す） */
export const zoneUndoSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        zone: z.enum(FRIDGE_ZONES).nullable(),
      }),
    )
    .max(100),
  prefs: z
    .array(
      z.object({
        name: pantryName,
        zone: z.enum(FRIDGE_ZONES).nullable(),
      }),
    )
    .max(100),
});
export type ZoneUndo = z.infer<typeof zoneUndoSchema>;

/** 手で並べた順（冷蔵庫の全部の品の id を、上から並べたもの） */
export const pantryOrderSchema = z.object({
  ids: z.array(z.string().min(1).max(64)).max(500),
});

/** 並べ方と室の順番（どちらか、または両方）。zones: null でおすすめの順に戻す */
export const fridgeSettingsSchema = z
  .object({
    sort: z.enum(FRIDGE_SORTS).optional(),
    zones: z
      .array(z.enum(FRIDGE_ZONES))
      .length(INSIDE_ZONES.length)
      .refine(
        (a) => new Set(a).size === a.length && !a.includes("常温"),
        "室の順番を確認してください",
      )
      .nullable()
      .optional(),
  })
  .refine((p) => p.sort !== undefined || p.zones !== undefined, {
    message: "直す項目がありません",
  });

export const shoppingHaveSchema = z.object({
  name: pantryName,
  value: z.boolean(),
});
