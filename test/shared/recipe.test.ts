import { describe, expect, it } from "vitest";
import {
  canonicalName,
  matchesIngredient,
  shopSection,
} from "../../src/shared/ingredients";
import { diffVersions, splitIngredientLine } from "../../src/shared/recipe";

const base = {
  title: "甘酢炒め",
  ingredients: [
    { name: "鶏むね肉", amount: "300g" },
    { name: "酢", amount: "大さじ3" },
    { name: "砂糖", amount: "大さじ2" },
  ],
  steps: ["切る", "焼く", "絡める"],
};

describe("diffVersions", () => {
  it("分量の変更・材料の置き換え・手順の修正を1行ずつ書く", () => {
    const after = {
      ...base,
      ingredients: [
        { name: "鶏むね肉", amount: "300g" },
        { name: "米酢", amount: "大さじ3" },
        { name: "砂糖", amount: "大さじ1と1/2" },
      ],
      steps: ["切る", "焼く", "弱火で絡める"],
    };
    expect(diffVersions(base, after)).toEqual([
      "砂糖 大さじ2 → 大さじ1と1/2",
      "酢 → 米酢",
      "作り方を修正（1か所）",
    ]);
  });

  it("追加と削除、レシピ名の変更", () => {
    const after = {
      title: "甘酢チキン",
      ingredients: [...base.ingredients, { name: "ピーマン", amount: "2個" }],
      steps: ["切る", "焼く"],
    };
    expect(diffVersions(base, after)).toEqual([
      "レシピ名 → 甘酢チキン",
      "追加：ピーマン 2個",
      "作り方を修正（1か所）",
    ]);
  });

  it("変更がなければ空", () => {
    expect(diffVersions(base, base)).toEqual([]);
  });
});

describe("splitIngredientLine", () => {
  it.each([
    ["玉ねぎ 1個", "玉ねぎ", "1個"],
    ["鶏むね肉300g", "鶏むね肉", "300g"],
    ["しょうゆ　大さじ2", "しょうゆ", "大さじ2"],
    ["塩少々", "塩", "少々"],
    ["お好みで大葉", "お好みで大葉", ""],
    // 商品名に空白がある：分量らしい最後の区切りで分ける
    [
      "ブランド　もちもちスパゲッティ　1.8mm　200g",
      "ブランド もちもちスパゲッティ 1.8mm",
      "200g",
    ],
    [
      "マッシュルーム・エリンギ　各1パック（約180g）",
      "マッシュルーム・エリンギ",
      "各1パック（約180g）",
    ],
    ["塩・こしょう　小さじ1/2、適量", "塩・こしょう", "小さじ1/2、適量"],
    ["パセリ　適宜", "パセリ", "適宜"],
    // 分量の後ろに補足があっても、分量の頭で分ける
    ["鶏もも肉 1枚 (300g)", "鶏もも肉", "1枚 (300g)"],
    // 分量らしいところが無ければ、今まで通り最初の区切りで
    ["卵 Mサイズ", "卵", "Mサイズ"],
  ])("%s", (line, name, amount) => {
    expect(splitIngredientLine(line)).toEqual({ name, amount });
  });
});

describe("名寄せと売り場", () => {
  it("表記ゆれを1つにそろえる", () => {
    expect(canonicalName("たまねぎ")).toBe("玉ねぎ");
    expect(canonicalName("◎しょうゆ")).toBe("醤油");
    expect(canonicalName("人参（中）")).toBe("にんじん");
  });
  it("売り場を判定する", () => {
    expect(shopSection("鶏もも肉")).toBe("肉・魚・卵");
    expect(shopSection("しめじ")).toBe("野菜・きのこ");
    expect(shopSection("しょうゆ")).toBe("調味料");
    expect(shopSection("木綿豆腐")).toBe("その他");
  });
  it("「鶏肉」は鶏むね肉・鶏もも肉に当たる。豚肉には当たらない", () => {
    expect(matchesIngredient("鶏肉", "鶏むね肉")).toBe(true);
    expect(matchesIngredient("鶏肉", "鶏もも肉")).toBe(true);
    expect(matchesIngredient("鶏肉", "豚こま肉")).toBe(false);
    expect(matchesIngredient("たまねぎ", "玉ねぎ")).toBe(true);
  });
});
