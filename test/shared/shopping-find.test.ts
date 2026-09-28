import { describe, expect, it } from "vitest";
import {
  addDays,
  labelDate,
  todayJst,
  weekStart,
} from "../../src/shared/dates";
import { findByIngredients } from "../../src/shared/find";
import { aggregateShopping } from "../../src/shared/shopping";

describe("aggregateShopping", () => {
  it("表記ゆれをまとめ、単位ごとに合計し、売り場順に並べる", () => {
    const items = aggregateShopping([
      {
        recipeTitle: "豚汁",
        ingredients: [
          { name: "たまねぎ", amount: "1/2個" },
          { name: "味噌", amount: "大さじ3" },
        ],
      },
      {
        recipeTitle: "親子丼",
        ingredients: [
          { name: "玉ねぎ", amount: "1/2個" },
          { name: "卵", amount: "3個" },
        ],
      },
      {
        recipeTitle: "炒め",
        ingredients: [
          { name: "玉ねぎ", amount: "1個" },
          { name: "塩", amount: "少々" },
        ],
      },
    ]);
    const onion = items.find((i) => i.name === "玉ねぎ");
    expect(onion).toMatchObject({
      amount: "2個",
      recipes: ["豚汁", "親子丼", "炒め"],
      merged: ["たまねぎ"],
    });
    expect(items.map((i) => i.section)).toEqual([
      "野菜・きのこ",
      "肉・魚・卵",
      "調味料",
      "調味料",
    ]);
    expect(items.find((i) => i.name === "塩")?.amount).toBe("少々");
  });

  it("単位が違えば別の行", () => {
    const items = aggregateShopping([
      { recipeTitle: "A", ingredients: [{ name: "牛乳", amount: "200ml" }] },
      { recipeTitle: "B", ingredients: [{ name: "牛乳", amount: "1カップ" }] },
    ]);
    expect(items).toHaveLength(2);
  });
});

describe("findByIngredients", () => {
  const recipes = [
    {
      id: "a",
      title: "甘酢炒め",
      ingredients: [
        { name: "鶏むね肉", amount: "" },
        { name: "玉ねぎ", amount: "" },
        { name: "ピーマン", amount: "" },
        { name: "醤油", amount: "" },
      ],
    },
    {
      id: "b",
      title: "親子丼",
      ingredients: [
        { name: "鶏もも肉", amount: "" },
        { name: "卵", amount: "" },
        { name: "玉葱", amount: "" },
      ],
    },
    {
      id: "c",
      title: "豚汁",
      ingredients: [
        { name: "豚こま肉", amount: "" },
        { name: "大根", amount: "" },
      ],
    },
  ];
  it("当たった材料の数で並べ、調味料は買い足しに出さない", () => {
    const r = findByIngredients(["鶏肉", "たまねぎ"], recipes);
    expect(r.map((x) => x.id)).toEqual(["a", "b"]);
    expect(r[0]).toMatchObject({ matched: 2, total: 2, missing: ["ピーマン"] });
  });
  it("何も入れなければ空", () => {
    expect(findByIngredients([" "], recipes)).toEqual([]);
  });
});

describe("dates", () => {
  it("日本時間の今日", () => {
    expect(todayJst(new Date("2026-09-29T16:00:00Z"))).toBe("2026-09-30");
  });
  it("週の月曜日と日付の計算", () => {
    expect(weekStart("2026-09-30")).toBe("2026-09-28");
    expect(addDays("2026-09-30", 5)).toBe("2026-10-05");
    expect(labelDate("2026-10-04")).toMatchObject({ md: "10/4", dow: "日" });
  });
});
