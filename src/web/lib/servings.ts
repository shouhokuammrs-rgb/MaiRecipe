import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { apiClient, type RecipeDetail } from "@/api/client";

/** ふだん作る人数（設定）。読めなければ null */
export function useHousehold(): number | null {
  const q = useQuery({
    queryKey: ["group"],
    queryFn: apiClient.group,
    staleTime: 60_000,
  });
  return q.data?.servings ?? null;
}

/**
 * 人数を読む前に保存したレシピは、開いたときに一度だけ出典から人数を探す
 * （見つからなければ 0 が入り、もう探さない）
 */
export function useFindServings(r: RecipeDetail) {
  const qc = useQueryClient();
  const tried = useRef(new Set<string>());
  const latest = r.versions[r.versions.length - 1];
  const need = latest?.servings === null;
  useEffect(() => {
    if (!need || tried.current.has(r.id)) return;
    tried.current.add(r.id);
    apiClient
      .findServings(r.id)
      .then((res) => {
        if (res.servings !== null)
          void qc.invalidateQueries({ queryKey: ["recipe", r.id] });
      })
      .catch(() => {});
  }, [need, r.id, qc]);
}
