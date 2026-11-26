import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  LEVEL_LABEL,
  NUTRIENTS,
  NUTRIENT_IDS,
  NUTRITION_SOURCE,
  isNutrientId,
  type NutritionIngredient,
} from "../../shared/nutrition";
import {
  NUTRIENT_TIPS,
  suggestAdditions,
  type Addition,
} from "../../shared/nutrition-add";

/** 足したらどう変わるかの一言 */
function effect(a: Addition): string {
  if (a.before === null) return `この分だけで「${LEVEL_LABEL[a.after]}」`;
  if (a.before === a.after)
    return `「${LEVEL_LABEL[a.after]}」のまま（少し増える）`;
  return `${LEVEL_LABEL[a.before]} → ${LEVEL_LABEL[a.after]}`;
}

/**
 * このレシピに足すなら（DEC-038 の 2 回目）。AI は使わない。
 * 栄養を選ぶと、この料理に合う食材と、足したときの変わり方を出す。選んだ栄養は URL の n に置く
 */
export function NutritionAdd({
  title,
  steps,
  ingredients,
  servings,
}: {
  title: string;
  steps: string[];
  ingredients: NutritionIngredient[];
  servings: number | null;
}) {
  const [params, setParams] = useSearchParams();
  const raw = params.get("n");
  const picked = isNutrientId(raw) ? raw : null;
  const list = useMemo(
    () =>
      picked
        ? suggestAdditions({ title, steps, ingredients, servings }, picked)
        : null,
    [picked, title, steps, ingredients, servings],
  );
  const pick = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("n", id);
    else next.delete("n");
    setParams(next, { replace: true, preventScrollReset: true });
  };

  return (
    <section
      aria-label="栄養を足すなら"
      className="flex flex-col gap-2.5 rounded-2xl border border-line-soft bg-card px-3.5 py-3"
    >
      <h2 className="text-[13px] font-bold">栄養を足すなら</h2>
      <p className="text-xs leading-5 text-sub">
        足したい栄養を選ぶと、この料理に合う食材を出します。
      </p>
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="足したい栄養"
      >
        {NUTRIENT_IDS.map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={picked === id}
            onClick={() => pick(picked === id ? null : id)}
            className={`h-11 rounded-full border px-3.5 text-[13px] font-medium ${picked === id ? "border-ink bg-ink text-white" : "border-field bg-card text-ink"}`}
          >
            {NUTRIENTS[id].label}
          </button>
        ))}
      </div>

      {picked && list && list.length === 0 && (
        <p className="text-sm leading-6 text-sub">
          この料理に合って、{NUTRIENTS[picked].label}
          をしっかり足せる食材は見つかりませんでした。
        </p>
      )}

      {picked && list && list.length > 0 && (
        <>
          <ul className="flex flex-col">
            {list.map((a) => (
              <li
                key={a.key}
                className="flex items-baseline justify-between gap-3 border-t border-line-soft py-2.5 first:border-t-0"
              >
                <span className="text-sm font-bold">
                  {a.name}
                  <span className="ml-1.5 font-normal text-sub">
                    {a.amount}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-herb">{effect(a)}</span>
              </li>
            ))}
          </ul>
          {NUTRIENT_TIPS[picked] && (
            <p className="rounded-xl bg-herb-soft px-3 py-2 text-xs leading-5 text-ink">
              {NUTRIENT_TIPS[picked]}
            </p>
          )}
          <p className="text-[11px] leading-5 text-sub">
            量はレシピ全体に足す目安で、右は{NUTRIENTS[picked].label}の
            1人前の変わり方です。足したら味つけを調整してください。
            {NUTRITION_SOURCE}。
          </p>
        </>
      )}
    </section>
  );
}
