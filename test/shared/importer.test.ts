import { describe, expect, it } from "vitest";
import {
  durationLabel,
  extractRecipeFromJsonLd,
  parseVideoUrl,
} from "../../src/shared/importer";

describe("parseVideoUrl", () => {
  it.each([
    "https://www.youtube.com/watch?v=abcDEF12345",
    "https://youtu.be/abcDEF12345?t=10",
    "https://m.youtube.com/shorts/abcDEF12345",
  ])("%s", (url) => {
    expect(parseVideoUrl(url)).toMatchObject({
      provider: "youtube",
      id: "abcDEF12345",
    });
  });
  it("YouTube 以外は null", () => {
    expect(parseVideoUrl("https://example.com/watch?v=abcDEF12345")).toBeNull();
    expect(parseVideoUrl("not a url")).toBeNull();
  });
});

describe("extractRecipeFromJsonLd", () => {
  it("@graph の中の Recipe から材料・手順・時間・分類を取り出す", () => {
    const ld = JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebPage", name: "ページ" },
        {
          "@type": ["Recipe"],
          name: "鶏むね肉の甘酢炒め",
          recipeCategory: "主菜",
          recipeCuisine: "中華",
          totalTime: "PT20M",
          recipeIngredient: ["鶏むね肉 300g", "たまねぎ　1個", "酢大さじ3"],
          recipeInstructions: [
            { "@type": "HowToStep", text: "鶏肉を<b>そぎ切り</b>にする。" },
            {
              "@type": "HowToSection",
              itemListElement: [{ "@type": "HowToStep", text: "焼く。" }],
            },
          ],
          video: {
            "@type": "VideoObject",
            embedUrl: "https://www.youtube.com/embed/abcDEF12345",
          },
        },
      ],
    });
    const r = extractRecipeFromJsonLd(["{broken", ld]);
    expect(r).toEqual({
      title: "鶏むね肉の甘酢炒め",
      ingredients: [
        { name: "鶏むね肉", amount: "300g" },
        { name: "たまねぎ", amount: "1個" },
        { name: "酢", amount: "大さじ3" },
      ],
      steps: ["鶏肉をそぎ切りにする。", "焼く。"],
      timeLabel: "20分",
      category: "主菜",
      genre: "中華",
      videoUrl: "https://www.youtube.com/watch?v=abcDEF12345",
    });
  });

  it("手順が1つの文字列に改行で入っていても分ける", () => {
    const r = extractRecipeFromJsonLd([
      JSON.stringify({
        "@type": "Recipe",
        name: "豚汁",
        recipeIngredient: ["味噌 大さじ3"],
        recipeInstructions: "切る。<br>煮る。\n味噌を溶く。",
        recipeCategory: "汁物",
      }),
    ]);
    expect(r?.steps).toEqual(["切る。", "煮る。", "味噌を溶く。"]);
    expect(r?.category).toBe("汁物");
    expect(r?.genre).toBe("和食");
  });

  it("Recipe が無ければ null", () => {
    expect(
      extractRecipeFromJsonLd([JSON.stringify({ "@type": "Article" })]),
    ).toBeNull();
  });

  it("時間の表記", () => {
    expect(durationLabel("PT1H20M")).toBe("1時間20分");
    expect(durationLabel("PT1H")).toBe("1時間");
    expect(durationLabel("")).toBe("");
  });
});
