import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  ListChecks,
  Mic,
  Timer,
  Volume2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { apiClient } from "@/api/client";
import { ErrorState, Loading } from "@/components/common";
import {
  listenForCommands,
  speak,
  speechSupported,
  stopSpeaking,
} from "@/lib/speech";
import { cn } from "@/lib/utils";
import {
  findTimers,
  formatClock,
  voiceCommand,
  type CookTimer,
} from "../../shared/cook";

/**
 * 料理モード（#26）。手順を1つずつ大きく出し、画面を点けたままにする。
 * 読み上げ・声での操作・タイマーは端末の機能だけで動く（AI は使わない）。
 */
export function CookMode() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const q = useQuery({
    queryKey: ["recipe", id],
    queryFn: () => apiClient.getRecipe(id),
  });
  if (q.isPending) return <Loading />;
  if (q.isError)
    return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const r = q.data;
  const v =
    r.versions.find((x) => x.id === params.get("v")) ??
    r.versions[r.versions.length - 1]!;
  return (
    <CookView
      recipeId={r.id}
      title={v.title}
      steps={v.steps}
      ingredients={v.ingredients}
    />
  );
}

type RunningTimer = { label: string; endsAt: number; total: number };

function CookView({
  recipeId,
  title,
  steps,
  ingredients,
}: {
  recipeId: string;
  title: string;
  steps: string[];
  ingredients: { name: string; amount: string }[];
}) {
  const nav = useNavigate();
  const [idx, setIdx] = useState(0);
  const [showIngs, setShowIngs] = useState(false);
  const [reading, setReading] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState<string | null>(null);
  const [timers, setTimers] = useState<RunningTimer[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [awake, setAwake] = useState<"on" | "off" | "unsupported">(() =>
    "wakeLock" in navigator ? "off" : "unsupported",
  );
  const stopListenRef = useRef<(() => void) | null>(null);
  const [voiceOk] = useState(() => speechSupported());

  const count = steps.length;
  const last = idx >= count - 1;
  const step = steps[idx] ?? "";
  const stepTimers = findTimers(step);

  const go = useCallback(
    (to: number) => setIdx(Math.max(0, Math.min(count - 1, to))),
    [count],
  );

  // 画面を点けたままにする（対応していない端末では知らせるだけ）
  useEffect(() => {
    const nav2 = navigator as Navigator & {
      wakeLock?: { request: (t: "screen") => Promise<{ release: () => void }> };
    };
    if (!nav2.wakeLock) return;
    let lock: { release: () => void } | null = null;
    let alive = true;
    const acquire = () =>
      nav2
        .wakeLock!.request("screen")
        .then((l) => {
          if (!alive) return l.release();
          lock = l;
          setAwake("on");
        })
        .catch(() => setAwake("off"));
    void acquire();
    // 別のアプリから戻ったら取り直す
    const onVis = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVis);
      lock?.release();
    };
  }, []);

  // 読み上げ：手順が変わったら読む
  useEffect(() => {
    if (reading && step) speak(`${idx + 1}。${step}`);
  }, [reading, idx, step]);
  useEffect(() => () => stopSpeaking(), []);

  // タイマーの表示を1秒ごとに進め、終わったら知らせる
  useEffect(() => {
    if (!timers.length) return;
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      const done = timers.filter((x) => x.endsAt <= n);
      if (done.length) {
        navigator.vibrate?.([300, 150, 300]);
        speak(`${done.map((d) => d.label).join("と")}のタイマーが終わりました`);
        setTimers((ts) => ts.filter((x) => x.endsAt > n));
      }
    }, 1000);
    return () => clearInterval(t);
  }, [timers]);

  const startTimer = useCallback((t: CookTimer) => {
    setNow(Date.now());
    setTimers((ts) => [
      ...ts,
      {
        label: t.label,
        endsAt: Date.now() + t.seconds * 1000,
        total: t.seconds,
      },
    ]);
  }, []);

  // 声での操作。読み上げ中の自分の声は拾わない。長い言葉は会話とみなして無視
  const onPhrase = useRef<(text: string) => void>(() => {});
  const handlePhrase = (text: string) => {
    if (window.speechSynthesis?.speaking) return;
    const t = text.trim();
    if (!t || t.length > 12) return;
    const cmd = voiceCommand(t);
    setHeard(t);
    if (cmd === "next") go(idx + 1);
    else if (cmd === "prev") go(idx - 1);
    else if (cmd === "repeat") speak(`${idx + 1}。${step}`);
    else if (cmd === "ingredients") setShowIngs(true);
    else if (cmd === "timer" && stepTimers[0]) startTimer(stepTimers[0]);
  };
  // 最新の手順で判断できるよう、描画のあとで差し替える
  useEffect(() => {
    onPhrase.current = handlePhrase;
  });
  const toggleListen = () => {
    if (listening) {
      stopListenRef.current?.();
      stopListenRef.current = null;
      setListening(false);
      return;
    }
    const stop = listenForCommands(
      (t) => onPhrase.current(t),
      () => {
        stopListenRef.current = null;
        setListening(false);
      },
    );
    if (stop) {
      stopListenRef.current = stop;
      setListening(true);
    }
  };
  useEffect(() => () => stopListenRef.current?.(), []);

  // 左右のスワイプで手順を切り替える
  const touchX = useRef<number | null>(null);

  const close = () => nav(`/recipes/${recipeId}`);

  if (count === 0)
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-paper px-6 text-center text-sm text-sub">
        <p>
          まだ作り方がありません。「材料・作り方を編集」から入れてください。
        </p>
        <button
          type="button"
          onClick={close}
          className="h-11 rounded-full border border-field bg-card px-5 text-ink"
        >
          レシピに戻る
        </button>
      </div>
    );

  return (
    <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col bg-paper">
      {/* 上：閉じる・料理名・何番目か */}
      <header className="flex items-center gap-2 px-2 pt-[max(env(safe-area-inset-top),8px)]">
        <button
          type="button"
          aria-label="料理モードを終える"
          onClick={close}
          className="flex size-11 items-center justify-center text-sub"
        >
          <X className="size-6" />
        </button>
        <div className="min-w-0 flex-1 truncate text-sm font-bold">{title}</div>
        <div
          className="pr-3 text-sm font-bold text-accent-deep"
          aria-live="polite"
        >
          {idx + 1} / {count}
        </div>
      </header>
      <div
        className="mx-4 mt-1 h-1.5 overflow-hidden rounded-full bg-line-soft"
        aria-hidden
      >
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${((idx + 1) / count) * 100}%` }}
        />
      </div>

      {/* まん中：今の手順を大きく */}
      <main
        className="flex flex-1 flex-col gap-5 px-6 pt-8 pb-4"
        onTouchStart={(e) => {
          touchX.current = e.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(e) => {
          const x0 = touchX.current;
          const x1 = e.changedTouches[0]?.clientX;
          touchX.current = null;
          if (x0 == null || x1 == null) return;
          if (x1 - x0 < -60) go(idx + 1);
          if (x1 - x0 > 60) go(idx - 1);
        }}
      >
        <div className="flex size-12 items-center justify-center rounded-full bg-accent-soft font-display text-2xl font-bold text-accent-deep">
          {idx + 1}
        </div>
        <p
          className="font-display text-[26px] leading-[1.6] font-bold break-words"
          aria-live="polite"
        >
          {step}
        </p>

        {stepTimers.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {stepTimers.map((t, k) => (
              <button
                key={k}
                type="button"
                onClick={() => startTimer(t)}
                className="flex h-11 items-center gap-1.5 rounded-full border border-field bg-card px-4 text-[15px] font-bold text-ink"
              >
                <Timer className="size-4 text-accent" />
                {t.label} のタイマー
              </button>
            ))}
          </div>
        )}

        {timers.length > 0 && (
          <ul className="flex flex-col gap-2" aria-label="動いているタイマー">
            {timers.map((t, k) => (
              <li
                key={k}
                className="flex items-center gap-3 rounded-2xl bg-herb-soft px-4 py-2.5 text-herb"
              >
                <Timer className="size-5" />
                <span className="text-sm">{t.label}</span>
                <span className="ml-auto font-display text-2xl font-bold tabular-nums">
                  {formatClock((t.endsAt - now) / 1000)}
                </span>
                <button
                  type="button"
                  aria-label={`${t.label}のタイマーを止める`}
                  onClick={() =>
                    setTimers((ts) => ts.filter((_, j) => j !== k))
                  }
                  className="-mr-2 flex size-11 items-center justify-center"
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>

      {/* 下：道具と、戻る・次へ（片手で押せる位置） */}
      <div className="flex flex-col gap-3 px-4 pb-[max(env(safe-area-inset-bottom),16px)]">
        {listening && (
          <p className="text-center text-xs text-sub" aria-live="polite">
            「次」「戻って」「もう一回」「材料」「タイマー」で操作できます
            {heard ? `（聞こえた言葉：${heard}）` : ""}
          </p>
        )}
        {awake === "unsupported" && (
          <p className="text-center text-xs text-sub">
            この端末では画面を点けたままにできません。設定の自動ロックを長めにしてください
          </p>
        )}
        <div className="flex justify-center gap-2">
          <ToolButton
            on={showIngs}
            onClick={() => setShowIngs(true)}
            icon={<ListChecks className="size-4" />}
            label="材料"
          />
          <ToolButton
            on={reading}
            onClick={() => {
              if (reading) stopSpeaking();
              setReading(!reading);
            }}
            icon={<Volume2 className="size-4" />}
            label={reading ? "読み上げ中" : "読み上げ"}
          />
          {voiceOk && (
            <ToolButton
              on={listening}
              onClick={toggleListen}
              icon={<Mic className="size-4" />}
              label={listening ? "声で操作中" : "声で操作"}
            />
          )}
        </div>
        <div className="grid grid-cols-[1fr_2fr] gap-2.5">
          <button
            type="button"
            onClick={() => go(idx - 1)}
            disabled={idx === 0}
            className="flex h-16 items-center justify-center gap-1 rounded-2xl border border-field bg-card text-base font-bold text-ink disabled:opacity-40"
          >
            <ChevronLeft className="size-5" />
            戻る
          </button>
          {last ? (
            <button
              type="button"
              onClick={close}
              className="flex h-16 items-center justify-center rounded-2xl bg-herb text-lg font-bold text-white"
            >
              できあがり
            </button>
          ) : (
            <button
              type="button"
              onClick={() => go(idx + 1)}
              className="flex h-16 items-center justify-center gap-1 rounded-2xl bg-accent text-lg font-bold text-white"
            >
              次へ
              <ChevronRight className="size-5" />
            </button>
          )}
        </div>
      </div>

      {showIngs && (
        <div
          className="fixed inset-0 z-20 flex flex-col justify-end bg-ink/40"
          onClick={() => setShowIngs(false)}
        >
          <div
            role="dialog"
            aria-label="材料"
            className="mx-auto max-h-[75dvh] w-full max-w-[480px] overflow-y-auto rounded-t-3xl bg-card px-5 pt-4 pb-[max(env(safe-area-inset-bottom),20px)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold">
                材料 <span className="text-xs font-normal text-sub">2人分</span>
              </h2>
              <button
                type="button"
                aria-label="材料を閉じる"
                onClick={() => setShowIngs(false)}
                className="-mr-2 flex size-11 items-center justify-center text-sub"
              >
                <X className="size-5" />
              </button>
            </div>
            {ingredients.length === 0 ? (
              <p className="py-6 text-sm text-sub">材料がありません。</p>
            ) : (
              <ul className="mt-1 border-t border-line-soft">
                {ingredients.map((i, k) => (
                  <li
                    key={k}
                    className="flex justify-between gap-3 border-b border-line-soft py-3 text-[17px]"
                  >
                    <span>{i.name}</span>
                    <span className="shrink-0 font-bold">{i.amount}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ToolButton({
  on,
  onClick,
  icon,
  label,
}: {
  on: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "flex h-11 items-center gap-1.5 rounded-full border px-4 text-[13px] font-bold",
        on
          ? "border-[#e3b7a5] bg-accent-soft text-accent-deep"
          : "border-field bg-card text-ink",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
