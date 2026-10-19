// 料理モードの、画面に依存しない部分（手順の中の時間を見つける・声の言葉を操作に変える）。AI は使わない。

export type CookTimer = { label: string; seconds: number };

const toHalf = (s: string) =>
  s.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));

/**
 * 手順の文から「3分」「10〜15分」「1時間半」「2分30秒」のような時間を拾う。
 * 範囲は長いほう（焦がさないよう、短いほうは画面の文で分かる）
 */
export function findTimers(step: string): CookTimer[] {
  const re =
    /([0-9０-９]+(?:[.．][0-9０-９]+)?)(?:\s*[〜~～\-－]\s*([0-9０-９]+(?:[.．][0-9０-９]+)?))?\s*(時間半|時間|分|秒)(?:\s*([0-9０-９]+)\s*秒)?/g;
  const out: CookTimer[] = [];
  for (const m of step.matchAll(re)) {
    const a = Number(toHalf(m[1]!).replace("．", "."));
    const b = m[2] ? Number(toHalf(m[2]).replace("．", ".")) : a;
    const n = Math.max(a, b);
    const unit = m[3]!;
    let seconds =
      unit === "時間半"
        ? n * 3600 + 1800
        : unit === "時間"
          ? n * 3600
          : unit === "分"
            ? n * 60
            : n;
    if (unit === "分" && m[4]) seconds += Number(toHalf(m[4]));
    // 「分」の直後が「け」（2分け）などは時間ではない
    const after = step.slice((m.index ?? 0) + m[0].length);
    if (unit === "分" && /^[けの]/.test(after) && !m[4]) continue;
    if (seconds > 0 && seconds <= 24 * 3600)
      out.push({ label: m[0].trim(), seconds: Math.round(seconds) });
  }
  return out;
}

export type VoiceCommand = "next" | "prev" | "repeat" | "ingredients" | "timer";

/** 聞き取った言葉を料理モードの操作にする。当てはまらなければ null */
export function voiceCommand(text: string): VoiceCommand | null {
  const t = text.replace(/\s/g, "");
  if (!t) return null;
  if (/もう一[回度]|もういっかい|もういちど|繰り返|くりかえ|リピート/.test(t))
    return "repeat";
  if (/戻|もど|前|まえ|バック/.test(t)) return "prev";
  if (/次|つぎ|ネクスト|進んで|すすんで/.test(t)) return "next";
  if (/材料|ざいりょう/.test(t)) return "ingredients";
  if (/タイマー/.test(t)) return "timer";
  return null;
}

/** 残り時間を「分:秒」で */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
