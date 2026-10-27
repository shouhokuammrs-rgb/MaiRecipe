import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiClient, type Rating } from "@/api/client";
import { Chip, PrimaryButton } from "@/components/common";
import { apiErrorMessage, cn } from "@/lib/utils";
import { pantryUsedBy, RATING_LABELS, RATINGS } from "../../shared/cooked";

/**
 * 作った！（DEC-030）。作った記録は2人のもの、誰が食べたか・評価は本人のもの。
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
}) {
  const qc = useQueryClient();
  const group = useQuery({ queryKey: ["group"], queryFn: apiClient.group });
  const pantry = useQuery({ queryKey: ["pantry"], queryFn: apiClient.pantry });
  const [count, setCount] = useState(servings ?? 2);
  const [rating, setRating] = useState<Rating | null>(null);
  const [note, setNote] = useState("");
  /** 食べた人（userId → 何人前） */
  const [eaters, setEaters] = useState<Map<string, number> | null>(null);
  const [used, setUsed] = useState<Set<string> | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const members = group.data?.members ?? [];
  // 既定は全員が1人前
  const eatersNow =
    eaters ?? new Map(members.map((m) => [m.id, 1] as [string, number]));
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

  const toggleEater = (id: string) => {
    const next = new Map(eatersNow);
    if (next.has(id)) next.delete(id);
    else next.set(id, 1);
    setEaters(next);
  };
  const setPortion = (id: string, portion: number) => {
    const next = new Map(eatersNow);
    next.set(id, portion);
    setEaters(next);
  };
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
          <span className="text-sm font-bold">誰が食べた？</span>
          {group.isPending && <p className="text-xs text-sub">読み込み中…</p>}
          {group.isError && (
            <p role="alert" className="text-xs text-danger">
              {apiErrorMessage(group.error)}
            </p>
          )}
          <ul className="flex flex-col gap-1.5">
            {members.map((m) => {
              const on = eatersNow.has(m.id);
              const portion = eatersNow.get(m.id) ?? 1;
              return (
                <li key={m.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleEater(m.id)}
                    className={cn(
                      "flex min-h-11 flex-1 items-center gap-2 rounded-xl border px-3 text-left text-sm",
                      on
                        ? "border-herb-mid bg-herb-soft font-bold text-herb"
                        : "border-field bg-card text-sub",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-6 items-center justify-center rounded-full text-xs font-bold text-white",
                        on ? "bg-herb-mid" : "bg-[#cfc5b8]",
                      )}
                    >
                      {m.name.slice(0, 1)}
                    </span>
                    {m.name}
                    {m.isMe ? "（自分）" : ""}
                    {!on && (
                      <span className="ml-auto text-xs">食べていない</span>
                    )}
                  </button>
                  {on && (
                    <select
                      aria-label={`${m.name}の人前`}
                      value={portion}
                      onChange={(e) => setPortion(m.id, Number(e.target.value))}
                      className="h-11 rounded-xl border border-field bg-card px-2 text-sm"
                    >
                      {[0.5, 1, 1.5, 2, 3].map((p) => (
                        <option key={p} value={p}>
                          {p}人前
                        </option>
                      ))}
                    </select>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-[11.5px] text-sub">
            食べた記録は、それぞれ本人だけに見えます
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-bold">どうだった？（任意）</span>
          <div className="flex flex-wrap gap-2" role="group" aria-label="評価">
            {RATINGS.map((r) => (
              <Chip
                key={r}
                on={rating === r}
                onClick={() => setRating(rating === r ? null : r)}
              >
                {RATING_LABELS[r]}
              </Chip>
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
                  <Chip on={usedNow.has(c.id)} onClick={() => toggleUsed(c.id)}>
                    {c.name}
                  </Chip>
                </li>
              ))}
            </ul>
            <p className="text-[11.5px] text-sub">
              まだ残っているものは外してください
            </p>
          </div>
        )}

        {save.isError && (
          <p role="alert" className="text-sm text-danger">
            {apiErrorMessage(save.error)}
          </p>
        )}
        <PrimaryButton
          type="button"
          disabled={save.isPending || group.isPending}
          onClick={() => save.mutate()}
          className="h-12"
        >
          {save.isPending ? "残しています…" : "記録を残す"}
        </PrimaryButton>
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 text-sm text-sub underline"
        >
          {closeLabel}
        </button>
      </div>
    </div>
  );
}
