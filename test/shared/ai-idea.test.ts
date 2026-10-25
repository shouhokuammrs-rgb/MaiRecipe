import { describe, expect, it } from "vitest";
import {
  buildIdeaPrompt,
  ideaSchema,
  parseIdeas,
} from "../../src/shared/ai-idea";

describe("buildIdeaPrompt", () => {
  it("使いたい食材・ほかの食材・希望を渡し、新しく考えたレシピだと分かるように頼む", () => {
    const { system, user } = buildIdeaPrompt({
      use: ["大根", "豚こま肉"],
      others: ["卵"],
      wish: "15分くらいで",
    });
    expect(user).toContain("使いたい食材：大根、豚こま肉");
    expect(user).toContain("ほかにある食材：卵");
    expect(user).toContain("希望：15分くらいで");
    expect(system).toContain("JSON");
    expect(system).toContain("3つ");
  });
});

describe("ideaSchema", () => {
  it("食材は1〜10個、希望は100字まで", () => {
    expect(ideaSchema.safeParse({ use: [] }).success).toBe(false);
    expect(
      ideaSchema.safeParse({
        use: Array.from({ length: 11 }, (_, i) => `${i}`),
      }).success,
    ).toBe(false);
    expect(ideaSchema.parse({ use: [" 大根 ", ""] })).toEqual({
      use: ["大根"],
      wish: "",
    });
  });
});

describe("parseIdeas", () => {
  it("レシピの案を最大3つ読み、分類・ジャンルは決まった中から（無ければ「その他」）", () => {
    const raw = JSON.stringify({
      ideas: [
        {
          title: "大根と豚肉の煮物",
          category: "主菜",
          genre: "和食",
          servings: "2人分",
          time: "20分",
          ingredients: [
            { name: "大根", amount: "1/4本" },
            { name: "豚こま肉", amount: 150 },
          ],
          steps: ["1. 大根を切る", "豚肉と煮る"],
          tips: [{ step: 2, text: "落としぶたをする" }],
        },
        {
          title: "大根サラダ",
          category: "おかず",
          genre: "フレンチ",
          ingredients: [{ name: "大根", amount: "" }],
          steps: ["細く切る"],
        },
        { title: "空", ingredients: [], steps: [] },
        { title: "4", ingredients: [{ name: "a" }], steps: ["b"] },
        { title: "5", ingredients: [{ name: "a" }], steps: ["b"] },
      ],
    });
    const ideas = parseIdeas(raw)!;
    expect(ideas.map((i) => i.title)).toEqual([
      "大根と豚肉の煮物",
      "大根サラダ",
      "4",
    ]);
    expect(ideas[0]).toMatchObject({
      category: "主菜",
      genre: "和食",
      servings: 2,
      timeLabel: "20分",
      ingredients: [
        { name: "大根", amount: "1/4本" },
        { name: "豚こま肉", amount: "150" },
      ],
      steps: ["大根を切る", "豚肉と煮る"],
      tips: [{ step: 2, text: "落としぶたをする" }],
    });
    expect(ideas[1]).toMatchObject({ category: "その他", genre: "その他" });
  });

  it("読めない返事は null、空なら空の配列", () => {
    expect(parseIdeas("むり")).toBeNull();
    expect(parseIdeas('{"ideas":"x"}')).toBeNull();
    expect(parseIdeas('{"ideas":[]}')).toEqual([]);
  });
});
