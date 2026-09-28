// 「材料から探す」：入れた材料をいくつ使うかで並べる。AI は使わない。
import { matchesIngredient, shopSection } from "./ingredients";
import type { Ingredient } from "./recipe";

export type FindCandidate = {
  id: string;
  title: string;
  ingredients: Ingredient[];
};

export type FindResult = {
  id: string;
  title: string;
  matched: number;
  total: number;
  have: string[];
  /** 調味料以外で、入れた材料に当たらなかったもの（買い足しの候補） */
  missing: string[];
};

export function findByIngredients(
  terms: string[],
  recipes: FindCandidate[],
): FindResult[] {
  const clean = [...new Set(terms.map((t) => t.trim()).filter(Boolean))];
  if (!clean.length) return [];
  const out: FindResult[] = [];
  for (const r of recipes) {
    const hit = new Set<string>();
    const have: string[] = [];
    const missing: string[] = [];
    for (const ing of r.ingredients) {
      const ts = clean.filter((t) => matchesIngredient(t, ing.name));
      if (ts.length) {
        ts.forEach((t) => hit.add(t));
        have.push(ing.name);
      } else if (shopSection(ing.name) !== "調味料") {
        missing.push(ing.name);
      }
    }
    if (hit.size) {
      out.push({
        id: r.id,
        title: r.title,
        matched: hit.size,
        total: clean.length,
        have,
        missing,
      });
    }
  }
  return out.sort(
    (a, b) =>
      b.matched - a.matched ||
      a.missing.length - b.missing.length ||
      a.title.localeCompare(b.title, "ja"),
  );
}
