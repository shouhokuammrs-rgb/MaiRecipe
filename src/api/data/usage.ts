// AI の使用量（DEC-025）。AI の鍵はアプリ全体で1つなので、グループに関係なく日ごとの回数だけを数える。
// 誰が使ったか・何を読んだかは持たない（グループのデータではないので forGroup の外に置く）
import { inArray, lt, sql } from "drizzle-orm";
import {
  AI_BUDGETS,
  stopAt,
  usageDay,
  type UsageKey,
} from "../../shared/ai-usage";
import { openDb } from "./index";
import * as s from "./schema";

export type AiMeter = {
  /**
   * 9割に達していなければ1回分を数えて true、達していれば false（呼ばない）。
   * 数えるのと確かめるのを1つの文で行う（同時に来ても上限を超えない）。
   * 失敗しても会社側では数えられるので、呼ぶ前に数える
   */
  take(key: UsageKey): Promise<boolean>;
};

/** D1 が無い（単体のテストなど）ときは何もしない見張り */
const NO_METER: AiMeter = { take: async () => true };

export function aiMeter(env: { DB?: D1Database }): AiMeter {
  if (!env.DB) return NO_METER;
  const db = openDb(env.DB);
  return {
    async take(key) {
      const limit = stopAt(key);
      if (limit < 1) return false;
      const rows = await db
        .insert(s.aiUsage)
        .values({ day: usageDay(key), key, count: 1 })
        .onConflictDoUpdate({
          target: [s.aiUsage.day, s.aiUsage.key],
          set: { count: sql`${s.aiUsage.count} + 1` },
          setWhere: lt(s.aiUsage.count, limit),
        })
        .returning({ count: s.aiUsage.count });
      return rows.length > 0;
    },
  };
}

/** 今日の使用量（設定画面に出す）。作業ごとに、その会社の「今日」で数えた回数 */
export async function usageToday(env: {
  DB: D1Database;
}): Promise<Record<UsageKey, number>> {
  const keys = Object.keys(AI_BUDGETS) as UsageKey[];
  const rows = await openDb(env.DB)
    .select({ day: s.aiUsage.day, key: s.aiUsage.key, count: s.aiUsage.count })
    .from(s.aiUsage)
    .where(inArray(s.aiUsage.day, [...new Set(keys.map((k) => usageDay(k)))]));
  const out = {} as Record<UsageKey, number>;
  for (const k of keys)
    out[k] = rows.find((r) => r.key === k && r.day === usageDay(k))?.count ?? 0;
  return out;
}
