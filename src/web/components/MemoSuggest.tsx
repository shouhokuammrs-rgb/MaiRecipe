import { useMutation } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { apiClient } from "@/api/client";
import { SecondaryButton } from "@/components/common";
import type { MemoChange } from "../../shared/memo-apply";

/** 変更案1つを、人が読める1行にする */
function describe(
  c: MemoChange,
  ings: { name: string; amount: string }[],
): string {
  if (c.kind === "ingredient") {
    if (c.action === "update") {
      const before = ings[c.index - 1];
      // 名前が同じなら分量だけ（「砂糖 大さじ2 → 大さじ1」）
      return before?.name === c.name
        ? `材料${c.index}：${c.name} ${before.amount} → ${c.amount}`.trim()
        : `材料${c.index}：${before?.name ?? ""} → ${c.name} ${c.amount}`.trim();
    }
    if (c.action === "remove")
      return `材料${c.index}「${ings[c.index - 1]?.name ?? ""}」を消す`;
    return `材料を足す：${c.name} ${c.amount}`.trim();
  }
  if (c.kind === "step") {
    if (c.action === "update") return `手順${c.index}を「${c.text}」に`;
    if (c.action === "remove") return `手順${c.index}を消す`;
    return c.after === 0
      ? `最初に手順を足す：${c.text}`
      : c.after
        ? `手順${c.after}の後に足す：${c.text}`
        : `最後に手順を足す：${c.text}`;
  }
  return `${c.step ? `手順${c.step}の` : ""}コツを足す：${c.text}`;
}

/**
 * メモから AI に変更案を出してもらい、選んだものだけを下の編集欄に入れる（#23 / DEC-027）。
 * メモの言葉に基づく案と、AI の推測（メモに無いこと）を分けて見せる。保存は下の編集欄から
 */
export function MemoSuggest({
  recipeId,
  memoId,
  ingredients,
  onApply,
}: {
  recipeId: string;
  memoId: string;
  ingredients: { name: string; amount: string }[];
  onApply: (changes: MemoChange[]) => void;
}) {
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [applied, setApplied] = useState(false);
  const ask = useMutation({
    mutationFn: () => apiClient.suggestMemoChanges(recipeId, memoId),
    onSuccess: (r) => {
      // メモに基づく案だけ、最初から選んでおく（AI の推測は自分で選ぶ）
      setPicked(new Set(r.changes.flatMap((c, k) => (c.grounded ? [k] : []))));
      setApplied(false);
    },
  });

  if (!ask.data)
    return (
      <div className="flex flex-col gap-1.5">
        <SecondaryButton
          type="button"
          disabled={ask.isPending}
          onClick={() => ask.mutate()}
          className="h-11 text-sm"
        >
          <Sparkles className="size-4 text-accent" />
          {ask.isPending
            ? "AI が考えています…"
            : "AI に変更案を出してもらう（無料）"}
        </SecondaryButton>
        {ask.isError && (
          <p role="alert" className="text-xs text-danger">
            {ask.error.message}
          </p>
        )}
      </div>
    );

  const changes = ask.data.changes;
  if (!changes.length)
    return (
      <p role="status" className="text-xs leading-5 text-sub">
        AI
        はこのメモから変更案を見つけられませんでした。下で手で直してください。
      </p>
    );

  const toggle = (k: number) => {
    const next = new Set(picked);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setPicked(next);
  };

  return (
    <fieldset className="flex flex-col gap-2 rounded-xl border border-field bg-card p-3">
      <legend className="px-1 text-xs font-bold">AI の変更案</legend>
      <ul className="flex flex-col gap-1">
        {changes.map((c, k) => (
          <li key={k}>
            <label className="flex min-h-11 items-start gap-2.5 py-1.5 text-sm leading-6">
              <input
                type="checkbox"
                className="mt-1 size-5 shrink-0 accent-accent"
                checked={picked.has(k)}
                disabled={applied}
                onChange={() => toggle(k)}
              />
              <span className="flex flex-col">
                <span>{describe(c, ingredients)}</span>
                <span className="text-xs text-sub">
                  {c.grounded ? (
                    <>
                      <span className="mr-1 rounded bg-herb-soft px-1.5 text-herb">
                        メモより
                      </span>
                      「{c.quote}」
                    </>
                  ) : (
                    <span className="rounded bg-memo px-1.5 text-memo-ink">
                      AI の推測（メモには無い）
                    </span>
                  )}
                  {c.reason && ` ${c.reason}`}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {applied ? (
        <p role="status" className="text-xs leading-5 text-herb">
          選んだ変更を下の編集欄に入れました。確かめてから保存してください。
        </p>
      ) : (
        <SecondaryButton
          type="button"
          disabled={!picked.size}
          onClick={() => {
            onApply(changes.filter((_, k) => picked.has(k)));
            setApplied(true);
          }}
          className="h-11 text-sm"
        >
          選んだ {picked.size} 件を下の編集欄に入れる
        </SecondaryButton>
      )}
    </fieldset>
  );
}
