import { useEffect, useMemo, useRef } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import {
  LEVEL_LABEL,
  NUTRIENTS,
  NUTRIENT_IDS,
  NUTRITION_SOURCE,
  isNutrientId,
  type NutritionIngredient,
} from "../../shared/nutrition";
import {
  ADD_MIN_GAIN,
  NUTRIENT_TIPS,
  suggestAdditions,
  type Addition,
} from "../../shared/nutrition-add";

/** 足したらどう変わるかの一言（画面用と読み上げ用） */
function effect(a: Addition): { text: string; spoken: string } {
  const after = LEVEL_LABEL[a.after];
  if (a.before === null)
    return { text: `この分で「${after}」`, spoken: `この分だけで${after}` };
  if (a.before === a.after) {
    const how = a.gain >= ADD_MIN_GAIN * 2 ? "増える" : "少し増える";
    return { text: `${after}（${how}）`, spoken: `${after}のまま、${how}` };
  }
  const before = LEVEL_LABEL[a.before];
  return { text: `${before} → ${after}`, spoken: `${before}から${after}へ` };
}

/**
 * このレシピに足すなら（DEC-038 の 2 回目）。AI は使わない。
 * 栄養を選ぶと、この料理に合う食材と、足したときの変わり方を出す。選んだ栄養は URL の n に置く
 */
export function NutritionAdd({
  title,
  ingredients,
  servings,
  people,
}: {
  title: string;
  ingredients: NutritionIngredient[];
  /** レシピに書かれた人数 */
  servings: number | null;
  /** いま画面で見ている人数（量はこれに合わせて出す） */
  people: number | null;
}) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const box = useRef<HTMLElement>(null);
  const raw = params.get("n");
  const picked = isNutrientId(raw) ? raw : null;
  const result = useMemo(
    () =>
      picked
        ? suggestAdditions({ title, ingredients, servings }, picked, people)
        : null,
    [picked, title, ingredients, servings, people],
  );
  // 「栄養で探す」から栄養つきで開いたときは、ここが見える所まで送る（開いた直後の 1 回だけ）
  const arrivedWith = useRef(picked);
  useEffect(() => {
    if (arrivedWith.current)
      box.current?.scrollIntoView({ block: "center", behavior: "auto" });
  }, []);

  if (ingredients.length === 0) return null;
  const pick = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("n", id);
    else next.delete("n");
    // state（料理モードから戻ったときの知らせなど）は消さない
    setParams(next, { replace: true, state: location.state });
  };
  const label = picked ? NUTRIENTS[picked].label : "";

  return (
    <section
      ref={box}
      aria-labelledby="nutrition-add-title"
      className="flex flex-col gap-2.5 rounded-2xl border border-line-soft bg-card px-3.5 py-3"
    >
      <h2 id="nutrition-add-title" className="text-[13px] font-bold">
        栄養を足すなら
      </h2>
      <p className="text-xs leading-5 text-sub">
        足したい栄養を選ぶと、足しやすい食材を出します。
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
            className={`h-11 min-w-11 rounded-full border px-3.5 text-[13px] font-medium ${picked === id ? "border-ink bg-ink text-white" : "border-field bg-card text-ink"}`}
          >
            {NUTRIENTS[id].label}
          </button>
        ))}
      </div>

      <div aria-live="polite" className="flex flex-col gap-2.5">
        {result?.mode === "none" && (
          <p className="text-sm leading-6 text-sub">
            お菓子やたれなどのレシピには、足す食材を出していません。
          </p>
        )}
        {result?.alreadyHigh && (
          <p className="text-sm leading-6 text-sub">
            このレシピは、{label}がもう多く含まれています。
          </p>
        )}
        {result &&
          result.mode !== "none" &&
          !result.alreadyHigh &&
          result.items.length === 0 && (
            <p className="text-sm leading-6 text-sub">
              {label}
              をしっかり足せて、この料理に合う食材は見つかりませんでした。
            </p>
          )}

        {picked && result && result.items.length > 0 && (
          <>
            <p className="text-xs leading-5 text-ink">
              {result.mode === "mix"
                ? "この料理に混ぜやすい食材です。"
                : "料理の種類が名前から分からないので、添えやすい食材を出しています。"}
            </p>
            <ul className="flex flex-col">
              {result.items.map((a) => {
                const e = effect(a);
                return (
                  <li
                    key={a.key}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-t border-line-soft py-2.5 first:border-t-0"
                  >
                    <span className="text-sm font-bold">
                      {a.name}
                      <span className="ml-1.5 font-normal text-sub">
                        {a.amount}
                      </span>
                    </span>
                    <span className="text-xs text-herb" aria-label={e.spoken}>
                      {e.text}
                    </span>
                  </li>
                );
              })}
            </ul>
            {NUTRIENT_TIPS[picked] && (
              <p className="rounded-xl bg-herb-soft px-3 py-2 text-xs leading-5 text-ink">
                {NUTRIENT_TIPS[picked]}
              </p>
            )}
            <p className="text-[11px] leading-5 text-sub">
              量は{people ?? 2}人分の料理に足す目安
              {result.servingsAssumed && "（人数が書かれていないので 2人分）"}
              で、右は{label}の
              1人前の変わり方です。加熱での増減は入れていません。足したら味つけを調整してください。必要な量は人によって違います。体の不調があるときは、医師や管理栄養士に相談してください。
              <br />
              {NUTRITION_SOURCE}。
            </p>
          </>
        )}
      </div>
    </section>
  );
}
