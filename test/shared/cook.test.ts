import { describe, expect, it } from "vitest";
import { findTimers, formatClock, voiceCommand } from "../../src/shared/cook";

describe("findTimers（手順の中の時間をタイマーにする）", () => {
  it("分・秒・時間を拾う。範囲は長いほう", () => {
    expect(findTimers("弱火で3分ほど炒める")).toEqual([
      { label: "3分", seconds: 180 },
    ]);
    expect(findTimers("10〜15分煮込む")).toEqual([
      { label: "10〜15分", seconds: 900 },
    ]);
    expect(findTimers("30秒ゆでて、1時間おく")).toEqual([
      { label: "30秒", seconds: 30 },
      { label: "1時間", seconds: 3600 },
    ]);
    expect(findTimers("1時間半寝かせる")).toEqual([
      { label: "1時間半", seconds: 5400 },
    ]);
    expect(findTimers("２分３０秒加熱")).toEqual([
      { label: "２分３０秒", seconds: 150 },
    ]);
  });
  it("「1時間30分」は1つのタイマー", () => {
    expect(findTimers("1時間30分煮込む")).toEqual([
      { label: "1時間30分", seconds: 5400 },
    ]);
  });
  it("時間でないものは拾わない", () => {
    expect(findTimers("生地を2分割する")).toEqual([]);
    expect(findTimers("鍋の8分目まで水を入れる")).toEqual([]);
    expect(findTimers("3分の1量を加える")).toEqual([]);
    expect(findTimers("2人分の材料を用意する")).toEqual([]);
    expect(findTimers("半分に切る")).toEqual([]);
    expect(findTimers("5mm幅に切る")).toEqual([]);
  });
});

describe("voiceCommand（声での操作）", () => {
  it.each([
    ["次", "next"],
    ["つぎへ", "next"],
    ["オッケー次", "next"],
    ["戻って", "prev"],
    ["前の手順", "prev"],
    ["もう一回", "repeat"],
    ["もう一度読んで", "repeat"],
    ["材料", "ingredients"],
    ["タイマー", "timer"],
  ] as const)("「%s」→ %s", (text, cmd) => {
    expect(voiceCommand(text)).toBe(cmd);
  });
  it("手順の文や、言葉の一部では動かない（読み上げを拾っても進まない）", () => {
    expect(voiceCommand("次に肉を焼く")).toBeNull();
    expect(voiceCommand("名前")).toBeNull();
    expect(voiceCommand("手前に置く")).toBeNull();
    expect(voiceCommand("次第に色が変わる")).toBeNull();
    expect(voiceCommand("バックアップ")).toBeNull();
  });
  it("関係ない言葉は何もしない", () => {
    expect(voiceCommand("おいしそう")).toBeNull();
    expect(voiceCommand("")).toBeNull();
  });
});

describe("formatClock", () => {
  it("分:秒 で表す", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(3600)).toBe("60:00");
  });
});
