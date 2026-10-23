import { describe, expect, it } from "vitest";
import {
  AI_BUDGETS,
  STOP_RATIO,
  usageDay,
  usageStop,
} from "../../src/shared/ai-usage";

describe("usageStop（無料分の9割で止める）", () => {
  it("1日の目安の9割に達したら止める", () => {
    const b = AI_BUDGETS["gemini:watch_video"].perDay;
    const stopAt = Math.floor(b * STOP_RATIO);
    expect(usageStop("gemini:watch_video", stopAt - 1)).toBe(false);
    expect(usageStop("gemini:watch_video", stopAt)).toBe(true);
  });
  it("知らない作業は止めない", () => {
    expect(usageStop("unknown" as never, 9999)).toBe(false);
  });
});

describe("usageDay（会社ごとの1日の区切り）", () => {
  it("Gemini は太平洋時間、Workers AI は UTC の日付", () => {
    // 日本時間 2026-10-23 10:00 ＝ UTC 01:00 ＝ 太平洋時間 10/22 18:00
    const now = new Date("2026-10-23T01:00:00Z");
    expect(usageDay("gemini:watch_video", now)).toBe("2026-10-22");
    expect(usageDay("workers-ai:read_recipe", now)).toBe("2026-10-23");
  });
});
