import { describe, expect, it } from "vitest";
import { cookedSchema, pantryUsedBy } from "../../src/shared/cooked";

describe("pantryUsedBy", () => {
  it("レシピの材料と名寄せで一致する冷蔵庫の行を返す（調味料は除く）", () => {
    const pantry = [
      { id: "p1", name: "玉ねぎ" },
      { id: "p2", name: "豚こま肉" },
      { id: "p3", name: "しょうゆ" },
      { id: "p4", name: "にんじん" },
    ];
    const ingredients = [
      { name: "たまねぎ", amount: "1個" },
      { name: "豚こま肉", amount: "200g" },
      { name: "醤油", amount: "大さじ1" },
      { name: "【A】酒", amount: "大さじ1" },
    ];
    expect(pantryUsedBy(ingredients, pantry).map((p) => p.id)).toEqual([
      "p1",
      "p2",
    ]);
  });
});

describe("cookedSchema", () => {
  it("人数は 1〜20、食べた人は 10 人まで・1人前は 0.5 刻み、評価は3つ", () => {
    expect(
      cookedSchema.parse({
        servings: 2,
        eaters: [{ userId: "u1", portion: 1 }],
      }),
    ).toEqual({
      servings: 2,
      eaters: [{ userId: "u1", portion: 1 }],
      note: "",
      usedPantryIds: [],
      rating: null,
      versionId: null,
    });
    expect(cookedSchema.safeParse({ servings: 0, eaters: [] }).success).toBe(
      false,
    );
    expect(
      cookedSchema.safeParse({
        servings: 2,
        eaters: [{ userId: "u1", portion: 0.3 }],
      }).success,
    ).toBe(false);
    expect(
      cookedSchema.safeParse({ servings: 2, eaters: [], rating: "great" })
        .success,
    ).toBe(false);
  });
});
