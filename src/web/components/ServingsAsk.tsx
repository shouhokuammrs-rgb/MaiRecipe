import { useEffect, useRef, useState } from "react";
import { useSetServings } from "@/lib/servings";

const CHOICES = [1, 2, 3, 4, 5, 6];
/** 押してから保存するまでの間（この間は取り消せる） */
const UNDO_MS = 5000;

/**
 * 元のレシピを探しても人数が分からなかったときだけ出す、人数の入力（DEC-039）。
 * 押すと数秒後に保存する（新しい版は作らない）。保存したあとは直せないので、その間は取り消せる。
 * 7人分以上は編集画面で入れる
 */
export function ServingsAsk({ recipeId }: { recipeId: string }) {
  const set = useSetServings(recipeId);
  const [picked, setPicked] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<number | null>(null);
  const save = set.mutate;

  const commit = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const n = pending.current;
    pending.current = null;
    if (n !== null) save(n);
  };
  const choose = (n: number) => {
    if (timer.current) clearTimeout(timer.current);
    pending.current = n;
    setPicked(n);
    timer.current = setTimeout(commit, UNDO_MS);
  };
  const undo = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
    setPicked(null);
  };
  // 取り消さずに画面を離れたら、そのまま保存する（押した人数を失わない）
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });
  useEffect(() => () => commitRef.current(), []);

  const waiting =
    picked !== null && !set.isPending && !set.isError && !set.isSuccess;
  return (
    <div
      role="group"
      aria-label="何人分のレシピか"
      className="flex flex-col gap-2 rounded-xl bg-memo px-3 py-2.5"
    >
      {waiting ? (
        <div className="flex items-center justify-between gap-2">
          <p role="status" className="text-xs leading-5 text-ink">
            {picked}人分で保存します。
          </p>
          <button
            type="button"
            onClick={undo}
            className="h-11 shrink-0 rounded-full border border-field bg-card px-4 text-[13px] font-bold"
          >
            取り消す
          </button>
        </div>
      ) : set.isPending || set.isSuccess ? null : (
        <>
          <p className="text-xs leading-5 text-ink">
            このレシピは人数が分かっていません。何人分のレシピですか？
          </p>
          <div className="flex flex-wrap gap-2">
            {CHOICES.map((n) => (
              <button
                key={n}
                type="button"
                disabled={set.isPending}
                onClick={() => choose(n)}
                aria-label={`${n}人分にする`}
                className="h-11 min-w-11 rounded-full border border-field bg-card px-2 text-[13px] font-bold disabled:opacity-50"
              >
                {n}
              </button>
            ))}
          </div>
        </>
      )}
      {(set.isPending || set.isSuccess) && (
        <p role="status" className="text-xs text-sub">
          {set.isPending ? "保存しています…" : `${picked}人分で保存しました。`}
        </p>
      )}
      {set.isError && (
        <p role="alert" className="text-xs text-accent">
          保存できませんでした。通信を確かめて、もう一度押してください。
        </p>
      )}
    </div>
  );
}
