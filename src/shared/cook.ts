// 料理モードの、画面に依存しない部分（手順の中の時間を見つける・声の言葉を操作に変える）。AI は使わない。

export type CookTimer = { label: string; seconds: number };

const toHalf = (s: string) =>
  s.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));

const NUM = "([0-9０-９]+(?:[.．][0-9０-９]+)?)";
const num = (t: string) => Number(toHalf(t).replace("．", "."));

/**
 * 手順の文から「3分」「10〜15分」「1時間半」「1時間30分」「2分30秒」のような時間を拾う。
 * 範囲は長いほう（焦がさないよう、短いほうは画面の文で分かる）。
 * 「2分割」「8分目」「3分の1」は時間ではないので拾わない
 */
export function findTimers(step: string): CookTimer[] {
  const re = new RegExp(
    `${NUM}(?:\\s*[〜~～\\-－]\\s*${NUM})?\\s*(時間半|時間|分|秒)(?:\\s*${NUM}\\s*(分|秒))?`,
    "g",
  );
  const out: CookTimer[] = [];
  for (const m of step.matchAll(re)) {
    const n = Math.max(num(m[1]!), m[2] ? num(m[2]) : 0);
    const unit = m[3]!;
    const subN = m[4] ? num(m[4]) : 0;
    const subUnit = m[5];
    // 続きの単位は、時間 → 分、分 → 秒 の組だけ
    const subOk =
      subUnit &&
      ((unit === "時間" && subUnit === "分") ||
        (unit === "分" && subUnit === "秒"));
    let seconds =
      unit === "時間半"
        ? n * 3600 + 1800
        : unit === "時間"
          ? n * 3600
          : unit === "分"
            ? n * 60
            : n;
    let label = m[0].trim();
    if (subOk) seconds += subUnit === "分" ? subN * 60 : subN;
    else if (subUnit) {
      // 続きが別の時間（「30秒ゆでて、1時間」など）は、最初の部分だけにする
      label = step
        .slice(m.index ?? 0)
        .match(
          new RegExp(
            `^${NUM}(?:\\s*[〜~～\\-－]\\s*${NUM})?\\s*(時間半|時間|分|秒)`,
          ),
        )![0];
    }
    const rest = step.slice((m.index ?? 0) + label.length);
    // 「2分割」「8分目」「3分の1」「2分け」は時間ではない
    if (unit === "分" && !subOk && /^[割目のけ]/.test(rest)) continue;
    if (seconds > 0 && seconds <= 24 * 3600)
      out.push({ label, seconds: Math.round(seconds) });
  }
  return out;
}

export type VoiceCommand = "next" | "prev" | "repeat" | "ingredients" | "timer";

const COMMANDS: [VoiceCommand, RegExp][] = [
  [
    "repeat",
    /^(?:(?:もう一[回度]|もういっかい|もういちど)(?:読んで|言って)?|繰り返して?|くりかえして?|リピート)$/,
  ],
  [
    "prev",
    /^(?:戻って|もどって|戻る|もどる|前|まえ|前へ|まえへ|前の手順|一つ前|ひとつまえ|バック)$/,
  ],
  ["next", /^(?:次|つぎ|次へ|つぎへ|次の手順|ネクスト|進んで|すすんで|進む)$/],
  ["ingredients", /^(?:材料|ざいりょう)(?:を?見せて)?$/],
  ["timer", /^タイマー(?:スタート|開始)?$/],
];

/**
 * 聞き取った言葉を料理モードの操作にする。言葉の全体が合うときだけ（「次に肉を焼く」「名前」では動かない）。
 * 当てはまらなければ null
 */
export function voiceCommand(text: string): VoiceCommand | null {
  const t = text
    .replace(/[\s。、！!？?]/g, "")
    .replace(/^(?:オッケー|OK|ok|はい|えっと|じゃあ)+/, "")
    .replace(/(?:ください|お願いします|お願い)$/, "");
  if (!t) return null;
  for (const [cmd, re] of COMMANDS) if (re.test(t)) return cmd;
  return null;
}

/** 残り時間を「分:秒」で */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
