import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ChevronLeft, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient, type MealEntry } from "@/api/client";
import {
  Empty,
  ErrorState,
  Loading,
  PrimaryButton,
  SecondaryButton,
  SubHeader,
} from "@/components/common";
import { Toast, useToast } from "@/components/Toast";
import { shrinkImage } from "@/lib/image";
import { apiErrorMessage, cn } from "@/lib/utils";
import { MEAL_LABELS, MEALS, type Meal } from "../../shared/constants";
import { addDays, labelDate } from "../../shared/dates";
import { MEAL_KCAL_MAX, summarizeMeals } from "../../shared/meals";

/** 何日分を見るか */
const DAYS = 7;

/** 縮めた JPEG を base64 の文字にする */
async function toBase64(blob: Blob): Promise<string> {
  const url = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("写真を読めませんでした"));
    r.readAsDataURL(blob);
  });
  return url.slice(url.indexOf(",") + 1);
}

/**
 * 食べた記録（DEC-030）。本人だけのもの。
 * 作った！から入った分と、外食・買ったものを並べて見る。外食は文字か写真（AI）で入れる
 */
export function Meals() {
  const qc = useQueryClient();
  const { toast, show } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const closeAdd = useCallback(() => setAddOpen(false), []);
  const group = useQuery({ queryKey: ["group"], queryFn: apiClient.group });
  const pantry = useQuery({ queryKey: ["pantry"], queryFn: apiClient.pantry });
  const today = pantry.data?.today ?? "";
  const from = today ? addDays(today, -(DAYS - 1)) : "";
  const q = useQuery({
    queryKey: ["meals", from, today],
    queryFn: () => apiClient.meals(from, today),
    enabled: Boolean(today),
  });

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(null), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  const del = useMutation({
    mutationFn: (id: string) => apiClient.deleteMeal(id),
    onSuccess: () => {
      setConfirming(null);
      show("消しました");
    },
    onError: (e) => show(apiErrorMessage(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: ["meals"] }),
  });

  const meals = q.data ?? [];
  const days = summarizeMeals(meals);
  const me = group.data?.members.find((m) => m.isMe)?.name ?? "";

  return (
    <>
      <SubHeader
        title="食べた記録"
        back="/plan"
        right={
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="flex h-11 items-center gap-1 rounded-xl bg-accent px-3.5 text-sm font-bold text-white"
          >
            ＋ 外食・買ったもの
          </button>
        }
      />
      <div className="flex flex-col gap-3 px-5 pt-1 pb-8">
        <p className="text-xs leading-5 text-sub">
          {me ? `${me} の` : ""}
          直近{DAYS}
          日。ここは自分だけに見えます。作った！で「食べた」にした分も入ります。
        </p>
        {!pantry.isError && (q.isPending || pantry.isPending) && <Loading />}
        {pantry.isError && (
          <ErrorState error={pantry.error} retry={() => pantry.refetch()} />
        )}
        {q.isError && <ErrorState error={q.error} retry={() => q.refetch()} />}
        {q.data && meals.length === 0 && (
          <Empty>
            まだ記録がありません。
            <br />
            料理モードの「できあがり」か、右上の「＋」から入ります。
          </Empty>
        )}
        {days.map((d) => (
          <section key={d.date} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[13px] font-bold text-sub">
                {labelDate(d.date).md}（{labelDate(d.date).dow}）
                {d.date === today && "・今日"}
              </h2>
              <span className="text-xs text-sub tabular-nums">
                {d.count}品
                {d.kcal > 0 &&
                  `・約${d.kcal}kcal${d.partial ? "（一部は不明）" : ""}`}
                {d.kcal === 0 && d.partial && "・カロリーは不明"}
              </span>
            </div>
            <ul className="overflow-hidden rounded-2xl border border-line-soft bg-card">
              {meals
                .filter((m) => m.date === d.date)
                .map((m) => (
                  <MealRow
                    key={m.id}
                    m={m}
                    confirming={confirming === m.id}
                    busy={del.isPending}
                    onDelete={() =>
                      confirming === m.id
                        ? del.mutate(m.id)
                        : setConfirming(m.id)
                    }
                  />
                ))}
            </ul>
          </section>
        ))}
        <p className="text-[11.5px] leading-5 text-sub">
          カロリーは概算です。作った料理の分は、まだ数えられません（これから）。
        </p>
      </div>
      {addOpen && today && (
        <AddMealSheet
          today={today}
          onClose={closeAdd}
          onDone={(msg) => {
            setAddOpen(false);
            show(msg);
          }}
        />
      )}
      <Toast message={toast} />
    </>
  );
}

function MealRow({
  m,
  confirming,
  busy,
  onDelete,
}: {
  m: MealEntry;
  confirming: boolean;
  busy: boolean;
  onDelete: () => void;
}) {
  return (
    <li className="flex items-center gap-2 border-b border-[#f3eee7] px-3.5 py-2.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px]">{m.title}</p>
        <p className="text-[11.5px] text-sub">
          {m.meal ? MEAL_LABELS[m.meal] : "—"}・{m.portion}人前
          {m.kcal !== null &&
            `・約${Math.round(m.kcal * m.portion)}kcal${m.portion !== 1 ? `（1人前 ${m.kcal}）` : ""}`}
          {m.kind === "cooked" ? "・作った" : "・外食・買ったもの"}
        </p>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={onDelete}
        className={cn(
          "flex h-11 shrink-0 items-center rounded-xl border px-3 text-[13px] font-bold disabled:opacity-50",
          confirming
            ? "border-danger text-danger"
            : "border-field bg-card text-sub",
        )}
      >
        {confirming ? "本当に消す？" : "消す"}
      </button>
    </li>
  );
}

/** 外食・買ったものを入れるシート。写真を撮ると AI が料理名とカロリーを埋める（押した時だけ） */
function AddMealSheet({
  today,
  onClose,
  onDone,
}: {
  today: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const qc = useQueryClient();
  const [date, setDate] = useState(today);
  const [meal, setMeal] = useState<Meal | null>(null);
  const [title, setTitle] = useState("");
  const [portion, setPortion] = useState(1);
  const [kcal, setKcal] = useState("");
  const [items, setItems] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    titleRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const read = useMutation({
    mutationFn: async (file: File) => {
      const blob = await shrinkImage(file);
      return apiClient.mealPhoto(await toBase64(blob));
    },
    onSuccess: (r) => {
      setTitle(r.title);
      setKcal(r.kcal === null ? "" : String(r.kcal));
      setItems(r.items);
    },
  });
  const save = useMutation({
    mutationFn: () =>
      apiClient.addMeal({
        date,
        meal,
        title: title.trim(),
        portion,
        kcal: kcal.trim() === "" ? null : Number(kcal),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["meals"] });
      onDone("食べた記録に入れました");
    },
  });
  const kcalBad =
    kcal.trim() !== "" &&
    (!/^\d{1,4}$/.test(kcal.trim()) || Number(kcal) > MEAL_KCAL_MAX);

  return (
    <div
      className="fixed inset-0 z-20 flex flex-col justify-end bg-ink/45"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="外食・買ったものを入れる"
        className="mx-auto flex max-h-[90dvh] w-full max-w-xl flex-col gap-3 overflow-y-auto rounded-t-3xl bg-card px-5 pt-5 pb-[max(env(safe-area-inset-bottom),20px)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[17px] font-bold">外食・買ったものを入れる</h2>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          aria-label="食事の写真"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) read.mutate(f);
          }}
        />
        <SecondaryButton
          type="button"
          disabled={read.isPending}
          onClick={() => fileRef.current?.click()}
          className="h-11 text-sm"
        >
          {read.isPending ? (
            "AI が見ています…"
          ) : (
            <>
              <Camera className="size-4" />
              写真から AI に当ててもらう（無料）
            </>
          )}
        </SecondaryButton>
        {read.isError && (
          <p role="alert" className="text-xs text-danger">
            {apiErrorMessage(read.error)}
          </p>
        )}
        {items.length > 0 && (
          <p className="flex items-start gap-1 text-xs text-sub">
            <Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent" />
            写っていたもの：{items.join("・")}（1人分の概算。直せます）
          </p>
        )}
        <label className="flex flex-col gap-1 text-xs font-bold">
          何を食べた？
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={60}
            placeholder="例：牛丼 並・コンビニのサラダ"
            className="h-11 rounded-xl border border-field bg-card px-3 text-[15px] font-normal"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs font-bold">
            いつ
            <input
              type="date"
              value={date}
              max={today}
              min={addDays(today, -62)}
              onChange={(e) => setDate(e.target.value)}
              className="h-11 rounded-xl border border-field bg-card px-3 text-sm font-normal"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold">
            カロリー（任意）
            <input
              inputMode="numeric"
              value={kcal}
              onChange={(e) => setKcal(e.target.value)}
              placeholder="例：650"
              className={cn(
                "h-11 rounded-xl border bg-card px-3 text-sm font-normal",
                kcalBad ? "border-danger" : "border-field",
              )}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold">いつの食事</span>
          {MEALS.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={meal === m}
              onClick={() => setMeal(meal === m ? null : m)}
              className={cn(
                "min-h-11 rounded-full border px-4 text-sm",
                meal === m
                  ? "border-herb-mid bg-herb-soft font-bold text-herb"
                  : "border-field bg-card text-sub",
              )}
            >
              {MEAL_LABELS[m]}
            </button>
          ))}
          <select
            aria-label="何人前"
            value={portion}
            onChange={(e) => setPortion(Number(e.target.value))}
            className="ml-auto h-11 rounded-xl border border-field bg-card px-2 text-sm"
          >
            {[0.5, 1, 1.5, 2].map((p) => (
              <option key={p} value={p}>
                {p}人前
              </option>
            ))}
          </select>
        </div>
        {save.isError && (
          <p role="alert" className="text-sm text-danger">
            {apiErrorMessage(save.error)}
          </p>
        )}
        <PrimaryButton
          type="button"
          disabled={!title.trim() || kcalBad || save.isPending}
          onClick={() => save.mutate()}
          className="h-12"
        >
          {save.isPending ? "入れています…" : "記録に入れる"}
        </PrimaryButton>
        <button
          type="button"
          onClick={onClose}
          className="flex min-h-11 items-center justify-center gap-1 text-sm text-sub underline"
        >
          <ChevronLeft className="size-4" />
          やめる
        </button>
      </div>
    </div>
  );
}
