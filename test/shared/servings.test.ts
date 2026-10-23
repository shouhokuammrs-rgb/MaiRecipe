import { describe, expect, it } from "vitest";
import {
  parseServings,
  scaleAmount,
  scaleIngredients,
  servingsFromText,
  servingsNearIngredients,
} from "../../src/shared/servings";

describe("parseServings（構造化データの recipeYield）", () => {
  it.each([
    ["4人前", 4],
    ["2人分", 2],
    ["２人分", 2],
    ["2〜3人分", 2],
    ["4 servings", 4],
    ["Serves 3", 3],
    ["4", 4],
    [4, 4],
    [["4", "4人分"], 4],
  ])("%j → %s", (raw, n) => {
    expect(parseServings(raw)).toBe(n);
  });

  it.each([["作りやすい分量"], ["12個分"], [""], [null], [0], [99], ["1本分"]])(
    "人数でないものは null（%j）",
    (raw) => {
      expect(parseServings(raw)).toBeNull();
    },
  );
});

describe("servingsFromText（概要欄・ページの文）", () => {
  it("材料の見出しの人数を読む", () => {
    expect(servingsFromText("【材料】(2人分)\n鶏もも肉 300g")).toBe(2);
    expect(servingsFromText("材料（4人前）")).toBe(4);
    expect(servingsFromText("■材料 3〜4人分")).toBe(3);
  });
  it("材料の見出しの近くの人数を、他の人数より先に使う", () => {
    expect(servingsFromText("本日1人前限定！\n【材料】\n(3人分)\n卵 2個")).toBe(
      3,
    );
    expect(servingsNearIngredients("本日1人前限定")).toBeNull();
  });
  it("英語の範囲・makes", () => {
    expect(parseServings("6 to 8 servings")).toBe(6);
    expect(parseServings("Makes 4")).toBe(4);
  });

  it("人数が無ければ null", () => {
    expect(servingsFromText("鶏もも肉 300g\n塩 少々")).toBeNull();
    expect(servingsFromText("10個分")).toBeNull();
  });
});

describe("scaleAmount", () => {
  it.each([
    ["300g", 0.5, "150g"],
    ["大さじ2", 0.5, "大さじ1"],
    ["大さじ1と1/2", 2, "大さじ3"],
    ["1/2個", 2, "1個"],
    ["1個", 0.5, "1/2個"],
    ["2本", 1.5, "3本"],
    ["200ml", 1.5, "300ml"],
    ["各大さじ1", 2, "各大さじ2"],
    ["約200g", 0.5, "約100g"],
    ["2〜3個", 2, "4〜6個"],
    ["1パック（200g）", 0.5, "1/2パック（100g）"],
    ["大さじ1強", 2, "大さじ2強"],
    ["１本", 2, "2本"],
  ])("%s × %s → %s", (raw, f, out) => {
    expect(scaleAmount(raw, f)).toBe(out);
  });

  it("グラムは小数にしない", () => {
    expect(scaleAmount("200g", 2 / 3)).toBe("133g");
  });

  it("大さじが少なくなれば小さじ、小さじが多くなれば大さじにする", () => {
    expect(scaleAmount("大さじ1", 0.25)).toBe("小さじ3/4");
    expect(scaleAmount("小さじ1", 3)).toBe("大さじ1");
    expect(scaleAmount("小さじ1", 2)).toBe("小さじ2");
  });

  it("小さじ1/4より少なければ少々・g は分数にしない", () => {
    expect(scaleAmount("小さじ1/3", 0.5)).toBe("少々");
    expect(scaleAmount("小さじ1/4", 1.5)).toBe("小さじ1/3");
    expect(scaleAmount("5g", 0.5)).toBe("2.5g");
  });

  it("数えられない分量・倍率1はそのまま", () => {
    expect(scaleAmount("少々", 2)).toBe("少々");
    expect(scaleAmount("適量", 0.5)).toBe("適量");
    expect(scaleAmount("", 2)).toBe("");
    expect(scaleAmount("大さじ 2", 1)).toBe("大さじ 2");
  });
});

describe("scaleIngredients", () => {
  it("人数の比で分量を変え、名前は触らない", () => {
    expect(
      scaleIngredients(
        [
          { name: "【A】しょうゆ", amount: "大さじ2" },
          { name: "塩", amount: "少々" },
        ],
        4,
        2,
      ),
    ).toEqual([
      { name: "【A】しょうゆ", amount: "大さじ1" },
      { name: "塩", amount: "少々" },
    ]);
  });
  it("元の人数が分からなければそのまま", () => {
    const list = [{ name: "塩", amount: "1g" }];
    expect(scaleIngredients(list, null, 2)).toBe(list);
  });
});
