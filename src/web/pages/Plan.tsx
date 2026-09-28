import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiClient, type PlanEntry } from "@/api/client";
import { Empty, ErrorState, Loading, PageTitle } from "@/components/common";
import { categoryTint } from "@/lib/tint";
import { cn } from "@/lib/utils";
import { MEAL_LABELS, MEALS, type Meal } from "../../shared/constants";
import { addDays, labelDate, todayJst, weekStart } from "../../shared/dates";

export function Plan() {
  const [params, setParams] = useSearchParams();
  const adding = params.get("add");
  const today = todayJst();
  const [start, setStart] = useState(() => weekStart(today));
  const end = addDays(start, 6);
  const [picker, setPicker] = useState<{ date: string; meal: Meal } | null>(
    null,
  );
  const qc = useQueryClient();
  const nav = useNavigate();

  const plans = useQuery({
    queryKey: ["plans", start],
    queryFn: () => apiClient.plans(start, end),
  });
  const addingRecipe = useQuery({
    queryKey: ["recipe", adding],
    queryFn: () => apiClient.getRecipe(adding!),
    enabled: Boolean(adding),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["plans"] });
    void qc.invalidateQueries({ queryKey: ["shopping"] });
  };
  const set = useMutation({
    mutationFn: (p: { date: string; meal: Meal; recipeId: string }) =>
      apiClient.setPlan(p.date, p.meal, p.recipeId),
    onSuccess: () => {
      setPicker(null);
      if (adding) setParams({}, { replace: true });
      refresh();
    },
  });
  const clear = useMutation({
    mutationFn: (p: { date: string; meal: Meal }) =>
      apiClient.deletePlan(p.date, p.meal),
    onSuccess: refresh,
  });

  const bySlot = useMemo(() => {
    const m = new Map<string, PlanEntry>();
    for (const p of plans.data?.plans ?? []) m.set(`${p.date}|${p.meal}`, p);
    return m;
  }, [plans.data]);

  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  return (
    <>
      <PageTitle
        aside={
          <div className="flex items-center text-sm font-medium">
            <button
              type="button"
              aria-label="前の週"
              className="flex size-10 items-center justify-center"
              onClick={() => setStart(addDays(start, -7))}
            >
              <ChevronLeft className="size-5" />
            </button>
            {labelDate(start).md}〜{labelDate(end).md}
            <button
              type="button"
              aria-label="次の週"
              className="flex size-10 items-center justify-center"
              onClick={() => setStart(addDays(start, 7))}
            >
              <ChevronRight className="size-5" />
            </button>
          </div>
        }
      >
        献立
      </PageTitle>

      <div className="flex flex-col gap-2 px-5 pb-2">
        {adding && addingRecipe.data && (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-accent-soft px-3 py-2.5 text-[13px] text-accent-deep">
            「{addingRecipe.data.title}」を入れる枠をタップ
            <button
              type="button"
              className="shrink-0 underline"
              onClick={() => setParams({}, { replace: true })}
            >
              やめる
            </button>
          </div>
        )}
        {start !== weekStart(today) && (
          <button
            type="button"
            className="self-start text-xs text-accent underline"
            onClick={() => setStart(weekStart(today))}
          >
            今週に戻る
          </button>
        )}
        <div className="grid grid-cols-[3.2rem_repeat(3,minmax(0,1fr))] gap-1.5 text-center text-[11px] text-sub">
          <span />
          {MEALS.map((m) => (
            <span key={m}>{MEAL_LABELS[m]}</span>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2 px-5 pb-8">
        {plans.isPending && <Loading />}
        {plans.isError && (
          <ErrorState error={plans.error} retry={() => plans.refetch()} />
        )}
        {plans.data &&
          days.map((d) => {
            const l = labelDate(d);
            const past = d < today;
            const isToday = d === today;
            return (
              <div
                key={d}
                className={cn(
                  "grid grid-cols-[3.2rem_repeat(3,minmax(0,1fr))] gap-1.5",
                  past && "opacity-45",
                )}
              >
                <div
                  className={cn(
                    "flex flex-col justify-center",
                    isToday
                      ? "text-accent"
                      : l.dowIndex === 0
                        ? "text-danger"
                        : l.dowIndex === 6
                          ? "text-[#2f5e8c]"
                          : "text-ink",
                  )}
                >
                  <span className="text-[15px] font-bold">{l.md}</span>
                  <span className="text-xs">
                    {l.dow}
                    {isToday && "・今日"}
                  </span>
                </div>
                {MEALS.map((meal) => {
                  const p = bySlot.get(`${d}|${meal}`);
                  if (p) {
                    return (
                      <div
                        key={meal}
                        className="relative flex min-h-16 rounded-xl p-2"
                        style={{ background: categoryTint(p.category) }}
                      >
                        <button
                          type="button"
                          onClick={() => nav(`/recipes/${p.recipeId}`)}
                          className="pr-4 text-left text-xs leading-snug font-bold"
                        >
                          {p.title}
                        </button>
                        {!past && (
                          <button
                            type="button"
                            aria-label={`${l.md} ${MEAL_LABELS[meal]} から外す`}
                            onClick={() => clear.mutate({ date: d, meal })}
                            className="absolute top-0.5 right-0.5 flex size-6 items-center justify-center rounded-full bg-white/75 text-[#4a433c]"
                          >
                            <X className="size-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  }
                  return (
                    <button
                      key={meal}
                      type="button"
                      disabled={past}
                      aria-label={`${l.md} ${MEAL_LABELS[meal]} にレシピを入れる`}
                      onClick={() => {
                        if (adding)
                          set.mutate({ date: d, meal, recipeId: adding });
                        else setPicker({ date: d, meal });
                      }}
                      className={cn(
                        "flex min-h-16 items-center justify-center rounded-xl border-[1.5px] border-dashed text-faint",
                        adding && !past
                          ? "border-accent bg-[#fbeee8]"
                          : "border-[#d6cdc1] bg-card",
                      )}
                    >
                      <Plus className="size-5" />
                    </button>
                  );
                })}
              </div>
            );
          })}
      </div>

      {picker && (
        <RecipePicker
          label={`${labelDate(picker.date).md}（${labelDate(picker.date).dow}）${MEAL_LABELS[picker.meal]}`}
          onClose={() => setPicker(null)}
          onPick={(id) => set.mutate({ ...picker, recipeId: id })}
        />
      )}
    </>
  );
}

function RecipePicker({
  label,
  onClose,
  onPick,
}: {
  label: string;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const list = useQuery({
    queryKey: ["recipes", q, "", ""],
    queryFn: () => apiClient.listRecipes({ q }),
  });
  return (
    <div
      className="fixed inset-0 z-20 flex flex-col justify-end bg-ink/40"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={`${label} に入れるレシピ`}
        className="mx-auto flex max-h-[75%] w-full max-w-xl flex-col gap-3 rounded-t-3xl bg-card px-5 pt-5 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">{label} に入れるレシピ</h2>
          <button
            type="button"
            className="h-9 text-sm text-sub"
            onClick={onClose}
          >
            閉じる
          </button>
        </div>
        <label className="relative block">
          <span className="sr-only">レシピ名で絞り込む</span>
          <Search className="absolute top-3 left-3 size-4 text-sub" />
          <input
            id="picker-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="レシピ名で絞り込む"
            className="h-10 w-full rounded-xl border border-line bg-paper pr-3 pl-9 text-sm"
          />
        </label>
        <div className="flex flex-col gap-2 overflow-y-auto">
          {list.isPending && <Loading />}
          {list.data?.length === 0 && (
            <Empty>
              レシピがありません。
              <Link to="/import" className="text-accent underline">
                取り込む
              </Link>
            </Empty>
          )}
          {list.data?.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onPick(r.id)}
              className="flex items-center gap-3 rounded-xl border border-line-soft p-2 text-left"
            >
              <span
                className="size-11 shrink-0 rounded-lg"
                style={{ background: categoryTint(r.category) }}
              />
              <span className="flex flex-col">
                <span className="text-sm font-bold">{r.title}</span>
                <span className="text-xs text-sub">
                  {r.category}・{r.genre}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
