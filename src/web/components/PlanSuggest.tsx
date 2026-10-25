import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { apiClient, type PlanSuggestionView } from "@/api/client";
import { Chip, PrimaryButton, SecondaryButton } from "@/components/common";
import { MEAL_LABELS, MEALS, type Meal } from "../../shared/constants";
import { labelDate } from "../../shared/dates";

const DAYS = [
  { days: 1, label: "今日だけ" },
  { days: 3, label: "3日分" },
  { days: 7, label: "1週間分" },
] as const;

/**
 * 保存しているレシピから、AI に献立を考えてもらう（#15 / DEC-028）。
 * 案は選んだものだけ献立に入れる（勝手に入れない）
 */
export function PlanSuggest() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<number>(3);
  const [meals, setMeals] = useState<Meal[]>(["dinner"]);
  const [wish, setWish] = useState("");
  /** 選んだ品（"日付|食事|レシピ"） */
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const ask = useMutation({
    mutationFn: () => apiClient.suggestPlan({ days, meals, wish }),
    onSuccess: (r) =>
      setPicked(
        new Set(
          r.suggestions.flatMap((s) =>
            s.recipes.map((x) => `${s.date}|${s.meal}|${x.id}`),
          ),
        ),
      ),
  });
  const save = useMutation({
    mutationFn: async (
      rows: { date: string; meal: Meal; recipeId: string }[],
    ) => {
      // 1品ずつ足す（同じ枠に同じレシピがあれば API が何もしない）
      for (const r of rows) await apiClient.addPlan(r.date, r.meal, r.recipeId);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["plans"] });
      void qc.invalidateQueries({ queryKey: ["shopping"] });
    },
    onSuccess: () => {
      ask.reset();
      setOpen(false);
    },
  });

  if (!open)
    return (
      <SecondaryButton
        type="button"
        onClick={() => setOpen(true)}
        className="h-11 text-sm"
      >
        <Sparkles className="size-4 text-accent" />
        AI に献立を考えてもらう（無料）
      </SecondaryButton>
    );

  const toggleMeal = (m: Meal) =>
    setMeals(
      meals.includes(m)
        ? meals.filter((x) => x !== m)
        : MEALS.filter((x) => x === m || meals.includes(x)),
    );
  const toggle = (key: string) => {
    const next = new Set(picked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPicked(next);
  };
  const suggestions: PlanSuggestionView[] = ask.data?.suggestions ?? [];

  return (
    <section
      aria-label="AI の献立の提案"
      className="flex flex-col gap-3 rounded-2xl border border-field bg-card p-3.5"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold">AI に献立を考えてもらう</h2>
        <button
          type="button"
          className="min-h-11 px-2 text-xs text-sub underline"
          onClick={() => {
            setOpen(false);
            ask.reset();
          }}
        >
          閉じる
        </button>
      </div>
      <p className="text-xs leading-5 text-sub">
        保存しているレシピの中から、冷蔵庫の期限が近い食材や、最近作ったものを見て組みます。新しいレシピは作りません。
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="何日分">
        {DAYS.map((d) => (
          <Chip
            key={d.days}
            on={days === d.days}
            onClick={() => setDays(d.days)}
          >
            {d.label}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="どの食事">
        {MEALS.map((m) => (
          <Chip key={m} on={meals.includes(m)} onClick={() => toggleMeal(m)}>
            {MEAL_LABELS[m]}
          </Chip>
        ))}
      </div>
      <label className="flex flex-col gap-1 text-xs font-bold">
        希望（任意）
        <input
          value={wish}
          onChange={(e) => setWish(e.target.value)}
          maxLength={100}
          placeholder="例：野菜多めで・鶏肉を使い切りたい"
          className="h-11 rounded-xl border border-field bg-card px-3 text-sm font-normal"
        />
      </label>
      <PrimaryButton
        type="button"
        disabled={ask.isPending || !meals.length}
        onClick={() => ask.mutate()}
        className="h-11 text-sm"
      >
        {ask.isPending ? "AI が考えています…" : "考えてもらう"}
      </PrimaryButton>
      {ask.isError && (
        <p role="alert" className="text-sm text-danger">
          {ask.error.message}
        </p>
      )}

      {ask.data && !suggestions.length && (
        <p role="status" className="text-sm text-sub">
          合う組み合わせが見つかりませんでした。希望を変えるか、レシピを増やしてから試してください。
        </p>
      )}
      {suggestions.length > 0 && (
        <div className="flex flex-col gap-3">
          {suggestions.map((s) => (
            <fieldset
              key={`${s.date}|${s.meal}`}
              className="flex flex-col gap-1 border-t border-line-soft pt-2"
            >
              <legend className="text-xs font-bold">
                {labelDate(s.date).md}（{labelDate(s.date).dow}）{" "}
                {MEAL_LABELS[s.meal]}
              </legend>
              {s.reason && (
                <p className="text-xs leading-5 text-sub">{s.reason}</p>
              )}
              {s.recipes.map((r) => {
                const key = `${s.date}|${s.meal}|${r.id}`;
                return (
                  <label
                    key={r.id}
                    className="flex min-h-11 items-center gap-2.5 text-sm"
                  >
                    <input
                      type="checkbox"
                      className="size-5 shrink-0 accent-accent"
                      checked={picked.has(key)}
                      onChange={() => toggle(key)}
                    />
                    <span>
                      {r.title}
                      <span className="ml-1 text-xs text-sub">
                        {r.category}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          ))}
          <PrimaryButton
            type="button"
            disabled={!picked.size || save.isPending}
            onClick={() =>
              save.mutate(
                [...picked].map((k) => {
                  const [date, meal, recipeId] = k.split("|") as [
                    string,
                    Meal,
                    string,
                  ];
                  return { date, meal, recipeId };
                }),
              )
            }
            className="h-11 text-sm"
          >
            {save.isPending
              ? "入れています…"
              : `選んだ ${picked.size} 品を献立に入れる`}
          </PrimaryButton>
          {save.isError && (
            <p role="alert" className="text-sm text-danger">
              {save.error.message}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
