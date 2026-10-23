// AI の使用量の見張り（#36 / DEC-025）。無料枠の会社側の上限に当たる前に、1日の目安の9割で止める。
// 目安は会社の上限より控えめ（料理中のアシスタントの分を残すため、取り込みの目安を小さめにしている）。
// 会社側の上限は AI Studio・Cloudflare のダッシュボードで見られる。変わったらここを直す

export type UsageKey =
  | "gemini:watch_video"
  | "gemini:cook_assist"
  | "workers-ai:read_recipe"
  | "workers-ai:cook_assist";

export const AI_BUDGETS: Record<UsageKey, { label: string; perDay: number }> = {
  "gemini:watch_video": { label: "動画を見て読む（Gemini）", perDay: 40 },
  "gemini:cook_assist": { label: "料理アシスタント（Gemini）", perDay: 300 },
  "workers-ai:read_recipe": { label: "文章を読む（Workers AI）", perDay: 60 },
  "workers-ai:cook_assist": {
    label: "料理アシスタントの予備（Workers AI）",
    perDay: 60,
  },
};

/** この割合に達したら止める */
export const STOP_RATIO = 0.9;

/** 今日これだけ使ったら、もう呼ばない */
export function usageStop(key: UsageKey, usedToday: number): boolean {
  const b = AI_BUDGETS[key];
  if (!b) return false;
  return usedToday >= Math.floor(b.perDay * STOP_RATIO);
}
