import { describe, expect, it } from "vitest";
import {
  buildPlanPrompt,
  parsePlanSuggestion,
  type PlanInput,
} from "../../src/shared/ai-plan";

const input: PlanInput = {
  dates: ["2026-10-25", "2026-10-26"],
  meals: ["dinner"],
  recipes: [
    {
      id: "r-curry",
      title: "キーマカレー",
      category: "主食",
      genre: "洋食",
      ingredients: ["合いびき肉", "玉ねぎ"],
    },
    {
      id: "r-salad",
      title: "ごぼうサラダ",
      category: "副菜",
      genre: "和食",
      ingredients: ["ごぼう", "にんじん"],
    },
    {
      id: "r-soup",
      title: "豚汁",
      category: "汁物",
      genre: "和食",
      ingredients: ["豚こま肉", "大根"],
    },
  ],
  pantry: [{ name: "大根", soon: true }],
  recent: ["キーマカレー"],
  planned: [],
  wish: "野菜多めで",
};

describe("buildPlanPrompt", () => {
  it("レシピは番号で渡し、冷蔵庫・最近作ったもの・希望を添える", () => {
    const { user } = buildPlanPrompt(input);
    expect(user).toContain(
      "1. キーマカレー（主食・洋食）材料：合いびき肉、玉ねぎ",
    );
    expect(user).toContain("大根（期限が近い）");
    expect(user).toContain("最近作った：キーマカレー");
    expect(user).toContain("野菜多めで");
    expect(user).toContain("2026-10-25（日）夕食");
    // id はそのまま渡さない（番号だけ）
    expect(user).not.toContain("r-curry");
  });
});

describe("parsePlanSuggestion", () => {
  it("番号をレシピに戻し、日付・食事・番号の範囲を確かめる", () => {
    const raw = JSON.stringify({
      plan: [
        {
          date: "2026-10-25",
          meal: "dinner",
          items: [3, 2],
          reason: "大根を使い切る",
        },
        { date: "2026-10-26", meal: "dinner", items: [1, 9, "2", 2] },
        { date: "2026-12-01", meal: "dinner", items: [1] },
        { date: "2026-10-26", meal: "breakfast", items: [1] },
        { date: "2026-10-25", meal: "dinner", items: [1] },
      ],
    });
    expect(parsePlanSuggestion(raw, input)).toEqual([
      {
        date: "2026-10-25",
        meal: "dinner",
        recipeIds: ["r-soup", "r-salad"],
        reason: "大根を使い切る",
      },
      {
        date: "2026-10-26",
        meal: "dinner",
        recipeIds: ["r-curry", "r-salad"],
        reason: "",
      },
    ]);
  });

  it("読めない返事は null", () => {
    expect(parsePlanSuggestion("むり", input)).toBeNull();
    expect(parsePlanSuggestion('{"plan":3}', input)).toBeNull();
  });
});
