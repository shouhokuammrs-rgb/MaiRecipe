import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useState } from "react";
import { apiClient } from "@/api/client";
import {
  Empty,
  ErrorState,
  Loading,
  PrimaryButton,
  SecondaryButton,
  SubHeader,
} from "@/components/common";
import { useImportJobs, useRereadQueue } from "@/lib/importJobs";
import { apiErrorMessage, cn } from "@/lib/utils";

/**
 * まとめて読み直す（DEC-037）。読み取りの機能が良くなったあと、前に取り込んだレシピを出典からもう一度読む。
 * 裏で2件ずつ進み、今までと違う内容が読めたものだけ「確かめる」に出る（勝手には保存しない）
 */
export function Reread() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["reread-candidates"],
    queryFn: apiClient.rereadCandidates,
  });
  const queued = useRereadQueue().data ?? 0;
  const running =
    useImportJobs().data?.filter((j) => j.status === "running").length ?? 0;
  /** 外したレシピ（はじめは全部選んである） */
  const [off, setOff] = useState<Set<string>>(new Set());
  const [started, setStarted] = useState<number | null>(null);

  const all = q.data?.recipes ?? [];
  const picked = all.filter((r) => !off.has(r.id));
  const busy = queued > 0;

  const start = useMutation({
    mutationFn: () => apiClient.rereadMany(picked.map((r) => r.id)),
    onSuccess: (r) => {
      setStarted(r.queued);
      void qc.invalidateQueries({ queryKey: ["import-jobs"] });
    },
  });
  const stop = useMutation({
    mutationFn: apiClient.stopRereadQueue,
    onSuccess: () => setStarted(null),
    onSettled: () => qc.invalidateQueries({ queryKey: ["import-jobs"] }),
  });

  const toggle = (id: string) => {
    const next = new Set(off);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOff(next);
  };

  return (
    <>
      <SubHeader title="まとめて読み直す" back="/settings" />
      <div className="flex flex-col gap-3 px-5 pt-4 pb-10">
        <p className="text-[13px] leading-6 text-sub">
          出典のあるレシピを、今の読み取りでもう一度読みます。裏で2件ずつ進むので、アプリを閉じても大丈夫です。
          今までと違う内容が読めたものだけ、画面の下に「確かめる」が出ます。確かめて保存すると新しい版になり、前の版は残ります。
        </p>

        {(busy || started !== null) && (
          <div
            role="status"
            className="flex flex-col gap-2 rounded-2xl bg-herb-soft p-3.5 text-[13px] text-herb"
          >
            {busy ? (
              <>
                <span className="font-bold">
                  読み直しています（読み取り中 {running}件・あと{queued}件待ち）
                </span>
                <SecondaryButton
                  disabled={stop.isPending}
                  onClick={() => stop.mutate()}
                >
                  残りをやめる
                </SecondaryButton>
                {stop.isError && (
                  <span role="alert" className="text-danger">
                    {apiErrorMessage(stop.error)}
                  </span>
                )}
              </>
            ) : (
              <span>
                {started
                  ? `${started}件の読み直しを始めました。${running ? `あと${running}件を読み取り中です。` : "全部読み終わりました。"}変わっていなかったレシピは、何も出ません。`
                  : "読み直すものはありませんでした（もう読み直し中か、出典がありません）。"}
              </span>
            )}
          </div>
        )}

        {q.isPending ? (
          <Loading />
        ) : q.isError ? (
          <ErrorState error={q.error} retry={() => void q.refetch()} />
        ) : all.length === 0 ? (
          <Empty>
            出典のあるレシピがまだありません。URL
            や動画から取り込んだレシピがここに出ます。
          </Empty>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[13px] font-bold text-sub">
                読み直すレシピ（{picked.length} / {all.length}）
              </h2>
              <button
                type="button"
                onClick={() =>
                  setOff(
                    picked.length === all.length
                      ? new Set(all.map((r) => r.id))
                      : new Set(),
                  )
                }
                className="flex h-11 items-center rounded-full border border-field bg-card px-3 text-xs"
              >
                {picked.length === all.length ? "全部外す" : "全部選ぶ"}
              </button>
            </div>
            <ul className="overflow-hidden rounded-2xl border border-line-soft bg-card">
              {all.map((r) => {
                const on = !off.has(r.id);
                return (
                  <li
                    key={r.id}
                    className="border-b border-[#f3eee7] last:border-b-0"
                  >
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => toggle(r.id)}
                      className="flex min-h-12 w-full items-center gap-3 px-3.5 py-2 text-left"
                    >
                      <span
                        className={cn(
                          "flex size-6 shrink-0 items-center justify-center rounded-md border-2",
                          on
                            ? "border-herb-mid bg-herb-mid text-white"
                            : "border-[#d3c8ba] bg-card",
                        )}
                      >
                        {on && <Check className="size-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px]">
                          {r.title}
                        </span>
                        {r.versions > 1 && (
                          <span className="block text-[11.5px] text-sub">
                            直した版があります（{r.versions}
                            版）。読み直しは新しい版として上に積まれます
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {start.isError && (
              <p role="alert" className="text-sm text-danger">
                {apiErrorMessage(start.error)}
              </p>
            )}
            <PrimaryButton
              className="h-12"
              disabled={start.isPending || busy || picked.length === 0}
              onClick={() => start.mutate()}
            >
              {start.isPending
                ? "始めています…"
                : busy
                  ? "読み直し中です"
                  : `${picked.length}件を読み直す`}
            </PrimaryButton>
            <p className="text-xs leading-6 text-sub">
              動画のレシピは AI が動画を見直すので、1件に数分かかります。AI
              の1日の枠に当たると、残りは「読み取れませんでした」と出ます。その分は次の日にもう一度読み直してください。
            </p>
          </>
        )}
      </div>
    </>
  );
}
