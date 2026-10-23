import { Minus, Plus } from "lucide-react";
import { SERVINGS_MAX, SERVINGS_MIN } from "../../shared/servings";

/**
 * 「材料 [−] 4人分 [+]」。人数を変えると分量を換算して見せる（保存はしない）。
 * base：レシピが何人分か（分からなければ換算しない）
 */
export function ServingsControl({
  base,
  people,
  onChange,
  household,
}: {
  base: number | null;
  people: number;
  onChange: (n: number) => void;
  household: number | null;
}) {
  if (!base)
    return (
      <span className="text-xs font-normal text-sub">何人分か分かりません</span>
    );
  const btn =
    "flex size-11 items-center justify-center rounded-full text-ink disabled:text-faint";
  return (
    <span className="flex flex-wrap items-center gap-x-1 text-sm font-normal">
      <button
        type="button"
        className={btn}
        aria-label="1人分へらす"
        disabled={people <= SERVINGS_MIN}
        onClick={() => onChange(people - 1)}
      >
        <Minus className="size-4" />
      </button>
      <span className="min-w-[4.5em] text-center font-bold" aria-live="polite">
        {people}人分
      </span>
      <button
        type="button"
        className={btn}
        aria-label="1人分ふやす"
        disabled={people >= SERVINGS_MAX}
        onClick={() => onChange(people + 1)}
      >
        <Plus className="size-4" />
      </button>
      {people !== base ? (
        <button
          type="button"
          className="h-11 px-2 text-xs text-sub underline"
          onClick={() => onChange(base)}
        >
          元の{base}人分に戻す
        </button>
      ) : (
        household &&
        household !== base && (
          <button
            type="button"
            className="h-8 rounded-full border border-field bg-card px-3 text-xs"
            onClick={() => onChange(household)}
          >
            {household}人分にする
          </button>
        )
      )}
    </span>
  );
}
