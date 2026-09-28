import { X } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { RecipeFields } from "@/api/client";
import { Chip, PrimaryButton } from "@/components/common";
import {
  CATEGORIES,
  GENRES,
  type Category,
  type Genre,
} from "../../shared/constants";

type Row = { key: number; name: string; amount: string };
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
  const [ings, setIngs] = useState<Row[]>(() =>
    initial.ingredients.length
      ? initial.ingredients.map((i) => row(i.name, i.amount))
      : [row(), row(), row()],
  );
  const [steps, setSteps] = useState<{ key: number; text: string }[]>(() =>
    (initial.steps.length ? initial.steps : ["", ""]).map((t) => ({
      key: ++seq,
      text: t,
    })),
  );
  const [ex, setEx] = useState<EditorExtras | undefined>(extras);
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = () => {
    const fields: RecipeFields = {
      title: title.trim(),
      category,
      genre,
      timeLabel: timeLabel.trim(),
      ingredients: ings
        .filter((r) => r.name.trim())
        .map((r) => ({ name: r.name.trim(), amount: r.amount.trim() })),
      steps: steps.map((s) => s.text.trim()).filter(Boolean),
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

      <div className="flex flex-col gap-2">
        <div className="text-[13px] font-bold">材料（2人分）</div>
        {ings.map((r, idx) => (
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
        <button
          type="button"
          className="self-start py-2 text-sm font-bold text-accent"
          onClick={() => setIngs([...ings, row()])}
        >
          ＋ 材料を追加
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-[13px] font-bold">作り方</div>
        {steps.map((s, idx) => (
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
        <button
          type="button"
          className="self-start py-2 text-sm font-bold text-accent"
          onClick={() => setSteps([...steps, { key: ++seq, text: "" }])}
        >
          ＋ 手順を追加
        </button>
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
