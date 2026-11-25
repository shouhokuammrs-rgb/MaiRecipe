import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  NUTRIENTS,
  NUTRITION_SOURCE,
  highNutrients,
  recipeNutrition,
  type NutritionIngredient,
} from "../../shared/nutrition";

/**
 * レシピの「多い栄養」の目安（DEC-038）。AI は使わず、成分表から計算する。
 * 目安を出せないレシピ（材料や分量が読めない）と、多い栄養が無いレシピでは何も出さない
 */
export function NutritionNote({
  ingredients,
  servings,
}: {
  ingredients: NutritionIngredient[];
  servings: number | null;
}) {
  const { high, assumed } = useMemo(() => {
    const n = recipeNutrition(ingredients, servings);
    return { high: highNutrients(n), assumed: n.servingsAssumed };
  }, [ingredients, servings]);
  if (high.length === 0) return null;
  return (
    <section
      aria-label="栄養の目安"
      className="flex flex-col gap-2 rounded-2xl bg-herb-soft px-3.5 py-3"
    >
      <h2 className="text-[13px] font-bold text-herb">
        1人前で多くとれる栄養（目安）
      </h2>
      <ul className="flex flex-wrap gap-1.5">
        {high.map((id) => (
          <li key={id}>
            <Link
              to={`/nutrition?n=${id}`}
              aria-label={`${NUTRIENTS[id].label}が多いレシピを探す`}
              className="flex h-11 items-center rounded-full border border-herb-mid bg-card px-3.5 text-[13px] font-bold text-herb"
            >
              {NUTRIENTS[id].label}
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-[11px] leading-5 text-sub">
        {assumed && "人数が書かれていないので、2人分として計算しています。"}
        材料の分量からの計算で、加熱での増減は入れていません。
        {NUTRITION_SOURCE}。
      </p>
    </section>
  );
}
