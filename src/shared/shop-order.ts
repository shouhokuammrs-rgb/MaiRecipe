// 買い物リストの売り場の並び（DEC-032）。家ごとに保存した並びと、おすすめの並びをつなぐ
import { z } from "zod";
import { SHOP_SECTIONS, type ShopSection } from "./constants";

/** 保存する並び。全部の売り場を1回ずつ */
export const shopOrderSchema = z.object({
  order: z
    .array(z.enum(SHOP_SECTIONS))
    .length(SHOP_SECTIONS.length)
    .refine((a) => new Set(a).size === a.length, "同じ売り場が2回あります")
    .nullable(),
});

/**
 * 保存した並びを今の売り場に合わせる。知らない売り場は落とし、
 * 後から増えた売り場はおすすめの並びの位置に差し込む
 */
export function resolveShopOrder(
  saved: readonly string[] | null | undefined,
): ShopSection[] {
  if (!saved?.length) return [...SHOP_SECTIONS];
  const known = new Set<string>(SHOP_SECTIONS);
  const out = saved.filter(
    (x, i): x is ShopSection => known.has(x) && saved.indexOf(x) === i,
  );
  SHOP_SECTIONS.forEach((sec, i) => {
    if (out.includes(sec)) return;
    // おすすめの並びで1つ前にある売り場の後ろに入れる
    const prev = SHOP_SECTIONS.slice(0, i)
      .reverse()
      .find((p) => out.includes(p));
    out.splice(prev ? out.indexOf(prev) + 1 : 0, 0, sec);
  });
  return out;
}

/** 並びの中で1つ上・下に動かす（端では動かない） */
export function moveSection(
  order: readonly ShopSection[],
  section: ShopSection,
  dir: -1 | 1,
): ShopSection[] {
  const i = order.indexOf(section);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return [...order];
  const next = [...order];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}
