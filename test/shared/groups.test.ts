import { describe, expect, it } from "vitest";
import {
  explainStep,
  normalizeGroups,
  splitGroup,
} from "../../src/shared/groups";

const ing = (name: string, amount = "") => ({ name, amount });

describe("normalizeGroups（材料の印を【A】の形にそろえる）", () => {
  it("(A)・Ａ・【A】・A の頭の印をそろえる", () => {
    expect(
      normalizeGroups([
        ing("鶏肉", "300g"),
        ing("(A)しょうゆ", "大さじ1"),
        ing("（Ａ）みりん", "大さじ1"),
        ing("【B】砂糖", "小さじ1"),
        ing("B酢", "大さじ2"),
      ]).map((i) => i.name),
    ).toEqual(["鶏肉", "【A】しょうゆ", "【A】みりん", "【B】砂糖", "【B】酢"]);
  });
  it("★☆◎ も印として残す。ただし全部に同じ印なら、ただの箇条書きとして外す", () => {
    expect(
      normalizeGroups([
        ing("★しょうゆ"),
        ing("★みりん"),
        ing("鶏肉"),
        ing("塩"),
      ]).map((i) => i.name),
    ).toEqual(["【★】しょうゆ", "【★】みりん", "鶏肉", "塩"]);
    expect(
      normalizeGroups([ing("★しょうゆ"), ing("★みりん")]).map((i) => i.name),
    ).toEqual(["しょうゆ", "みりん"]);
    expect(normalizeGroups([ing("⭐️砂糖"), ing("塩")])[0]!.name).toBe(
      "【★】砂糖",
    );
  });
  it("英字で始まるふつうの材料名はそのまま", () => {
    expect(
      normalizeGroups([ing("Aランク卵"), ing("ABCスープの素")]).map(
        (i) => i.name,
      ),
    ).toEqual(["Aランク卵", "ABCスープの素"]);
  });
});

describe("splitGroup", () => {
  it("【A】と名前に分ける", () => {
    expect(splitGroup("【A】しょうゆ")).toEqual({
      group: "A",
      name: "しょうゆ",
    });
    expect(splitGroup("(A)しょうゆ")).toEqual({ group: "A", name: "しょうゆ" });
    expect(splitGroup("しょうゆ")).toEqual({ group: null, name: "しょうゆ" });
  });
});

describe("explainStep（手順の「A」に中身を書き足す）", () => {
  const ings = [
    ing("鶏肉"),
    ing("【A】しょうゆ"),
    ing("【A】みりん"),
    ing("★砂糖"),
    ing("★酢"),
    ing("【タレ】ごま油"),
  ];
  it.each([
    ["Aを加えて煮る", "A（しょうゆ・みりん）を加えて煮る"],
    ["(A)を混ぜる", "A（しょうゆ・みりん）を混ぜる"],
    ["Ａを回し入れる", "A（しょうゆ・みりん）を回し入れる"],
    ["★を合わせておく", "★（砂糖・酢）を合わせておく"],
    ["タレをかける", "タレ（ごま油）をかける"],
  ])("「%s」", (step, out) => {
    expect(explainStep(step, ings)).toBe(out);
  });
  it("書き足してあるとき・別の言葉の一部・無い印はそのまま", () => {
    expect(explainStep("A（しょうゆ・みりん）を加える", ings)).toBe(
      "A（しょうゆ・みりん）を加える",
    );
    expect(explainStep("Aランクの卵を割る", ings)).toBe("Aランクの卵を割る");
    expect(explainStep("Bを加える", ings)).toBe("Bを加える");
    expect(explainStep("鶏肉を焼く", ings)).toBe("鶏肉を焼く");
  });
  it("2つ以上の印を一度に", () => {
    expect(explainStep("Aと★を混ぜる", ings)).toBe(
      "A（しょうゆ・みりん）と★（砂糖・酢）を混ぜる",
    );
  });
});

describe("取り込み・買い物とのつながり", () => {
  it("買い物・冷蔵庫では印を外した名前で数える", async () => {
    const { canonicalName } = await import("../../src/shared/ingredients");
    expect(canonicalName("【A】しょうゆ")).toBe("醤油");
    expect(canonicalName("(A)しょうゆ")).toBe("醤油");
    expect(canonicalName("【★】砂糖")).toBe("砂糖");
  });
  it("構造化データの (A) は【A】にそろえる", async () => {
    const { extractRecipeFromJsonLd } =
      await import("../../src/shared/importer");
    const r = extractRecipeFromJsonLd([
      JSON.stringify({
        "@type": "Recipe",
        name: "ダミー",
        recipeIngredient: [
          "鶏肉 300g",
          "(A)しょうゆ 大さじ1",
          "(A)みりん 大さじ1",
        ],
        recipeInstructions: ["鶏肉を焼く", "(A)を加える"],
      }),
    ])!;
    expect(r.ingredients.map((i) => i.name)).toEqual([
      "鶏肉",
      "【A】しょうゆ",
      "【A】みりん",
    ]);
  });
  it("概要欄の（A）の見出しの下の材料に【A】を付ける", async () => {
    const { parseDescriptionRecipe } =
      await import("../../src/shared/importer");
    const r = parseDescriptionRecipe(
      "【材料】\n鶏肉 300g\n（A）\nしょうゆ 大さじ1\nみりん 大さじ1\n【作り方】\n1. 焼く\n2. Aを加える",
    )!;
    expect(r.ingredients.map((i) => i.name)).toEqual([
      "鶏肉",
      "【A】しょうゆ",
      "【A】みりん",
    ]);
  });
});

describe("レビューで見つかった点", () => {
  const ings = [
    ing("鶏肉"),
    ing("【A】しょうゆ"),
    ing("【A】みりん"),
    ing("【調味料】酒"),
    ing("【ソース】ケチャップ"),
  ];
  it("別の言葉の中の A・調味料・ソースには書き足さない", () => {
    expect(explainStep("ビタミンAをとる", ings)).toBe("ビタミンAをとる");
    expect(explainStep("合わせ調味料を加える", ings)).toBe(
      "合わせ調味料を加える",
    );
    expect(explainStep("ウスターソースをかける", ings)).toBe(
      "ウスターソースをかける",
    );
    expect(explainStep("最後にソースをかける", ings)).toBe(
      "最後にソース（ケチャップ）をかける",
    );
  });
  it("(A)【A】ａ も A（…）の形で1回だけ書く", () => {
    expect(explainStep("(A)を加える", ings)).toBe(
      "A（しょうゆ・みりん）を加える",
    );
    expect(explainStep("【A】を加える", ings)).toBe(
      "A（しょうゆ・みりん）を加える",
    );
    expect(explainStep("aを加える", ings)).toBe(
      "A（しょうゆ・みりん）を加える",
    );
  });
  it("カタカナが続く英字（Tボーン・Lサイズ）は印にしない", () => {
    expect(
      normalizeGroups([
        ing("Tボーンステーキ"),
        ing("Tボーン"),
        ing("Lサイズ卵"),
        ing("Lサイズ玉ねぎ"),
      ]).map((i) => i.name),
    ).toEqual(["Tボーンステーキ", "Tボーン", "Lサイズ卵", "Lサイズ玉ねぎ"]);
  });
  it("ほとんどに付いている記号は箇条書き。ただし手順で呼ばれていれば印", () => {
    expect(
      normalizeGroups([
        ing("◎豚肉"),
        ing("◎玉ねぎ"),
        ing("◎にんじん"),
        ing("塩"),
      ]).map((i) => i.name),
    ).toEqual(["豚肉", "玉ねぎ", "にんじん", "塩"]);
    expect(
      normalizeGroups([ing("★しょうゆ"), ing("★みりん")], ["★を混ぜる"]).map(
        (i) => i.name,
      ),
    ).toEqual(["【★】しょうゆ", "【★】みりん"]);
  });
  it("買い物・冷蔵庫では、かっこの無い英字は名前のまま（「Bだけの食材」「B級」を壊さない）", async () => {
    const { canonicalName } = await import("../../src/shared/ingredients");
    expect(canonicalName("Bだけの食材")).toBe("Bだけの食材");
    expect(canonicalName("Tボーン")).toBe("Tボーン");
  });
});
