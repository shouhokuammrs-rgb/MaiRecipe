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
 * 戻り値で止める。使えなければ null
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
  let rec: Recognition | null = null;
  const begin = () => {
    if (!active) return;
    rec = new Ctor();
    rec.lang = "ja-JP";
    rec.continuous = true;
    rec.interimResults = false;
    let seen = 0;
    rec.onresult = (e) => {
      fails = 0;
      // 新しく決まった言葉だけ渡す
      for (let i = seen; i < e.results.length; i++) {
        const alt = e.results[i]?.[0];
        if (alt) onPhrase(alt.transcript);
      }
      seen = e.results.length;
    };
    rec.onerror = () => {
      fails++;
    };
    rec.onend = () => {
      // 許可されない・続けて失敗するときはあきらめる
      if (!active || fails >= 3) {
        active = false;
        onStop();
        return;
      }
      setTimeout(begin, 300);
    };
    try {
      rec.start();
    } catch {
      active = false;
      onStop();
    }
  };
  begin();
  return () => {
    active = false;
    rec?.stop();
  };
}

/** 文を読み上げる（スマホ・ブラウザの読み上げ。無料） */
export function speak(text: string): boolean {
  if (!("speechSynthesis" in window)) return false;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ja-JP";
  u.rate = 1;
  window.speechSynthesis.speak(u);
  return true;
}

export function stopSpeaking() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}
