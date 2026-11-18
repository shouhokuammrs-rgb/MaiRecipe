import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiClient, type Rating } from "@/api/client";
import { PrimaryButton } from "@/components/common";
import { apiErrorMessage, cn } from "@/lib/utils";
import { pantryUsedBy, RATING_LABELS, RATINGS } from "../../shared/cooked";

/**
 * 作った！（DEC-030）。作った記録は2人のもの、評価は本人のもの。
 * 使った食材は冷蔵庫の候補から選んだものだけ消す
 */
export function CookedSheet({
  recipeId,
  versionId,
  title,
  servings,
  ingredients,
  onClose,
  onDone,
  closeLabel = "やめる",
  onCancel,
}: {
  recipeId: string;
  versionId: string | null;
  title: string;
  /** 作った人数の初期値（レシピの人数か、料理モードで選んだ人数） */
  servings: number | null;
  ingredients: { name: string }[];
  onClose: () => void;
  onDone: (msg: string) => void;
  /** 閉じるボタンの文言（料理モードでは「記録せずに戻る」） */
  closeLabel?: string;
  /** 閉じるボタンを押したとき（省くと onClose。背景タップと Esc はいつも onClose） */
  onCancel?: () => void;
}) {
  const qc = useQueryClient();
  const group = useQuery({ queryKey: ["group"], queryFn: apiClient.group });
  const pantry = useQuery({ queryKey: ["pantry"], queryFn: apiClient.pantry });
  const [count, setCount] = useState(servings ?? 2);
  const [rating, setRating] = useState<Rating | null>(null);
  const [note, setNote] = useState("");
  const [used, setUsed] = useState<Set<string> | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const members = group.data?.members ?? [];
  // 誰が食べたかは聞かず、全員が1人前で残す（食べた記録の画面は隠している。DEC-035）
  const eatersNow = new Map(members.map((m) => [m.id, 1] as [string, number]));
  const candidates = pantryUsedBy(ingredients, pantry.data?.items ?? []);
  const usedNow = used ?? new Set(candidates.map((c) => c.id));

  const save = useMutation({
    mutationFn: () =>
      apiClient.addCooked(recipeId, {
        versionId,
        servings: count,
        eaters: [...eatersNow].map(([userId, portion]) => ({
          userId,
          portion,
        })),
        rating,
        note: note.trim(),
        usedPantryIds: candidates
          .map((c) => c.id)
          .filter((id) => usedNow.has(id)),
      }),
    onSuccess: () => {
      const n = candidates.filter((c) => usedNow.has(c.id)).length;
      onDone(
        n
          ? `作った記録を残し、${n}個を冷蔵庫から使い切りにしました`
          : "作った記録を残しました",
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["recipe", recipeId] });
      qc.invalidateQueries({ queryKey: ["recipes"] });
      qc.invalidateQueries({ queryKey: ["pantry"] });
      qc.invalidateQueries({ queryKey: ["shopping"] });
      qc.invalidateQueries({ queryKey: ["recommend"] });
      qc.invalidateQueries({ queryKey: ["meals"] });
    },
  });

  const toggleUsed = (id: string) => {
    const next = new Set(usedNow);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setUsed(next);
  };

  return (
    <div
      className="fixed inset-0 z-20 flex flex-col justify-end bg-ink/45"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="作った！"
        className="mx-auto flex max-h-[90dvh] w-full max-w-xl flex-col gap-4 overflow-y-auto rounded-t-3xl bg-card px-5 pt-5 pb-[max(env(safe-area-inset-bottom),20px)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-[17px] font-bold">作った！</h2>
          <p className="text-xs text-sub">{title}</p>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm font-bold">何人分作った？</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="減らす"
              onClick={() => setCount((c) => Math.max(1, c - 1))}
              className="flex size-11 items-center justify-center rounded-xl border border-field text-lg"
            >
              −
            </button>
            <span className="w-14 text-center text-base font-bold tabular-nums">
              {count}人分
            </span>
            <button
              type="button"
              aria-label="増やす"
              onClick={() => setCount((c) => Math.min(20, c + 1))}
              className="flex size-11 items-center justify-center rounded-xl border border-field text-lg"
            >
              ＋
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-bold">どうだった？（任意）</span>
          <div className="flex flex-wrap gap-2" role="group" aria-label="評価">
            {RATINGS.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={rating === r}
                onClick={() => setRating(rating === r ? null : r)}
                className={cn(
                  "min-h-11 rounded-full border px-4 text-sm",
                  rating === r
                    ? "border-herb-mid bg-herb-soft font-bold text-herb"
                    : "border-field bg-card text-sub",
                )}
              >
                {RATING_LABELS[r]}
              </button>
            ))}
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            placeholder="ひとこと（例：大根を足した・次は砂糖少なめ）"
            className="h-11 rounded-xl border border-field bg-card px-3 text-sm"
          />
        </div>

        {candidates.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-bold">
              使い切った食材（冷蔵庫から消す）
            </span>
            <ul className="flex flex-wrap gap-2">
              {candidates.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    aria-pressed={usedNow.has(c.id)}
                    onClick={() => toggleUsed(c.id)}
                    className={cn(
                      "min-h-11 rounded-full border px-4 text-sm",
                      usedNow.has(c.id)
                        ? "border-herb-mid bg-herb-soft font-bold text-herb"
                        : "border-field bg-card text-sub",
                    )}
                  >
                    {c.name}
                  </button>
                </li>
              ))}
            </ul>
            <p className="text-[11.5px] text-sub">
              まだ残っているものは外してください
            </p>
          </div>
        )}

        {group.isError && (
          <p role="alert" className="text-sm text-danger">
            {apiErrorMessage(group.error)}
          </p>
        )}
        {save.isError && (
          <p role="alert" className="text-sm text-danger">
            {apiErrorMessage(save.error)}
          </p>
        )}
        <PrimaryButton
          type="button"
          disabled={save.isPending || !group.data}
          onClick={() => save.mutate()}
          className="h-12"
        >
          {save.isPending ? "残しています…" : "記録を残す"}
        </PrimaryButton>
        <button
          type="button"
          onClick={onCancel ?? onClose}
          className="min-h-11 text-sm text-sub underline"
        >
          {closeLabel}
        </button>
      </div>
    </div>
  );
}
