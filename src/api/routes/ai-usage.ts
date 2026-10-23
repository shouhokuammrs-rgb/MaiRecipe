// 今日の AI の使用量（設定画面に出す。DEC-025）。回数だけで、誰が何を読んだかは返さない
import { Hono } from "hono";
import { AI_BUDGETS, STOP_RATIO, type UsageKey } from "../../shared/ai-usage";
import type { AppEnv } from "../app-env";
import { usageToday } from "../data/usage";

export const aiUsage = new Hono<AppEnv>();

aiUsage.get("/", async (c) => {
  const { day, counts } = await usageToday(c.env);
  return c.json({
    day,
    items: (Object.keys(AI_BUDGETS) as UsageKey[]).map((key) => ({
      key,
      label: AI_BUDGETS[key].label,
      used: counts[key] ?? 0,
      stopAt: Math.floor(AI_BUDGETS[key].perDay * STOP_RATIO),
    })),
  });
});
