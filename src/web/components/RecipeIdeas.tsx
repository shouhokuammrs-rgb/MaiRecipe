import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient, type RecipeFields } from "@/api/client";
import { PrimaryButton, SecondaryButton } from "@/components/common";

/**
 * 選んだ食材で、AI に新しいレシピを考えてもらう（#15 / DEC-029）。
 * 出典の無いレシピなので「AI が考えたレシピ」として分けて保存する。保存は人が選んだときだけ
 */
export function RecipeIdeas({ terms }: { terms: string[] }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [wish, setWish] = useState("");
  const ask = useMutation({
    mutationFn: () => apiClient.recipeIdeas({ use: terms, wish }),
  });
  const save = useMutation({
    mutationFn: (idea: RecipeFields) =>
      apiClient.createRecipe({
        ...idea,
        sourceUrl: null,
        videoUrl: null,
        origin: "ai",
      }),
    onSuccess: async ({ id }) => {
      await qc.invalidateQueries({ queryKey: ["recipes"] });
      nav(`/recipes/${id}`);
    },
  });
  const ideas = ask.data?.ideas ?? [];

  return (
    <section
      aria-label="AI が考えるレシピ"
      className="flex flex-col gap-3 rounded-2xl border border-field bg-card p-3.5"
    >
      <h2 className="flex items-center gap-1.5 text-sm font-bold">
        <Sparkles className="size-4 text-accent" />
        AI に新しいレシピを考えてもらう（無料）
      </h2>
      <p className="text-xs leading-5 text-sub">
        「{terms.join("・")}」で作れる料理を、AI
        が3つまで考えます。出典の無いレシピなので、分量や火の通りは確かめてから作ってください。
      </p>
      <label className="flex flex-col gap-1 text-xs font-bold">
        希望（任意）
        <input
          value={wish}
          onChange={(e) => setWish(e.target.value)}
          maxLength={100}
          placeholder="例：15分くらいで・子どもも食べられる味"
          className="h-11 rounded-xl border border-field bg-card px-3 text-sm font-normal"
        />
      </label>
      <SecondaryButton
        type="button"
        disabled={ask.isPending}
        onClick={() => {
          save.reset();
          ask.mutate();
        }}
        className="h-11 text-sm"
      >
        {ask.isPending
          ? "AI が考えています…（20秒ほど）"
          : ask.data
            ? "別の案を考えてもらう"
            : "考えてもらう"}
      </SecondaryButton>
      {ask.isError && (
        <p role="alert" className="text-sm leading-6 text-danger">
          {ask.error.message}
        </p>
      )}
      {ideas.length > 0 && (
        <ul className="flex flex-col gap-2.5">
          {ideas.map((idea, k) => (
            <li
              key={`${k}-${idea.title}`}
              className="flex flex-col gap-2 rounded-xl border border-line-soft p-3"
            >
              <div>
                <p className="text-[15px] font-bold">{idea.title}</p>
                <p className="text-[11.5px] text-sub">
                  {idea.category}・{idea.genre}
                  {idea.servings ? `・${idea.servings}人分` : ""}
                  {idea.timeLabel ? `・${idea.timeLabel}` : ""}
                  ・AI が考えたレシピ（出典なし）
                </p>
              </div>
              <details className="text-[13px] leading-6">
                <summary className="flex min-h-11 cursor-pointer items-center font-bold text-accent-deep">
                  材料と作り方を見る
                </summary>
                <ul className="mt-1">
                  {idea.ingredients.map((i, n) => (
                    <li key={n} className="flex justify-between gap-3">
                      <span>{i.name}</span>
                      <span className="text-sub">{i.amount}</span>
                    </li>
                  ))}
                </ul>
                <ol className="mt-2 list-decimal pl-5">
                  {idea.steps.map((s, n) => (
                    <li key={n}>{s}</li>
                  ))}
                </ol>
              </details>
              <PrimaryButton
                type="button"
                disabled={save.isPending}
                onClick={() => save.mutate(idea)}
                className="h-11 text-sm"
              >
                {save.isPending && save.variables === idea
                  ? "保存しています…"
                  : "このレシピを保存する"}
              </PrimaryButton>
            </li>
          ))}
        </ul>
      )}
      {save.isError && (
        <p role="alert" className="text-sm text-danger">
          {save.error.message}
        </p>
      )}
    </section>
  );
}
