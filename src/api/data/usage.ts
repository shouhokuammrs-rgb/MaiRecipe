// AI の使用量（DEC-025）。AI の鍵はアプリ全体で1つなので、グループに関係なく日ごとの回数だけを数える。
// 誰が使ったか・何を読んだかは持たない（グループのデータではないので forGroup の外に置く）
import { and, eq, sql } from "drizzle-orm";
import { todayJst } from "../../shared/dates";
import { usageStop, type UsageKey } from "../../shared/ai-usage";
import { openDb } from "./index";
import * as s from "./schema";

export type AiMeter = {
  /** 今日の目安の9割に達していれば true（呼ばない） */
  stopped(key: UsageKey): Promise<boolean>;
  /** 1回使った（失敗しても、会社側の回数には数えられるので数える） */
  record(key: UsageKey): Promise<void>;
};

/** D1 が無い（単体のテストなど）ときは何もしない見張り */
const NO_METER: AiMeter = {
  stopped: async () => false,
  record: async () => {},
};

export function aiMeter(env: { DB?: D1Database }): AiMeter {
  if (!env.DB) return NO_METER;
  const db = openDb(env.DB);
  return {
    async stopped(key) {
      const day = todayJst();
      const r = await db
        .select({ count: s.aiUsage.count })
        .from(s.aiUsage)
        .where(and(eq(s.aiUsage.day, day), eq(s.aiUsage.key, key)))
        .limit(1);
      return usageStop(key, r[0]?.count ?? 0);
    },
    async record(key) {
      await db
        .insert(s.aiUsage)
        .values({ day: todayJst(), key, count: 1 })
        .onConflictDoUpdate({
          target: [s.aiUsage.day, s.aiUsage.key],
          set: { count: sql`${s.aiUsage.count} + 1` },
        });
    },
  };
}

/** 今日の使用量（設定画面に出す） */
export async function usageToday(env: {
  DB: D1Database;
}): Promise<{ day: string; counts: Record<string, number> }> {
  const day = todayJst();
  const rows = await openDb(env.DB)
    .select({ key: s.aiUsage.key, count: s.aiUsage.count })
    .from(s.aiUsage)
    .where(eq(s.aiUsage.day, day));
  return { day, counts: Object.fromEntries(rows.map((r) => [r.key, r.count])) };
}
