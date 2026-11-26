import { useSetServings } from "@/lib/servings";

const CHOICES = [1, 2, 3, 4, 5, 6];

/**
 * 元のレシピを探しても人数が分からなかったときだけ出す、人数の入力（DEC-039）。
 * 押すとその場で保存する（新しい版は作らない）。7人分以上は編集画面で入れる
 */
export function ServingsAsk({ recipeId }: { recipeId: string }) {
  const set = useSetServings(recipeId);
  return (
    <div
      role="group"
      aria-label="何人分のレシピか"
      className="flex flex-col gap-2 rounded-xl bg-memo px-3 py-2.5"
    >
      <p className="text-xs leading-5 text-ink">
        このレシピは人数が分かっていません。何人分のレシピですか？
      </p>
      <div className="flex flex-wrap gap-1.5">
        {CHOICES.map((n) => (
          <button
            key={n}
            type="button"
            disabled={set.isPending}
            onClick={() => set.mutate(n)}
            aria-label={`${n}人分にする`}
            className="h-11 min-w-11 rounded-full border border-field bg-card px-2 text-[13px] font-bold disabled:opacity-50"
          >
            {n}
          </button>
        ))}
      </div>
      {set.isPending && (
        <p role="status" className="text-xs text-sub">
          保存しています…
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
