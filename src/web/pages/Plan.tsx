import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
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
  const add = useMutation({
    mutationFn: (p: { date: string; meal: Meal; recipeId: string }) =>
      apiClient.addPlan(p.date, p.meal, p.recipeId),
    onMutate: () => {
      remove.reset();
      move.reset();
    },
    onSuccess: () => {
      setPicker(null);
      if (adding) setParams({}, { replace: true });
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiClient.deletePlanItem(id),
    onMutate: () => {
      add.reset();
      move.reset();
    },
    onSuccess: refresh,
  });
  const move = useMutation({
    mutationFn: (p: { id: string; direction: "up" | "down" }) =>
      apiClient.movePlanItem(p.id, p.direction),
    onMutate: () => {
      add.reset();
      remove.reset();
    },
    onSuccess: refresh,
  });
  // 次の操作を始めたら（上の各 onMutate で）前のエラーは消えるので、常に高々1つだけ立つ
  const actionError = add.error ?? remove.error ?? move.error;

  // API が 日付 → 朝昼晩 → 枠の中の順 で返すので、その順のまま枠ごとに分ける
  const bySlot = useMemo(() => {
    const m = new Map<string, PlanEntry[]>();
    for (const p of plans.data?.plans ?? []) {
      const key = `${p.date}|${p.meal}`;
      const list = m.get(key);
      if (list) list.push(p);
      else m.set(key, [p]);
    }
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
              className="flex size-11 items-center justify-center"
              onClick={() => setStart(addDays(start, -7))}
            >
              <ChevronLeft className="size-5" />
            </button>
            {labelDate(start).md}〜{labelDate(end).md}
            <button
              type="button"
              aria-label="次の週"
              className="flex size-11 items-center justify-center"
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
              className="min-h-11 shrink-0 underline"
              onClick={() => setParams({}, { replace: true })}
            >
              やめる
            </button>
          </div>
        )}
        {start !== weekStart(today) && (
          <button
            type="button"
            className="min-h-11 self-start text-xs text-accent underline"
            onClick={() => setStart(weekStart(today))}
          >
            今週に戻る
          </button>
        )}
        {actionError && (
          <p role="alert" className="text-sm text-danger">
            {actionError.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3 px-5 pb-8">
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
              <section
                key={d}
                aria-label={
                  isToday ? `今日 ${l.md}（${l.dow}）` : `${l.md}（${l.dow}）`
                }
                className={cn(
                  "flex flex-col gap-2 rounded-2xl border border-line-soft bg-card p-3",
                  past && "opacity-45",
                )}
              >
                <h2
                  className={cn(
                    "flex items-baseline gap-1.5",
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
                </h2>
                {MEALS.map((meal) => {
                  const items = bySlot.get(`${d}|${meal}`) ?? [];
                  const slot = `${l.md} ${MEAL_LABELS[meal]}`;
                  return (
                    <div key={meal} className="flex gap-2">
                      <span className="w-6 shrink-0 pt-3 text-center text-xs text-sub">
                        {MEAL_LABELS[meal]}
                      </span>
                      <ul className="flex min-w-0 flex-1 flex-col gap-1.5">
                        {items.map((p, i) => (
                          <li
                            key={p.id}
                            className="flex min-h-11 items-center rounded-xl"
                            style={{ background: categoryTint(p.category) }}
                          >
                            <button
                              type="button"
                              onClick={() => nav(`/recipes/${p.recipeId}`)}
                              className="min-h-11 min-w-0 flex-1 px-3 py-2 text-left text-sm leading-snug font-bold"
                            >
                              {p.title}
                            </button>
                            {!past && (
                              <>
                                {i > 0 ? (
                                  <IconButton
                                    label={`「${p.title}」を上へ`}
                                    disabled={move.isPending}
                                    onClick={() =>
                                      move.mutate({ id: p.id, direction: "up" })
                                    }
                                  >
                                    <ChevronUp className="size-4" />
                                  </IconButton>
                                ) : (
                                  <span className="size-11 shrink-0" />
                                )}
                                {i < items.length - 1 ? (
                                  <IconButton
                                    label={`「${p.title}」を下へ`}
                                    disabled={move.isPending}
                                    onClick={() =>
                                      move.mutate({
                                        id: p.id,
                                        direction: "down",
                                      })
                                    }
                                  >
                                    <ChevronDown className="size-4" />
                                  </IconButton>
                                ) : (
                                  <span className="size-11 shrink-0" />
                                )}
                                <IconButton
                                  label={`「${p.title}」を${slot}から外す`}
                                  disabled={remove.isPending}
                                  onClick={() => remove.mutate(p.id)}
                                >
                                  <X className="size-4" />
                                </IconButton>
                              </>
                            )}
                          </li>
                        ))}
                        {!past && (
                          <li>
                            <button
                              type="button"
                              aria-label={`${slot} に品を追加`}
                              disabled={add.isPending}
                              onClick={() => {
                                if (adding)
                                  add.mutate({
                                    date: d,
                                    meal,
                                    recipeId: adding,
                                  });
                                else setPicker({ date: d, meal });
                              }}
                              className={cn(
                                "flex min-h-11 w-full items-center justify-center gap-1 rounded-xl border-[1.5px] border-dashed text-sm",
                                adding
                                  ? "border-accent bg-[#fbeee8] text-accent-deep"
                                  : "border-[#d6cdc1] text-faint",
                              )}
                            >
                              <Plus className="size-4" />
                              品を追加
                            </button>
                          </li>
                        )}
                        {past && items.length === 0 && (
                          <li className="flex min-h-11 items-center px-3 text-xs text-faint">
                            なし
                          </li>
                        )}
                      </ul>
                    </div>
                  );
                })}
              </section>
            );
          })}
      </div>

      {picker && (
        <RecipePicker
          label={`${labelDate(picker.date).md}（${labelDate(picker.date).dow}）${MEAL_LABELS[picker.meal]}`}
          error={add.error?.message ?? null}
          onClose={() => setPicker(null)}
          onPick={(id) => add.mutate({ ...picker, recipeId: id })}
        />
      )}
    </>
  );
}

function RecipePicker({
  label,
  error,
  onClose,
  onPick,
}: {
  label: string;
  error?: string | null;
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
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
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

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-11 shrink-0 items-center justify-center text-[#4a433c] disabled:opacity-40"
    >
      {children}
    </button>
  );
}
