import { describe, expect, it } from "vitest";
import {
  formatAmount,
  formatNumber,
  parseAmount,
} from "../../src/shared/amount";

describe("parseAmount", () => {
  it.each([
    ["大さじ2", 2, "大さじ"],
    ["大さじ1と1/2", 1.5, "大さじ"],
    ["小さじ1/2", 0.5, "小さじ"],
    ["300g", 300, "g"],
    ["1/2個", 0.5, "個"],
    ["２本", 2, "本"],
    ["1.5カップ", 1.5, "カップ"],
    ["大さじ 3", 3, "大さじ"],
  ])("%s → %s %s", (raw, qty, unit) => {
    expect(parseAmount(raw)).toEqual({ qty, unit });
  });

  it("数えられない分量は qty=null で残す", () => {
    expect(parseAmount("少々")).toEqual({ qty: null, unit: "少々" });
    expect(parseAmount("")).toEqual({ qty: null, unit: "" });
  });

  it("分母0は読めない扱い", () => {
    expect(parseAmount("1/0個").qty).toBeNull();
  });
});

describe("formatAmount", () => {
  it("大さじ・小さじは前に付ける", () => {
    expect(formatAmount({ qty: 1.5, unit: "大さじ" })).toBe("大さじ1と1/2");
  });
  it("それ以外は後ろに付ける", () => {
    expect(formatAmount({ qty: 2.5, unit: "個" })).toBe("2と1/2個");
    expect(formatAmount({ qty: 0.25, unit: "本" })).toBe("1/4本");
  });
  it("分数にならない値は小数1桁", () => {
    expect(formatNumber(1.3)).toBe("1.3");
  });
});
