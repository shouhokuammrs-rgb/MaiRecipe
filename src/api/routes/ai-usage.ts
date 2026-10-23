// 今日の AI の使用量（設定画面に出す。DEC-025）。回数だけで、誰が何を読んだかは返さない
import { Hono } from "hono";
import { AI_BUDGETS, stopAt, type UsageKey } from "../../shared/ai-usage";
import { canWatchVideo } from "../ai";
import type { AppEnv } from "../app-env";
import { usageToday } from "../data/usage";

export const aiUsage = new Hono<AppEnv>();

aiUsage.get("/", async (c) => {
  const counts = await usageToday(c.env);
  return c.json({
    items: (Object.keys(AI_BUDGETS) as UsageKey[]).map((key) => ({
      key,
      label: AI_BUDGETS[key].label,
      used: counts[key],
      stopAt: stopAt(key),
      // 鍵・バインディングが無い AI は「使っていない」と出す
      available: key.startsWith("gemini:")
        ? canWatchVideo(c.env)
        : Boolean(c.env.AI),
    })),
  });
});
