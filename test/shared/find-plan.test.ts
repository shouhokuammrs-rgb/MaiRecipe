import { describe, expect, it } from "vitest";
import { findPlan } from "../../src/shared/servings";

// 元のレシピから人数を探すかどうか（DEC-039）
describe("findPlan", () => {
  const none = new Set<string>();
  it("まだ探していない（null だけ）なら探す", () => {
    expect(findPlan("a", [null], none)).toBe("first");
    expect(findPlan("a", [null, null], none)).toBe("first");
  });
  it("前に探して無かった（0）なら、この端末で 1 回だけ探し直す", () => {
    expect(findPlan("a", [0], none)).toBe("again");
    expect(findPlan("a", [0, null], none)).toBe("again");
    expect(findPlan("a", [0], new Set(["a"]))).toBeNull();
    expect(findPlan("b", [0], new Set(["a"]))).toBe("again");
  });
  it("人数がある版が 1 つでもあれば探さない", () => {
    expect(findPlan("a", [2], none)).toBeNull();
    expect(findPlan("a", [null, 4], none)).toBeNull();
    expect(findPlan("a", [0, 3], none)).toBeNull();
  });
  it("版が無ければ探さない", () => {
    expect(findPlan("a", [], none)).toBeNull();
  });
});
