// 献立に入ったレシピ（最新版）の材料を、名寄せして単位ごとに合計する。
import { formatAmount, parseAmount } from "./amount";
import type { ShopSection } from "./constants";
import { SHOP_SECTIONS } from "./constants";
import { canonicalName, shopSection } from "./ingredients";
import type { Ingredient } from "./recipe";

export type ShoppingSource = { recipeTitle: string; ingredients: Ingredient[] };

export type ShoppingItem = {
  /** 「家にある」「買った」の印を覚えておくためのキー（名前|単位） */
  key: string;
  name: string;
  amount: string;
  section: ShopSection;
  recipes: string[];
  /** 名寄せでまとめた元の表記（例：たまねぎ） */
  merged: string[];
};

export function aggregateShopping(sources: ShoppingSource[]): ShoppingItem[] {
  const map = new Map<
    string,
    {
      name: string;
      unit: string;
      qty: number | null;
      texts: string[];
      recipes: string[];
      merged: string[];
    }
  >();
  for (const src of sources) {
    for (const ing of src.ingredients) {
      const name = canonicalName(ing.name);
      if (!name) continue;
      const p = parseAmount(ing.amount);
      // 数えられる分量は単位ごとに合計。「少々」「適量」などは名前ごとに1行
      const key =
        p.qty === null ? `${name}|${p.unit || "-"}` : `${name}|${p.unit}`;
      let e = map.get(key);
      if (!e) {
        e = {
          name,
          unit: p.unit,
          qty: p.qty === null ? null : 0,
          texts: [],
          recipes: [],
          merged: [],
        };
        map.set(key, e);
      }
      if (p.qty !== null && e.qty !== null) e.qty += p.qty;
      if (!e.recipes.includes(src.recipeTitle)) e.recipes.push(src.recipeTitle);
      const raw = ing.name.trim();
      if (raw !== name && !e.merged.includes(raw)) e.merged.push(raw);
    }
  }
  const items: ShoppingItem[] = [...map.entries()].map(([key, e]) => ({
    key,
    name: e.name,
    amount:
      e.qty === null ? e.unit : formatAmount({ qty: e.qty, unit: e.unit }),
    section: shopSection(e.name),
    recipes: e.recipes,
    merged: e.merged,
  }));
  const order = (s: ShopSection) => SHOP_SECTIONS.indexOf(s);
  return items.sort(
    (a, b) =>
      order(a.section) - order(b.section) || a.name.localeCompare(b.name, "ja"),
  );
}
