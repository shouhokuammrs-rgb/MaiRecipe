// スマホ・ブラウザの音声認識（無料・このアプリの AI は使わない）。
// 使えないブラウザでは null を返し、画面側でキーボードのマイクを案内する。

type RecognitionResultEvent = {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
};
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type RecognitionCtor = new () => Recognition;

export function speechSupported(): boolean {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

export function startListening(
  onText: (text: string) => void,
  onEnd: () => void,
): (() => void) | null {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = "ja-JP";
  rec.continuous = true;
  rec.interimResults = false;
  rec.onresult = (e) => {
    const parts: string[] = [];
    for (let i = 0; i < e.results.length; i++) {
      const alt = e.results[i]?.[0];
      if (alt) parts.push(alt.transcript);
    }
    onText(parts.join(""));
  };
  rec.onend = onEnd;
  rec.onerror = onEnd;
  rec.start();
  return () => rec.stop();
}

/**
 * 料理モード用：聞き続けて、言葉が1つ決まるたびに onPhrase を呼ぶ。
 * スマホは数秒〜数十秒で勝手に止まるので、止めるまで自動で聞き直す。
 * マイクを許可されないときはすぐやめる（何度もマイクの許可を出さない）。
 * 静かなだけ（no-speech）は失敗に数えない。戻り値で止める。使えなければ null
 */
export function listenForCommands(
  onPhrase: (text: string) => void,
  onStop: () => void,
): (() => void) | null {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  let active = true;
  let fails = 0;
  let quickEnds = 0;
  let rec: Recognition | null = null;
  const finish = () => {
    if (!active) return;
    active = false;
    onStop();
  };
  const begin = () => {
    if (!active) return;
    const startedAt = Date.now();
    rec = new Ctor();
    rec.lang = "ja-JP";
    rec.continuous = true;
    rec.interimResults = false;
    let seen = 0;
    rec.onresult = (e) => {
      fails = 0;
      quickEnds = 0;
      for (let i = seen; i < e.results.length; i++) {
        const alt = e.results[i]?.[0];
        if (alt) onPhrase(alt.transcript);
      }
      seen = e.results.length;
    };
    (rec as unknown as { onerror: (e: { error?: string }) => void }).onerror = (
      e,
    ) => {
      if (e?.error === "not-allowed" || e?.error === "service-not-allowed") {
        finish();
        rec?.stop();
        return;
      }
      if (e?.error !== "no-speech" && e?.error !== "aborted") fails++;
    };
    rec.onend = () => {
      if (!active) return;
      // すぐ終わるのが続く（ほかの音で止められる等）なら、間を空けていき、続けばあきらめる
      if (Date.now() - startedAt < 1000) quickEnds++;
      if (fails >= 3 || quickEnds >= 5) {
        finish();
        return;
      }
      setTimeout(begin, 300 * 2 ** quickEnds);
    };
    try {
      rec.start();
    } catch {
      finish();
    }
  };
  begin();
  return () => {
    active = false;
    rec?.stop();
  };
}

let lastSpokenAt = 0;

/** 読み上げ中か、読み終えてすぐ（自分の声を聞き取ってしまうのを避ける） */
export function recentlySpoke(ms = 1500): boolean {
  if ("speechSynthesis" in window && window.speechSynthesis.speaking)
    return true;
  return Date.now() - lastSpokenAt < ms;
}

/** 文を読み上げる（スマホ・ブラウザの読み上げ。無料）。今読んでいるものは止める */
export function speak(text: string): boolean {
  if (!("speechSynthesis" in window)) return false;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ja-JP";
  u.rate = 1;
  u.onend = () => {
    lastSpokenAt = Date.now();
  };
  lastSpokenAt = Date.now();
  window.speechSynthesis.speak(u);
  return true;
}

export function stopSpeaking() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

let audio: AudioContext | null = null;

/** タイマーの音の準備。iPhone はタップの中で一度鳴らす準備をしないと音が出ない */
export function unlockAlarm() {
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctx) return;
  audio ??= new Ctx();
  void audio.resume();
}

/** タイマーが終わった音（ピピピッ）。振動できる端末は振動も */
export function ringAlarm() {
  navigator.vibrate?.([300, 150, 300]);
  if (!audio) return;
  const t0 = audio.currentTime;
  for (let i = 0; i < 3; i++) {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.25, t0 + i * 0.3);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + i * 0.3 + 0.2);
    o.connect(g).connect(audio.destination);
    o.start(t0 + i * 0.3);
    o.stop(t0 + i * 0.3 + 0.22);
  }
}
