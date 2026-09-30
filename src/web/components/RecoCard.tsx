import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useState } from "react";
import { apiClient } from "@/api/client";
import { ErrorState, Loading, PrimaryButton } from "@/components/common";
import { apiErrorMessage, cn } from "@/lib/utils";
import { addDays, labelDate } from "../../shared/dates";
import {
  firstEmptyDinner,
  pickSet,
  RECO_SLOTS,
  type Reco,
  type RecoSlot,
} from "../../shared/recommend";

type PickedItem = { slot: RecoSlot; reco: Reco };

/** 冷蔵庫の画面のいちばん上に出す「今日のおすすめ」1食セット */
export function RecoCard({ onToast }: { onToast: (msg: string) => void }) {
  const qc = useQueryClient();
  const recoQ = useQuery({
    queryKey: ["recommend"],
    queryFn: apiClient.recommend,
  });
  const today = recoQ.data?.today ?? "";
  const to = today ? addDays(today, 13) : "";
  const plansQ = useQuery({
    queryKey: ["plans", today, to],
    queryFn: () => apiClient.plans(today, to),
    enabled: Boolean(today),
  });

  const [round, setRound] = useState(0);
  const [swaps, setSwaps] = useState<Record<RecoSlot, number>>({
    main: 0,
    side: 0,
    soup: 0,
  });
  const [off, setOff] = useState<RecoSlot[]>([]);
  const [target, setTarget] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: async (vars: { target: string; items: PickedItem[] }) => {
      // 同時に投げると枠の並び順が崩れるので、1つずつ待つ
      for (const item of vars.items) {
        await apiClient.addPlan(vars.target, "dinner", item.reco.id);
      }
    },
    onSuccess: (_d, vars) => {
      const { md, dow } = labelDate(vars.target);
      onToast(
        `${md}（${dow}）の夜に${vars.items.length}品入れました。献立タブで見られます`,
      );
      setOff([]);
      setTarget(null);
    },
    onError: (e) => onToast(apiErrorMessage(e)),
    onSettled: () => {
      // 一部だけ失敗しても（1品目は入って2品目が失敗、など）最新の状態に揃える
      qc.invalidateQueries({ queryKey: ["plans"] });
      qc.invalidateQueries({ queryKey: ["recommend"] });
      qc.invalidateQueries({ queryKey: ["shopping"] });
    },
  });

  if (recoQ.isPending) return <Loading label="おすすめを考えています…" />;
  const reco = recoQ.data;
  if (recoQ.isError || !reco)
    return <ErrorState error={recoQ.error} retry={() => recoQ.refetch()} />;

  const items = pickSet(reco, round, swaps);
  if (items.length === 0) return null;

  const effectiveTarget =
    target ??
    (plansQ.data ? firstEmptyDinner(plansQ.data.plans, today) : today);
  const { md } = labelDate(effectiveTarget);
  const selected = items.filter((i) => !off.includes(i.slot));
  const n = selected.length;
  const busy = add.isPending;
  // 空いている日を献立から読んでいる間は、確定前に入れてしまわないよう待つ
  const plansPending = target === null && plansQ.isPending;
  // どの分類も候補が1つ以下なら、替えても何も変わらない
  const canReshuffle = RECO_SLOTS.some((slot) => reco[slot].length > 1);

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-3.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-bold">今日のおすすめ</h2>
        <button
          type="button"
          disabled={busy || !canReshuffle}
          onClick={() => {
            setRound((r) => r + 1);
            setSwaps({ main: 0, side: 0, soup: 0 });
            setOff([]);
          }}
          className="flex h-11 items-center px-1 text-[13px] font-bold text-accent disabled:opacity-50"
        >
          ⇄ ほかの組み合わせ
        </button>
      </div>

      <ul>
        {items.map(({ slot, reco: item }) => {
          const on = !off.includes(slot);
          const candidates = reco[slot];
          return (
            <li
              key={slot}
              className="flex items-center gap-1 border-b border-line-soft last:border-b-0"
            >
              <button
                type="button"
                aria-pressed={on}
                disabled={busy}
                onClick={() =>
                  setOff((prev) =>
                    prev.includes(slot)
                      ? prev.filter((s) => s !== slot)
                      : [...prev, slot],
                  )
                }
                className="flex min-h-14 min-w-0 flex-1 items-start gap-2.5 py-2.5 text-left disabled:opacity-50"
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-[22px] shrink-0 items-center justify-center rounded-[7px] border-2",
                    on
                      ? "border-herb-mid bg-herb-mid"
                      : "border-[#cfc5b8] bg-card",
                  )}
                >
                  {on && (
                    <Check className="size-3.5 text-white" strokeWidth={3} />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-baseline gap-1.5">
                    <span className="w-7 shrink-0 text-[11px] text-faint">
                      {item.category}
                    </span>
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-[15px] font-bold",
                        !on && "text-faint line-through",
                      )}
                    >
                      {item.title}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "pl-[34px] text-[12px] text-sub",
                      !on && "text-faint line-through",
                    )}
                  >
                    {item.have.length === 0
                      ? "冷蔵庫の食材は使いません"
                      : item.have.map((name, i) => (
                          <span key={name}>
                            {i > 0 && "・"}
                            <span
                              className={cn(
                                on &&
                                  item.soon.includes(name) &&
                                  "font-bold text-danger",
                              )}
                            >
                              {name}
                            </span>
                          </span>
                        ))}
                  </span>
                </span>
              </button>
              <button
                type="button"
                aria-label={`${item.category}を別のレシピに替える`}
                disabled={busy || candidates.length <= 1}
                onClick={() =>
                  setSwaps((prev) => ({ ...prev, [slot]: prev[slot] + 1 }))
                }
                className="flex size-11 shrink-0 items-center justify-center text-[#4a433c] disabled:opacity-30"
              >
                ⇄
              </button>
            </li>
          );
        })}
      </ul>

      <PrimaryButton
        disabled={n === 0 || busy || plansPending}
        onClick={() => add.mutate({ target: effectiveTarget, items: selected })}
      >
        {plansPending
          ? "読み込み中…"
          : n > 0
            ? `${md}の夜に ${n}品入れる`
            : "入れる品を選んでください"}
      </PrimaryButton>

      {plansQ.isError && (
        <p className="text-[11px] text-danger">
          献立の空き状況を読み込めませんでした。‹ › で日付を選べます
        </p>
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          disabled={busy || effectiveTarget === today}
          onClick={() => setTarget(addDays(effectiveTarget, -1))}
          className="flex h-11 items-center px-1 text-[13px] font-bold text-accent disabled:opacity-30"
        >
          ‹ 前の日
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setTarget(addDays(effectiveTarget, 1))}
          className="flex h-11 items-center px-1 text-[13px] font-bold text-accent disabled:opacity-50"
        >
          次の日 ›
        </button>
      </div>
    </div>
  );
}
