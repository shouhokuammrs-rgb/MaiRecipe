import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiClient } from "@/api/client";
import { Empty, ErrorState, Loading, SubHeader } from "@/components/common";
import {
  LEVEL_LABEL,
  NUTRIENTS,
  NUTRIENT_IDS,
  NUTRITION_SOURCE,
  isNutrientId,
  rankByNutrient,
} from "../../shared/nutrition";

// 栄養で探す（DEC-038）。AI は使わない。選んだ栄養素が多い順に、手持ちのレシピを並べる
export function Nutrition() {
  const [params, setParams] = useSearchParams();
  // 選んだ栄養素は URL に置く（レシピを見て戻っても同じ並び）
  const raw = params.get("n");
  const picked = isNutrientId(raw) ? raw : null;
  const list = useQuery({
    queryKey: ["recipes", "nutrition"],
    queryFn: () => apiClient.nutritionRecipes(),
  });
  const result = useMemo(
    () => (picked && list.data ? rankByNutrient(list.data, picked) : null),
    [picked, list.data],
  );

  return (
    <>
      <SubHeader title="栄養で探す" back="/" />
      <div className="flex flex-col gap-4 px-5 pt-4 pb-10">
        <p className="text-sm leading-7 text-ink">
          とりたい栄養を選ぶと、自分のレシピを多い順に並べます。
        </p>

        <div className="flex flex-wrap gap-2" role="group" aria-label="栄養素">
          {NUTRIENT_IDS.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={picked === id}
              onClick={() =>
                setParams(picked === id ? {} : { n: id }, { replace: true })
              }
              className={`h-11 rounded-full border px-4 text-[13px] font-medium ${picked === id ? "border-ink bg-ink text-white" : "border-field bg-card text-ink"}`}
            >
              {NUTRIENTS[id].label}
            </button>
          ))}
        </div>

        {picked && (
          <p className="text-xs leading-5 text-sub">
            {NUTRIENTS[picked].label}は、{NUTRIENTS[picked].about}栄養です。
          </p>
        )}

        {list.isPending && <Loading />}
        {list.isError && <ErrorState error={list.error} />}
        {!picked && list.data && (
          <Empty>
            {list.data.length === 0
              ? "まだレシピがありません。レシピを足すと、ここで栄養から探せます。"
              : "上から栄養を 1 つ選んでください。"}
          </Empty>
        )}
        {result && result.ranked.length === 0 && (
          <Empty>
            {NUTRIENTS[picked!].label}が多めのレシピは、まだありません。
          </Empty>
        )}

        {result && result.ranked.length > 0 && (
          <ul className="flex flex-col gap-2.5">
            {result.ranked.map((r) => (
              <li key={r.id}>
                <Link
                  to={`/recipes/${r.id}`}
                  className="flex min-h-11 flex-col gap-1 rounded-2xl border border-line-soft bg-card p-3.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[15px] font-bold">{r.title}</span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${r.level === "high" ? "bg-herb-soft text-herb" : "bg-chip text-sub"}`}
                    >
                      {LEVEL_LABEL[r.level]}
                    </span>
                  </div>
                  {r.sources.length > 0 && (
                    <span className="text-xs text-sub">
                      主に {r.sources.join("・")} から
                    </span>
                  )}
                  {r.servingsAssumed && (
                    <span className="text-xs text-sub">
                      人数が書かれていないので、2人分として計算
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}

        {result && result.skipped > 0 && (
          <p className="text-xs leading-5 text-sub">
            材料や分量が読み取れず、並べられなかったレシピが {result.skipped}{" "}
            件あります（分量が「適量」だけ、成分表に無い食材 など）。
          </p>
        )}

        {list.data && list.data.length > 0 && (
          <p className="border-t border-line-soft pt-3 text-xs leading-5 text-sub">
            1人前の目安です（多い ＝ 1日の目安の 4分の1
            以上）。必要な量は人によって違います。材料の分量から計算していて、加熱での増減は入れていません。体の不調があるときは、医師や管理栄養士に相談してください。
            <br />
            {NUTRITION_SOURCE}。
          </p>
        )}
      </div>
    </>
  );
}
