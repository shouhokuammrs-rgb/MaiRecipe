import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { RecipeFields } from "@/api/client";
import { Chip, PrimaryButton } from "@/components/common";
import {
  CATEGORIES,
  GENRES,
  type Category,
  type Genre,
} from "../../shared/constants";
import { moveItem } from "../../shared/move";
import { SERVINGS_MAX } from "../../shared/servings";
import { TIP_MAX, TIPS_MAX } from "../../shared/tips";
import { tidyStepTimes } from "../../shared/scenes";

type Row = { key: number; name: string; amount: string };
type TipRow = { key: number; stepKey: number | null; text: string };
let seq = 0;
const row = (name = "", amount = ""): Row => ({ key: ++seq, name, amount });

export type EditorExtras = { sourceUrl: string; videoUrl: string };

/**
 * レシピの材料・作り方を1行ずつ直せるフォーム。新規・取り込み・編集で共通。
 * 編集では今の最新版が最初から入っている。
 */
export function RecipeEditor({
  initial,
  extras,
  banner,
  submitLabel,
  saving,
  error,
  onSubmit,
}: {
  initial: RecipeFields;
  /** 新規のときだけ出典・動画の URL を入れられる（編集では出典を変えない） */
  extras?: EditorExtras;
  banner?: ReactNode;
  submitLabel: string;
  saving: boolean;
  error?: string | null;
  onSubmit: (fields: RecipeFields, extras?: EditorExtras) => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [category, setCategory] = useState<Category>(initial.category);
  const [genre, setGenre] = useState<Genre>(initial.genre);
  const [timeLabel, setTimeLabel] = useState(initial.timeLabel);
  // 0 は「出典にも書いていなかった」。編集画面では「分からない」と同じに扱う
  const [servings, setServings] = useState<number | null>(
    initial.servings || null,
  );
  const [ings, setIngs] = useState<Row[]>(() =>
    initial.ingredients.length
      ? initial.ingredients.map((i) => row(i.name, i.amount))
      : [row(), row(), row()],
  );
  // 動画の場面の時刻も手順の行に持つ（並び替えても、その手順の場面のまま）
  const [steps, setSteps] = useState<
    { key: number; text: string; at?: number | null }[]
  >(() => {
    const times =
      initial.stepTimes?.length === initial.steps.length
        ? initial.stepTimes
        : [];
    return (initial.steps.length ? initial.steps : ["", ""]).map((t, k) => ({
      key: ++seq,
      text: t,
      at: times[k] ?? null,
    }));
  });
  // コツは手順の「行」に付ける（並び替え・削除しても、同じ手順に付いたまま）
  const [tips, setTips] = useState<TipRow[]>(() =>
    (initial.tips ?? []).map((t) => ({
      key: ++seq,
      stepKey: t.step ? (steps[t.step - 1]?.key ?? null) : null,
      text: t.text,
    })),
  );
  const [ex, setEx] = useState<EditorExtras | undefined>(extras);
  const [localError, setLocalError] = useState<string | null>(null);
  // 並び替えの最中だけ ↑↓ を出す（ふだんは入力欄を広く使う）
  const [sorting, setSorting] = useState<"ings" | "steps" | null>(null);

  const submit = () => {
    const fields: RecipeFields = {
      title: title.trim(),
      category,
      genre,
      timeLabel: timeLabel.trim(),
      servings,
      ingredients: ings
        .filter((r) => r.name.trim())
        .map((r) => ({ name: r.name.trim(), amount: r.amount.trim() })),
      steps: steps.map((s) => s.text.trim()).filter(Boolean),
      stepTimes: tidyStepTimes(
        steps.filter((s) => s.text.trim()).map((s) => s.at ?? null),
      ),
      tips: tips
        .filter((t) => t.text.trim())
        .map((t) => {
          // 空の手順は保存しないので、番号は空でない手順の中で数える
          const kept = steps.filter((x) => x.text.trim());
          const at = kept.findIndex((x) => x.key === t.stepKey);
          return { step: at >= 0 ? at + 1 : null, text: t.text.trim() };
        }),
    };
    if (!fields.title) {
      setLocalError("レシピ名を入れてください");
      return;
    }
    setLocalError(null);
    onSubmit(fields, ex);
  };

  const input =
    "h-11 w-full rounded-xl border border-field bg-card px-3.5 text-base outline-none focus:border-ink";

  return (
    <form
      className="flex flex-col gap-5 px-5 pt-4 pb-8"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {banner}
      <label className="flex flex-col gap-1.5 text-[13px] font-bold">
        レシピ名
        <input
          id="recipe-title"
          className={input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: 鶏むね肉の甘酢炒め"
          maxLength={100}
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-[13px] font-bold">カテゴリ</legend>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <Chip key={c} on={category === c} onClick={() => setCategory(c)}>
              {c}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-[13px] font-bold">ジャンル</legend>
        <div className="flex flex-wrap gap-2">
          {GENRES.map((g) => (
            <Chip
              key={g}
              variant="genre"
              on={genre === g}
              onClick={() => setGenre(g)}
            >
              {g}
            </Chip>
          ))}
        </div>
      </fieldset>

      <label className="flex flex-col gap-1.5 text-[13px] font-bold">
        かかる時間（任意）
        <input
          id="recipe-time"
          className={input}
          value={timeLabel}
          onChange={(e) => setTimeLabel(e.target.value)}
          placeholder="例: 20分"
          maxLength={20}
        />
      </label>

      <label className="flex flex-col gap-1.5 text-[13px] font-bold">
        何人分の分量か
        <select
          id="recipe-servings"
          className={input}
          value={servings ?? ""}
          onChange={(e) =>
            setServings(e.target.value ? Number(e.target.value) : null)
          }
        >
          <option value="">分からない</option>
          {Array.from({ length: SERVINGS_MAX }, (_, k) => k + 1).map((n) => (
            <option key={n} value={n}>
              {n}人分
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-2">
        <SectionHead
          label={servings ? `材料（${servings}人分）` : "材料"}
          sorting={sorting === "ings"}
          canSort={ings.length > 1}
          onToggle={() => setSorting(sorting === "ings" ? null : "ings")}
        />
        {sorting === "ings" &&
          ings.map((r, idx) => (
            <SortRow
              key={r.key}
              label={
                [r.name, r.amount].filter(Boolean).join("　") || "（空の行）"
              }
              what="材料"
              index={idx}
              count={ings.length}
              onMove={(dir) => setIngs(moveItem(ings, idx, dir))}
            />
          ))}
        {sorting !== "ings" &&
          ings.map((r, idx) => (
            <div key={r.key} className="flex items-center gap-1.5">
              <input
                aria-label={`材料${idx + 1}の名前`}
                className="h-11 min-w-0 flex-1 rounded-xl border border-field bg-card px-3 text-[15px]"
                value={r.name}
                placeholder="材料名"
                maxLength={60}
                onChange={(e) =>
                  setIngs(
                    ings.map((x) =>
                      x.key === r.key ? { ...x, name: e.target.value } : x,
                    ),
                  )
                }
              />
              <input
                aria-label={`材料${idx + 1}の分量`}
                className="h-11 w-28 rounded-xl border border-field bg-card px-3 text-[15px]"
                value={r.amount}
                placeholder="分量"
                maxLength={30}
                onChange={(e) =>
                  setIngs(
                    ings.map((x) =>
                      x.key === r.key ? { ...x, amount: e.target.value } : x,
                    ),
                  )
                }
              />
              <button
                type="button"
                aria-label="この材料を消す"
                className="flex size-11 items-center justify-center text-faint"
                onClick={() => setIngs(ings.filter((x) => x.key !== r.key))}
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
        {sorting !== "ings" && (
          <button
            type="button"
            className="self-start py-2 text-sm font-bold text-accent"
            onClick={() => setIngs([...ings, row()])}
          >
            ＋ 材料を追加
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <SectionHead
          label="作り方"
          sorting={sorting === "steps"}
          canSort={steps.length > 1}
          onToggle={() => setSorting(sorting === "steps" ? null : "steps")}
        />
        {sorting === "steps" &&
          steps.map((s, idx) => (
            <SortRow
              key={s.key}
              label={s.text || "（空の手順）"}
              what="手順"
              index={idx}
              count={steps.length}
              numbered
              onMove={(dir) => setSteps(moveItem(steps, idx, dir))}
            />
          ))}
        {sorting !== "steps" &&
          steps.map((s, idx) => (
            <div key={s.key} className="flex items-start gap-2">
              <span className="mt-2.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent-deep">
                {idx + 1}
              </span>
              <textarea
                aria-label={`手順${idx + 1}`}
                rows={2}
                className="min-w-0 flex-1 resize-none rounded-xl border border-field bg-card px-3 py-2 text-[15px] leading-relaxed"
                value={s.text}
                placeholder="手順を書く"
                maxLength={500}
                onChange={(e) =>
                  setSteps(
                    steps.map((x) =>
                      x.key === s.key ? { ...x, text: e.target.value } : x,
                    ),
                  )
                }
              />
              <button
                type="button"
                aria-label="この手順を消す"
                className="flex size-11 items-center justify-center text-faint"
                onClick={() => setSteps(steps.filter((x) => x.key !== s.key))}
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
        {sorting !== "steps" && (
          <button
            type="button"
            className="self-start py-2 text-sm font-bold text-accent"
            onClick={() => setSteps([...steps, { key: ++seq, text: "" }])}
          >
            ＋ 手順を追加
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-[13px] font-bold">コツ・ポイント（任意）</h3>
        {tips.map((t, idx) => (
          <div
            key={t.key}
            className="flex flex-col gap-1.5 rounded-xl border border-field bg-card p-2.5"
          >
            <div className="flex items-center gap-2">
              <select
                aria-label={`コツ${idx + 1}をどの手順に付けるか`}
                className="h-11 rounded-lg border border-field bg-card px-2 text-sm"
                value={t.stepKey ?? ""}
                onChange={(e) =>
                  setTips(
                    tips.map((x) =>
                      x.key === t.key
                        ? {
                            ...x,
                            stepKey: e.target.value
                              ? Number(e.target.value)
                              : null,
                          }
                        : x,
                    ),
                  )
                }
              >
                <option value="">全体のコツ</option>
                {steps.map((st, k) => (
                  <option key={st.key} value={st.key}>
                    手順{k + 1}のコツ
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label="このコツを消す"
                className="ml-auto flex size-11 items-center justify-center text-faint"
                onClick={() => setTips(tips.filter((x) => x.key !== t.key))}
              >
                <X className="size-4" />
              </button>
            </div>
            <textarea
              aria-label={`コツ${idx + 1}`}
              rows={2}
              className="resize-none rounded-lg border border-field bg-card px-3 py-2 text-[15px] leading-relaxed"
              value={t.text}
              placeholder="例：皮目から焼くとパリッとする"
              maxLength={TIP_MAX}
              onChange={(e) =>
                setTips(
                  tips.map((x) =>
                    x.key === t.key ? { ...x, text: e.target.value } : x,
                  ),
                )
              }
            />
          </div>
        ))}
        {tips.length < TIPS_MAX && (
          <button
            type="button"
            className="self-start py-2 text-sm font-bold text-accent"
            onClick={() =>
              setTips([...tips, { key: ++seq, stepKey: null, text: "" }])
            }
          >
            ＋ コツを追加
          </button>
        )}
      </div>

      {ex && (
        <>
          <label className="flex flex-col gap-1.5 text-[13px] font-bold">
            出典の URL（任意）
            <input
              id="recipe-source"
              type="url"
              className={input}
              value={ex.sourceUrl}
              onChange={(e) => setEx({ ...ex, sourceUrl: e.target.value })}
              placeholder="https://"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-bold">
            YouTube の URL（任意・アプリ内で再生）
            <input
              id="recipe-video"
              type="url"
              className={input}
              value={ex.videoUrl}
              onChange={(e) => setEx({ ...ex, videoUrl: e.target.value })}
              placeholder="https://www.youtube.com/watch?v=..."
            />
          </label>
        </>
      )}

      {(localError || error) && (
        <p role="alert" className="text-sm text-danger">
          {localError || error}
        </p>
      )}
      <PrimaryButton type="submit" disabled={saving}>
        {saving ? "保存中…" : submitLabel}
      </PrimaryButton>
    </form>
  );
}

/** 見出しと「並び替え」⇔「並び替えを終える」の切り替え */
function SectionHead({
  label,
  sorting,
  canSort,
  onToggle,
}: {
  label: string;
  sorting: boolean;
  canSort: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="text-[13px] font-bold">{label}</div>
      {canSort && (
        <button
          type="button"
          aria-label={
            sorting ? `${label}の並び替えを終える` : `${label}を並び替え`
          }
          className={`-my-2 h-11 px-2 text-sm font-bold ${sorting ? "text-accent-deep" : "text-accent"}`}
          onClick={onToggle}
        >
          {sorting ? "並び替えを終える" : "並び替え"}
        </button>
      )}
    </div>
  );
}

/** 並び替えの1行。中身は読むだけで、↑↓ で1つずつ動かす */
function SortRow({
  label,
  what,
  index,
  count,
  numbered,
  onMove,
}: {
  label: string;
  what: string;
  index: number;
  count: number;
  numbered?: boolean;
  onMove: (dir: -1 | 1) => void;
}) {
  const btn =
    "flex size-11 shrink-0 items-center justify-center rounded-xl border border-field bg-card text-ink aria-disabled:opacity-30";
  return (
    <div className="flex items-center gap-1.5">
      {numbered && (
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent-deep">
          {index + 1}
        </span>
      )}
      <div className="min-w-0 flex-1 truncate text-[15px]">{label}</div>
      <button
        type="button"
        aria-label={`${what}${index + 1}を上へ`}
        className={btn}
        aria-disabled={index === 0}
        onClick={() => index > 0 && onMove(-1)}
      >
        <ArrowUp className="size-4" />
      </button>
      <button
        type="button"
        aria-label={`${what}${index + 1}を下へ`}
        className={btn}
        aria-disabled={index === count - 1}
        onClick={() => index < count - 1 && onMove(1)}
      >
        <ArrowDown className="size-4" />
      </button>
    </div>
  );
}
