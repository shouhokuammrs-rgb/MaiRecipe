// AI の使用量の見張り（#36 / DEC-025）。無料枠の会社側の上限に当たる前に、1日の目安の9割で止める。
// 目安は会社の上限より控えめ（料理中のアシスタントの分を残すため、取り込みの目安を小さめにしている）。
// 会社側の上限は AI Studio・Cloudflare のダッシュボードで見られる。変わったらここを直す

export type UsageKey =
  | "gemini:watch_video"
  | "gemini:cook_assist"
  | "workers-ai:read_recipe"
  | "workers-ai:cook_assist"
  | "gemini:memo_apply"
  | "gemini:read_photo"
  | "workers-ai:memo_apply"
  | "gemini:plan_suggest"
  | "workers-ai:plan_suggest"
  | "gemini:recipe_idea"
  | "workers-ai:recipe_idea";

export const AI_BUDGETS: Record<UsageKey, { label: string; perDay: number }> = {
  "gemini:watch_video": { label: "動画を見て読む（Gemini）", perDay: 40 },
  "gemini:cook_assist": { label: "料理アシスタント（Gemini）", perDay: 300 },
  "workers-ai:read_recipe": { label: "文章を読む（Workers AI）", perDay: 60 },
  "workers-ai:cook_assist": {
    label: "料理アシスタントの予備（Workers AI）",
    perDay: 60,
  },
  "gemini:memo_apply": { label: "メモから変更案（Gemini）", perDay: 40 },
  "gemini:plan_suggest": { label: "献立の提案（Gemini）", perDay: 20 },
  "gemini:recipe_idea": { label: "食材からレシピ案（Gemini）", perDay: 20 },
  "workers-ai:recipe_idea": {
    label: "食材からレシピ案の予備（Workers AI）",
    perDay: 20,
  },
  "workers-ai:plan_suggest": {
    label: "献立の提案の予備（Workers AI）",
    perDay: 20,
  },
  "gemini:read_photo": { label: "写真から読む（Gemini）", perDay: 30 },
  "workers-ai:memo_apply": {
    label: "メモから変更案の予備（Workers AI）",
    perDay: 30,
  },
};

/**
 * 会社ごとの「1日」の区切り。無料枠の回数が戻る時刻に合わせる
 * （Gemini は太平洋時間の0時＝日本時間の16〜17時、Workers AI は UTC の0時＝日本時間の9時）
 */
const DAY_ZONE: Record<string, string> = {
  gemini: "America/Los_Angeles",
  "workers-ai": "UTC",
};

/** その作業を数える日付（YYYY-MM-DD。会社の区切りで） */
export function usageDay(key: UsageKey, now = new Date()): string {
  const zone = DAY_ZONE[key.split(":")[0]!] ?? "UTC";
  // en-CA は YYYY-MM-DD の形で出る
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** 今日の分で、止めるまでに使える回数 */
export function stopAt(key: UsageKey): number {
  return Math.floor(AI_BUDGETS[key].perDay * STOP_RATIO);
}

/** この割合に達したら止める */
export const STOP_RATIO = 0.9;

/** 今日これだけ使ったら、もう呼ばない */
export function usageStop(key: UsageKey, usedToday: number): boolean {
  const b = AI_BUDGETS[key];
  if (!b) return false;
  return usedToday >= Math.floor(b.perDay * STOP_RATIO);
}
