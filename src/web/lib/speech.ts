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
