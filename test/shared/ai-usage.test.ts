import { describe, expect, it } from "vitest";
import { AI_BUDGETS, STOP_RATIO, usageStop } from "../../src/shared/ai-usage";

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
