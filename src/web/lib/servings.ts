import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { apiClient, type RecipeDetail } from "@/api/client";
import { findPlan } from "../../shared/servings";

/** ふだん作る人数（設定）。読めなければ null */
export function useHousehold(): number | null {
  const q = useQuery({
    queryKey: ["group"],
    queryFn: apiClient.group,
    staleTime: 60_000,
  });
  return q.data?.servings ?? null;
}

// 前に探して人数が無かった（0）レシピを、読める書き方を広げたあとにもう一度だけ探す（DEC-039）。
// 「もう探し直した」はこの端末で覚える。覚えられなくても害は無い（もう一度探すだけ）
const AGAIN_KEY = "mairecipe:servings-again:v1";
function triedAgain(): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(AGAIN_KEY) ?? "[]");
    return new Set(
      Array.isArray(raw)
        ? raw.filter((x): x is string => typeof x === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}
function rememberAgain(id: string) {
  try {
    const next = [...triedAgain().add(id)].slice(-2000);
    localStorage.setItem(AGAIN_KEY, JSON.stringify(next));
  } catch {
    // 覚えられない端末（プライベートブラウズなど）では何もしない
  }
}

/**
 * 人数の無いレシピは、開いたときに元のレシピから人数を探す
 * （見つからなければ 0 が入る。0 のレシピは、この端末で 1 回だけ探し直す）
 */
export function useFindServings(r: RecipeDetail) {
  const qc = useQueryClient();
  const tried = useRef(new Set<string>());
  const plan = findPlan(
    r.id,
    r.versions.map((v) => v.servings),
    triedAgain(),
  );
  useEffect(() => {
    if (!plan || tried.current.has(r.id)) return;
    tried.current.add(r.id);
    apiClient
      .findServings(r.id, plan === "again")
      .then((res) => {
        if (plan === "again") rememberAgain(r.id);
        if (res.servings !== null) {
          void qc.invalidateQueries({ queryKey: ["recipe", r.id] });
          void qc.invalidateQueries({ queryKey: ["recipes", "nutrition"] });
        }
      })
      .catch(() => {});
  }, [plan, r.id, qc]);
}

/** 一度に探すレシピの上限（開くたびに続きから探す） */
const FILL_MAX = 40;

/**
 * 一覧（栄養で探す）で、人数の無いレシピの人数を、元のレシピから順に探す。
 * 返すのは、いま探している残りの数（0 なら探していない）
 */
export function useFillMissingServings(
  rows: { id: string; servings: number | null }[] | undefined,
): number {
  const qc = useQueryClient();
  const started = useRef(false);
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!rows || started.current) return;
    const again = triedAgain();
    const todo = rows
      .map((r) => ({ id: r.id, plan: findPlan(r.id, [r.servings], again) }))
      .filter((x) => x.plan !== null)
      .slice(0, FILL_MAX);
    if (todo.length === 0) return;
    started.current = true;
    let alive = true;
    let changed = false;
    void (async () => {
      await Promise.resolve();
      if (alive) setLeft(todo.length);
      // 相手のサイトに負担をかけないよう、1 つずつ順に読む
      for (const x of todo) {
        if (!alive) return;
        try {
          const res = await apiClient.findServings(x.id, x.plan === "again");
          if (x.plan === "again") rememberAgain(x.id);
          // 見つかった・「無かった」と分かった（聞く欄を出す）ときは、一覧を読み直す
          if (res.servings !== null && (x.plan === "first" || res.servings > 0))
            changed = true;
        } catch {
          // 読めなかったレシピは、次に開いたときにまた探す
        }
        if (alive) setLeft((n) => Math.max(0, n - 1));
      }
      if (changed)
        void qc.invalidateQueries({ queryKey: ["recipes", "nutrition"] });
    })();
    return () => {
      alive = false;
    };
  }, [rows, qc]);
  return left;
}

/** 元のレシピに人数が書かれていなかったレシピに、人数を入れる */
export function useSetServings(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (servings: number) => apiClient.setServings(id, servings),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["recipe", id] });
      void qc.invalidateQueries({ queryKey: ["recipes", "nutrition"] });
    },
  });
}
