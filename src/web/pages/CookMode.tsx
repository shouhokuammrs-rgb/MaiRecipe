import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  ListChecks,
  MessageCircle,
  Mic,
  Play,
  Send,
  Timer,
  Volume2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { apiClient, ApiError } from "@/api/client";
import { ErrorState, Loading } from "@/components/common";
import { IngredientName } from "@/components/IngredientName";
import {
  listenForCommands,
  startListening,
  recentlySpoke,
  ringAlarm,
  speak,
  speechSupported,
  stopSpeaking,
  unlockAlarm,
} from "@/lib/speech";
import { cn } from "@/lib/utils";
import { findTimers, formatClock, type CookTimer } from "../../shared/cook";
import {
  measureAnswer,
  parseQuick,
  wakeQuestion,
  type QuickAction,
} from "../../shared/assist";
import { explainStep, normalizeGroups } from "../../shared/groups";
import { scaleIngredients } from "../../shared/servings";
import { tipsForStep, type Tip } from "../../shared/tips";
import { sceneUrl } from "../../shared/scene-url";

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
  // 詳しい画面で人数を変えていれば、その人数の分量で作る
  const base = v.servings || null;
  const asked = Number(params.get("people"));
  const people =
    base &&
    Number.isInteger(asked) &&
    asked >= 1 &&
    asked <= 20 &&
    asked !== base
      ? asked
      : null;
  return (
    <CookView
      recipeId={r.id}
      versionId={v.id}
      title={v.title}
      // 「Aを加える」→「A（しょうゆ・みりん）を加える」。表示も読み上げも同じ文
      steps={v.steps.map((s) => explainStep(s, v.ingredients))}
      ingredients={scaleIngredients(
        normalizeGroups(v.ingredients, v.steps),
        base,
        people ?? base ?? 0,
      )}
      people={people ?? undefined}
      tips={v.tips ?? []}
      videoUrl={r.videoUrl}
      stepTimes={
        // 手順の数と合うときだけ（ずれた場面に飛ばない）
        v.stepTimes?.length === v.steps.length ? v.stepTimes : []
      }
      servingsLabel={
        people ? `${people}人分（元は${base}人分）` : base ? `${base}人分` : ""
      }
    />
  );
}

type RunningTimer = { id: number; label: string; endsAt: number };
let timerSeq = 0;

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  /** assistant だけ：AI の答えか、計算した答えか */
  source?: "ai" | "calc" | "done" | "error";
};

const SUGGESTIONS = [
  "大さじ1は小さじ何杯？",
  "代わりになる材料は？",
  "3人分にするには？",
  "焦げそうなときは？",
];

function CookView({
  recipeId,
  versionId,
  title,
  steps,
  ingredients,
  people,
  servingsLabel,
  tips,
  videoUrl,
  stepTimes,
}: {
  recipeId: string;
  versionId: string;
  title: string;
  steps: string[];
  ingredients: { name: string; amount: string }[];
  /** 人数を変えて作るとき（分量は換算済み） */
  people?: number;
  servingsLabel: string;
  /** コツ・ポイント（DEC-024） */
  tips: Tip[];
  videoUrl: string | null;
  /** 手順ごとの、動画の中の開始の秒 */
  stepTimes: (number | null)[];
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
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [asking, setAsking] = useState(false);
  const [showAssist, setShowAssist] = useState(false);
  const [draft, setDraft] = useState("");
  const [dictating, setDictating] = useState(false);

  const count = steps.length;
  const last = idx >= count - 1;
  const step = steps[idx] ?? "";
  const stepTips = tipsForStep(tips, idx + 1, count);
  // 動画のこの手順の場面（押したら下から動画を出す）
  const sceneStart = stepTimes[idx] ?? null;
  const [scene, setScene] = useState<{ url: string; step: number } | null>(
    null,
  );
  // 手順が変わったら（アシスタントの操作など）、前の手順の場面は閉じる
  const [sceneIdx, setSceneIdx] = useState(idx);
  if (sceneIdx !== idx) {
    setSceneIdx(idx);
    if (scene) setScene(null);
  }
  // 全体のコツは、最初の手順のところに出す
  const shownTips =
    idx === 0 ? [...tipsForStep(tips, null, count), ...stepTips] : stepTips;
  /** 手順を読む文（その手順のコツも続けて読む） */
  const stepSpeech = (i: number) => {
    // 最初の手順では、全体のコツも続けて読む（画面と同じ）
    const t = [
      ...(i === 0 ? tipsForStep(tips, null, count) : []),
      ...tipsForStep(tips, i + 1, count),
    ];
    return `${i + 1}。${steps[i]}${t.length ? `。コツ。${t.join("。")}` : ""}`;
  };
  const stepTimers = findTimers(step);

  const go = useCallback(
    (to: number) => setIdx(Math.max(0, Math.min(count - 1, to))),
    [count],
  );

  // 画面を点けたままにする（対応していない端末では知らせるだけ）
  useEffect(() => {
    const nav2 = navigator as Navigator & {
      wakeLock?: { request: (t: "screen") => Promise<unknown> };
    };
    if (!nav2.wakeLock) return;
    type Lock = {
      release: () => Promise<void> | void;
      addEventListener?: (t: "release", f: () => void) => void;
    };
    let lock: Lock | null = null;
    let alive = true;
    const acquire = () =>
      (nav2.wakeLock!.request("screen") as Promise<Lock>)
        .then((l) => {
          if (!alive) return void l.release();
          // 前のものは放してから持ち替える
          void lock?.release();
          lock = l;
          setAwake("on");
          l.addEventListener?.("release", () => {
            if (lock === l) setAwake("off");
          });
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
      void lock?.release();
    };
  }, []);

  // 読み上げ：手順が変わったら読む（アシスタントの答えで移ったときは、答えを読み切らせる）
  const skipReadRef = useRef(false);
  useEffect(() => {
    if (skipReadRef.current) {
      skipReadRef.current = false;
      return;
    }
    if (reading && step) speak(stepSpeech(idx));
    // stepSpeech は steps と tips だけで決まる（step が変われば読み直す）
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        ringAlarm();
        // 読み上げの途中なら邪魔しない（音と振動で知らせる）
        if (!window.speechSynthesis?.speaking)
          speak(
            `${done.map((d) => d.label).join("と")}のタイマーが終わりました`,
          );
        setTimers((ts) => ts.filter((x) => x.endsAt > n));
      }
    }, 1000);
    return () => clearInterval(t);
  }, [timers]);

  const startTimer = useCallback((t: CookTimer) => {
    unlockAlarm();
    setNow(Date.now());
    setTimers((ts) => [
      ...ts,
      { id: ++timerSeq, label: t.label, endsAt: Date.now() + t.seconds * 1000 },
    ]);
  }, []);

  const readStep = (i: number) => {
    const at = Math.max(0, Math.min(count - 1, i));
    if (steps[at]) speak(stepSpeech(at));
  };

  /** その場ですぐ動く言葉を実行する */
  const runQuick = (q: QuickAction) => {
    if (q.kind === "next" || q.kind === "prev") {
      const to = idx + (q.kind === "next" ? 1 : -1);
      go(to);
      // 読み上げがオンなら手順が変わったときに読むので、ここでは読まない
      if (q.read && !reading) readStep(to);
    } else if (q.kind === "repeat") readStep(idx);
    else if (q.kind === "ingredients") setShowIngs(true);
    else if (q.kind === "goto") go(q.step - 1);
    else if (q.kind === "timer") {
      const t = q.timer ?? stepTimers[0];
      if (t) startTimer(t);
      else
        speak(
          "この手順には時間が書いてありません。「5分のタイマー」のように言ってください",
        );
    }
  };

  /** アシスタントに相談する。計量の換算は計算で、ほかは AI に聞く */
  // 続けて何度も AI を呼ばない（同じ時に2つ聞こえても1つだけ・声の相談は4秒あける）
  const askingRef = useRef(false);
  const lastVoiceAskRef = useRef(0);
  const ask = async (question: string, aloud: boolean) => {
    const q = question.trim();
    if (!q || askingRef.current) return;
    const history = chat
      .filter((m) => m.source !== "error")
      .slice(-6)
      .map((m) => ({ role: m.role, text: m.text }));
    setChat((c) => [...c, { role: "user", text: q }]);
    const say = (text: string) => {
      if (aloud || reading) speak(text);
    };
    // 「次読んで」「5分のタイマー」は文字で打っても動かす
    const quick = parseQuick(q);
    if (quick) {
      runQuick(quick);
      const timer =
        quick.kind === "timer" ? (quick.timer ?? stepTimers[0]) : null;
      const done =
        quick.kind === "timer"
          ? timer
            ? `${timer.label}のタイマーをかけました。`
            : "この手順には時間がありません。「5分のタイマー」のように入れてください。"
          : quick.kind === "goto"
            ? `手順${quick.step}にしました。`
            : quick.kind === "next"
              ? "次の手順にしました。"
              : quick.kind === "prev"
                ? "前の手順にしました。"
                : null;
      if (done)
        setChat((c) => [
          ...c,
          { role: "assistant", text: done, source: "done" },
        ]);
      return;
    }
    const calc = measureAnswer(q);
    if (calc) {
      setChat((c) => [...c, { role: "assistant", text: calc, source: "calc" }]);
      say(calc);
      return;
    }
    askingRef.current = true;
    setAsking(true);
    try {
      const r = await apiClient.assist({
        recipeId,
        versionId,
        stepIndex: idx,
        people,
        question: q,
        history,
      });
      setChat((c) => [
        ...c,
        { role: "assistant", text: r.answer, source: "ai" },
      ]);
      say(r.answer);
      if (r.action?.type === "timer")
        startTimer({
          label: r.action.label ?? "タイマー",
          seconds: r.action.seconds,
        });
      if (r.action?.type === "step") {
        skipReadRef.current = true;
        go(r.action.number - 1);
      }
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : "答えを受け取れませんでした。";
      setChat((c) => [...c, { role: "assistant", text: msg, source: "error" }]);
      say(msg);
    } finally {
      askingRef.current = false;
      setAsking(false);
    }
  };
  const askRef = useRef(ask);
  useEffect(() => {
    askRef.current = ask;
  });

  // 声での操作。読み上げ中の自分の声は拾わない。
  // 短い決まった言葉はすぐ動かし、「ねえ、〜」は相談として聞く。ほかの会話は聞き流す
  const onPhrase = useRef<(text: string) => void>(() => {});
  const handlePhrase = (text: string) => {
    if (recentlySpoke()) return;
    // 動画を見ている間は、動画の声（「次に…」）で手順を動かさない
    if (scene) return;
    const t = text.trim();
    if (!t) return;
    setHeard(t);
    const quick = parseQuick(t);
    if (quick) return runQuick(quick);
    const question = wakeQuestion(t);
    if (question) {
      if (Date.now() - lastVoiceAskRef.current < 4000) return;
      lastVoiceAskRef.current = Date.now();
      void ask(question, true);
    }
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
    // 前の聞き取りの「終わった」知らせで、今の聞き取りの表示を消さないよう、回ごとに区別する
    const session: { stop: (() => void) | null } = { stop: null };
    session.stop = listenForCommands(
      (t) => onPhrase.current(t),
      () => {
        if (stopListenRef.current !== session.stop) return;
        stopListenRef.current = null;
        setListening(false);
      },
    );
    if (session.stop) {
      stopListenRef.current = session.stop;
      setListening(true);
    }
  };
  useEffect(() => () => stopListenRef.current?.(), []);
  const toggleListenRef = useRef(toggleListen);
  useEffect(() => {
    toggleListenRef.current = toggleListen;
  });

  // 相談の入力欄：話して入れる（1回だけ聞く）。話し終わったら送る
  const stopDictRef = useRef<(() => void) | null>(null);
  const dictate = () => {
    if (dictating) {
      stopDictRef.current?.();
      return;
    }
    // 聞き続けている声の操作とマイクを取り合わないよう、聞いているあいだは止めておく
    const resumeVoice = listening;
    if (resumeVoice) toggleListen();
    let said = "";
    let ended = false;
    const stop = startListening(
      (t) => {
        said = t;
        setDraft(t);
      },
      () => {
        // 終わりとエラーの両方が来ても、1回だけ送る
        if (ended) return;
        ended = true;
        stopDictRef.current = null;
        setDictating(false);
        if (said.trim()) {
          setDraft("");
          void askRef.current(said, true);
        }
        if (resumeVoice) setTimeout(() => toggleListenRef.current(), 500);
      },
    );
    if (stop) {
      stopDictRef.current = stop;
      setDictating(true);
      // 一言で終わるように、少し待って止める
      setTimeout(() => {
        if (!ended) stop();
      }, 8000);
    }
  };
  useEffect(() => () => stopDictRef.current?.(), []);

  const lastAnswer = [...chat].reverse().find((m) => m.role === "assistant");

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
        <div className="pr-3 text-sm font-bold text-accent-deep">
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

        {shownTips.length > 0 && (
          <div className="rounded-2xl bg-herb-soft px-4 py-3 text-herb">
            <p className="text-xs font-bold">コツ</p>
            <ul className="mt-1 flex flex-col gap-1 text-[17px] leading-7">
              {shownTips.map((t, k) => (
                <li key={k}>{t}</li>
              ))}
            </ul>
          </div>
        )}

        {videoUrl && sceneStart !== null && (
          <button
            type="button"
            onClick={() => {
              stopSpeaking();
              const url = sceneUrl(videoUrl, sceneStart);
              if (url) setScene({ url, step: idx + 1 });
            }}
            className="flex h-11 items-center gap-1.5 self-start rounded-full border border-field bg-card px-4 text-[15px] font-bold text-ink"
          >
            <Play className="size-4 text-accent" />
            動画でこの場面を見る（{formatClock(sceneStart)}〜）
          </button>
        )}

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
            {timers.map((t) => (
              <li
                key={t.id}
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
                    setTimers((ts) => ts.filter((x) => x.id !== t.id))
                  }
                  className="-mr-2 flex size-11 items-center justify-center"
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {(asking || lastAnswer) && !showAssist && (
          <button
            type="button"
            onClick={() => setShowAssist(true)}
            className="flex flex-col gap-1 rounded-2xl border border-line-soft bg-card px-4 py-3 text-left"
            aria-live="polite"
          >
            <span className="flex items-center gap-1.5 text-xs font-bold text-sub">
              <MessageCircle className="size-4 text-herb" />
              {asking
                ? "アシスタントが考え中…"
                : lastAnswer?.source === "calc"
                  ? "計算した答え"
                  : lastAnswer?.source === "ai"
                    ? "AI の答え（間違えることがあります）"
                    : "アシスタント"}
            </span>
            {!asking && lastAnswer && (
              <span className="line-clamp-3 text-[15px] leading-relaxed">
                {lastAnswer.text}
              </span>
            )}
          </button>
        )}
      </main>

      {/* 下：道具と、戻る・次へ（片手で押せる位置） */}
      <div className="flex flex-col gap-3 px-4 pb-[max(env(safe-area-inset-bottom),16px)]">
        {listening && (
          <p className="text-center text-xs text-sub" aria-live="polite">
            「次読んで」「戻って」「5分のタイマー」で操作。相談は「ねえ、〜」と話しかけてください
            {heard ? `（聞こえた言葉：${heard}）` : ""}
          </p>
        )}
        {awake === "unsupported" && (
          <p className="text-center text-xs text-sub">
            この端末では画面を点けたままにできません。設定の自動ロックを長めにしてください
          </p>
        )}
        <div className="flex items-center justify-center gap-2">
          <ToolButton
            on={showIngs}
            onClick={() => setShowIngs(true)}
            icon={<ListChecks className="size-4" />}
            label="材料"
          />
          <ToolButton
            on={showAssist}
            onClick={() => setShowAssist(true)}
            icon={<MessageCircle className="size-4" />}
            label="相談"
          />
          <IconToggle
            on={reading}
            onClick={() => {
              if (reading) stopSpeaking();
              setReading(!reading);
            }}
            label={reading ? "読み上げを止める" : "手順を読み上げる"}
          >
            <Volume2 className="size-5" />
          </IconToggle>
          {voiceOk && (
            <IconToggle
              on={listening}
              onClick={toggleListen}
              label={listening ? "声での操作を止める" : "声で操作する"}
            >
              <Mic className="size-5" />
            </IconToggle>
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

      {showAssist && (
        <div
          className="fixed inset-0 z-20 flex flex-col justify-end bg-ink/40"
          onClick={() => setShowAssist(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="アシスタントに相談"
            onKeyDown={(e) => {
              if (e.key === "Escape") setShowAssist(false);
            }}
            className="mx-auto flex max-h-[85dvh] w-full max-w-[480px] flex-col rounded-t-3xl bg-card pb-[max(env(safe-area-inset-bottom),12px)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-4">
              <h2 className="text-base font-bold">アシスタントに相談</h2>
              <button
                type="button"
                aria-label="相談を閉じる"
                autoFocus
                onClick={() => setShowAssist(false)}
                className="-mr-2 flex size-11 items-center justify-center text-sub"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="flex min-h-[120px] flex-1 flex-col gap-2.5 overflow-y-auto px-5 py-3">
              {chat.length === 0 && (
                <p className="text-sm leading-7 text-sub">
                  料理中に困ったことを聞いてください。今のレシピと手順を見て答えます。
                  計量の換算は計算で、ほかは AI（無料）が答えます。
                </p>
              )}
              {chat.map((m, k) =>
                m.role === "user" ? (
                  <p
                    key={k}
                    className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-accent-soft px-3.5 py-2 text-[15px]"
                  >
                    {m.text}
                  </p>
                ) : (
                  <div key={k} className="flex max-w-[90%] flex-col gap-0.5">
                    <span className="text-[11px] text-sub">
                      {m.source === "calc"
                        ? "計算した答え"
                        : m.source === "done"
                          ? "操作しました"
                          : m.source === "ai"
                            ? "AI の答え（間違えることがあります）"
                            : "うまく答えられませんでした"}
                    </span>
                    <p
                      className={cn(
                        "rounded-2xl rounded-bl-md px-3.5 py-2 text-[15px] leading-relaxed",
                        m.source === "error"
                          ? "bg-memo text-memo-ink"
                          : "bg-herb-soft text-ink",
                      )}
                    >
                      {m.text}
                    </p>
                  </div>
                ),
              )}
              {asking && (
                <p className="text-sm text-sub" role="status">
                  考え中…
                </p>
              )}
            </div>
            {chat.length === 0 && (
              <div className="flex gap-2 overflow-x-auto px-5 pb-2">
                {SUGGESTIONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => void ask(q, false)}
                    className="h-11 shrink-0 rounded-full border border-field bg-paper px-3.5 text-[13px]"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
            <form
              className="flex items-center gap-2 px-4 pt-1"
              onSubmit={(e) => {
                e.preventDefault();
                const q = draft;
                setDraft("");
                void ask(q, false);
              }}
            >
              <input
                aria-label="相談したいこと"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={dictating ? "聞き取り中…" : "例：落とし蓋がない"}
                maxLength={300}
                className="h-11 min-w-0 flex-1 rounded-xl border border-field bg-paper px-3 text-[15px]"
              />
              {voiceOk && (
                <IconToggle
                  on={dictating}
                  onClick={dictate}
                  label={dictating ? "聞き取りを止める" : "話して聞く"}
                >
                  <Mic className="size-5" />
                </IconToggle>
              )}
              <button
                type="submit"
                aria-label="送る"
                disabled={!draft.trim() || asking}
                className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-white disabled:opacity-40"
              >
                <Send className="size-4" />
              </button>
            </form>
          </div>
        </div>
      )}

      {scene && (
        <div
          className="fixed inset-0 z-20 flex flex-col justify-end bg-ink/40"
          onClick={() => setScene(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="動画のこの場面"
            onKeyDown={(e) => {
              if (e.key === "Escape") setScene(null);
            }}
            className="mx-auto w-full max-w-[480px] rounded-t-3xl bg-card px-4 pt-3 pb-[max(env(safe-area-inset-bottom),20px)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold">手順{scene.step}の場面</h2>
              <button
                type="button"
                aria-label="動画を閉じる"
                autoFocus
                onClick={() => setScene(null)}
                className="-mr-2 flex size-11 items-center justify-center text-sub"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="relative mt-1 aspect-video w-full overflow-hidden rounded-2xl bg-video">
              <iframe
                src={scene.url}
                title={`手順${scene.step}の場面`}
                className="absolute inset-0 size-full"
                allow="autoplay; accelerometer; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
          </div>
        </div>
      )}

      {showIngs && (
        <div
          className="fixed inset-0 z-20 flex flex-col justify-end bg-ink/40"
          onClick={() => setShowIngs(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="材料"
            onKeyDown={(e) => {
              if (e.key === "Escape") setShowIngs(false);
            }}
            className="mx-auto max-h-[75dvh] w-full max-w-[480px] overflow-y-auto rounded-t-3xl bg-card px-5 pt-4 pb-[max(env(safe-area-inset-bottom),20px)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold">
                材料{" "}
                <span className="text-xs font-normal text-sub">
                  {servingsLabel}
                </span>
              </h2>
              <button
                type="button"
                aria-label="材料を閉じる"
                autoFocus
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
                    <IngredientName name={i.name} />
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
          ? "border-accent/30 bg-accent-soft text-accent-deep"
          : "border-field bg-card text-ink",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function IconToggle({
  on,
  onClick,
  label,
  children,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-full border",
        on
          ? "border-accent/30 bg-accent-soft text-accent-deep"
          : "border-field bg-card text-ink",
      )}
    >
      {children}
    </button>
  );
}
