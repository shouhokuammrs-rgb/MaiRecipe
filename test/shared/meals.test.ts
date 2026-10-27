import { describe, expect, it } from "vitest";
import {
  buildMealPhotoPrompt,
  mealAddSchema,
  parseMealPhoto,
  summarizeMeals,
} from "../../src/shared/meals";

describe("mealAddSchema", () => {
  it("名前は必須、人前は 0.5 刻み、カロリーは 0〜5000 の整数か null", () => {
    expect(
      mealAddSchema.parse({ date: "2026-10-27", title: " 牛丼 並 " }),
    ).toEqual({
      date: "2026-10-27",
      meal: null,
      title: "牛丼 並",
      portion: 1,
      kcal: null,
    });
    expect(
      mealAddSchema.safeParse({ date: "2026-10-27", title: "", kcal: 100 })
        .success,
    ).toBe(false);
    expect(
      mealAddSchema.safeParse({ date: "2026-10-27", title: "x", kcal: 12.5 })
        .success,
    ).toBe(false);
    expect(
      mealAddSchema.safeParse({ date: "2026-10-27", title: "x", meal: "tea" })
        .success,
    ).toBe(false);
  });
});

describe("parseMealPhoto", () => {
  it("料理名と概算カロリーを読む。読めなければ null", () => {
    expect(buildMealPhotoPrompt()).toContain("kcal");
    expect(
      parseMealPhoto(
        '{"title":"牛丼（並）","kcal":"650","items":["牛丼","味噌汁"],"note":"x"}',
      ),
    ).toEqual({ title: "牛丼（並）", kcal: 650, items: ["牛丼", "味噌汁"] });
    expect(parseMealPhoto('{"title":"","kcal":null}')).toBeNull();
    expect(parseMealPhoto('{"title":"サラダ","kcal":-5}')).toEqual({
      title: "サラダ",
      kcal: null,
      items: [],
    });
    expect(parseMealPhoto("むり")).toBeNull();
  });
});

describe("summarizeMeals", () => {
  it("日ごとに、品数と分かる分のカロリーを足す（分からない品があれば印）", () => {
    const out = summarizeMeals([
      { date: "2026-10-27", title: "a", portion: 1, kcal: 600 },
      { date: "2026-10-27", title: "b", portion: 0.5, kcal: 400 },
      { date: "2026-10-27", title: "c", portion: 1, kcal: null },
      { date: "2026-10-26", title: "d", portion: 2, kcal: 300 },
    ]);
    expect(out).toEqual([
      { date: "2026-10-27", count: 3, kcal: 800, partial: true },
      { date: "2026-10-26", count: 1, kcal: 600, partial: false },
    ]);
  });
});
