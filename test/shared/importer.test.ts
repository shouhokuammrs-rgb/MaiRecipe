import { describe, expect, it } from "vitest";
import {
  classifyHeading,
  cleanPageTitle,
  cleanSourceUrl,
  durationLabel,
  extractRecipeFromJsonLd,
  isRecipeCandidateHost,
  parseDescriptionRecipe,
  parseVideoUrl,
  pickRecipeUrls,
  recipeFromSections,
} from "../../src/shared/importer";
import {
  DESCRIPTION_WITH_LINKS,
  DESCRIPTION_WITH_RECIPE,
  JSONLD_WITH_COMMENTS,
} from "./fixtures/import-fixtures";

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

describe("extractRecipeFromJsonLd（壊れた JSON）", () => {
  it("// や /* */ のコメントが入った JSON-LD でも読める（文字列の中の // は消さない）", () => {
    const r = extractRecipeFromJsonLd([JSONLD_WITH_COMMENTS]);
    expect(r).toMatchObject({
      title: "ダミーのクリームパスタ",
      ingredients: [
        { name: "スパゲッティ", amount: "200g" },
        { name: "牛乳", amount: "300cc" },
      ],
      steps: ["ゆでる。", "ソースと和える。"],
      timeLabel: "20分",
    });
  });
});

describe("classifyHeading", () => {
  it.each([
    ["材料（2人分）", "ingredients"],
    [" 材料 ", "ingredients"],
    ["作り方", "steps"],
    ["つくり方", "steps"],
    ["手順", "steps"],
    ["ポイント", "other"],
    ["ダミーきのこのスパゲッティ", "other"],
  ] as const)("%s → %s", (text, kind) => {
    expect(classifyHeading(text)).toBe(kind);
  });
  it("空や長すぎる文字（見出しではなく囲みの箱）は無視する", () => {
    expect(classifyHeading("   ")).toBe("ignore");
    expect(classifyHeading("材料" + "あ".repeat(40))).toBe("ignore");
  });
});

describe("recipeFromSections", () => {
  it("名前と分量の組・1行の材料・手順を整えてレシピにする", () => {
    const r = recipeFromSections({
      title: "ダミーきのこのスパゲッティ｜テスト食品",
      ingredients: [
        { name: "スパゲッティ\n", amount: "200g" },
        { name: "しめじ　", amount: "1パック" },
        { name: "玉ねぎ 1/2個", amount: "" },
        { name: "  ", amount: "" },
      ],
      steps: ["1. しめじをほぐす。", "②  スパゲッティを&amp;ゆでる。\n   ", ""],
    });
    expect(r).toEqual({
      title: "ダミーきのこのスパゲッティ",
      ingredients: [
        { name: "スパゲッティ", amount: "200g" },
        { name: "しめじ", amount: "1パック" },
        { name: "玉ねぎ", amount: "1/2個" },
      ],
      steps: ["しめじをほぐす。", "スパゲッティを&ゆでる。"],
      timeLabel: "",
      category: "主菜",
      genre: "その他",
      videoUrl: null,
    });
  });
  it("手順の頭の ①② は、前の手順を指す言葉なら消さない（1. や ① の後に空白がある番号だけ消す）", () => {
    const r = recipeFromSections({
      title: "x",
      ingredients: [],
      steps: ["②のスパゲッティを加える。", "① 焼く。", "3) 盛る。"],
    });
    expect(r?.steps).toEqual(["②のスパゲッティを加える。", "焼く。", "盛る。"]);
  });
  it("概要欄では ①鶏肉を… のような空白なしの番号も手順の番号として扱う", () => {
    expect(
      parseDescriptionRecipe("【作り方】\n①鶏肉を切る。\n②焼く。")?.steps,
    ).toEqual(["鶏肉を切る。", "焼く。"]);
  });
  it("材料も手順も無ければ null", () => {
    expect(
      recipeFromSections({ title: "x", ingredients: [], steps: [" "] }),
    ).toBeNull();
  });
});

describe("cleanPageTitle", () => {
  it("サイト名の区切りの前だけにする", () => {
    expect(cleanPageTitle("ダミーの煮物｜テスト食品")).toBe("ダミーの煮物");
    expect(cleanPageTitle("ダミーの煮物 | Site")).toBe("ダミーの煮物");
    expect(cleanPageTitle("ダミーの煮物 - Site")).toBe("ダミーの煮物");
    expect(cleanPageTitle("ダミーの煮物")).toBe("ダミーの煮物");
  });
});

describe("parseDescriptionRecipe", () => {
  it("【材料】【作り方】の区切りから材料と手順を取り出す", () => {
    expect(parseDescriptionRecipe(DESCRIPTION_WITH_RECIPE)).toEqual({
      ingredients: [
        { name: "鶏もも肉", amount: "1枚（300g）" },
        { name: "片栗粉", amount: "大さじ1" },
        { name: "しょうゆ", amount: "大さじ2" },
        { name: "みりん", amount: "大さじ2" },
      ],
      steps: [
        "鶏肉に片栗粉をまぶす。",
        "フライパンで皮目から焼く。ふたをして3分蒸し焼きにする。",
        "タレを加えて煮からめる。",
      ],
    });
  });
  it("区切りが無ければ null", () => {
    expect(parseDescriptionRecipe(DESCRIPTION_WITH_LINKS)).toBeNull();
    expect(parseDescriptionRecipe("")).toBeNull();
  });
  it("番号なしの手順は1行ずつ", () => {
    expect(
      parseDescriptionRecipe("■材料\n卵 2個\n\n■作り方\n溶く\n焼く\n#卵"),
    ).toEqual({
      ingredients: [{ name: "卵", amount: "2個" }],
      steps: ["溶く", "焼く"],
    });
  });
});

describe("pickRecipeUrls", () => {
  it("SNS と動画を飛ばし、重複を除いて最大3件", () => {
    expect(pickRecipeUrls(DESCRIPTION_WITH_LINKS)).toEqual([
      "https://recipe.example.com/recipes/123?utm_source=youtube",
      "https://other.example.org/r/9",
      "https://third.example.net/x",
    ]);
  });
  it("URL が無ければ空", () => {
    expect(pickRecipeUrls("材料はありません")).toEqual([]);
  });
});

describe("レビュー指摘の再現", () => {
  it.each([
    ["材料から探す", "other"],
    ["原材料名", "other"],
    ["材料別レシピ", "other"],
    ["作り方動画", "other"],
    ["作り方は動画をチェック", "other"],
    ["【材料】", "ingredients"],
    ["材料 2人分", "ingredients"],
    ["＜作り方＞", "steps"],
  ] as const)("見出し %s → %s", (t, kind) => {
    expect(classifyHeading(t)).toBe(kind);
  });

  it("JSON-LD の文字列に生の改行・タブがあっても読む", () => {
    // "\n" "\t" は JSON のエスケープではなく、文字列の中の生の改行・タブ
    const r = extractRecipeFromJsonLd([
      '{"@type":"Recipe","name":"ダミー\n汁","recipeIngredient":["味噌\t大さじ2"]}',
    ]);
    expect(r?.title).toBe("ダミー 汁");
    expect(r?.ingredients).toEqual([{ name: "味噌", amount: "大さじ2" }]);
  });

  it("ページの手順「2、3分焼く。」の頭は番号として外さない", () => {
    const r = recipeFromSections({
      title: "x",
      ingredients: [],
      steps: ["2、3分焼く。"],
    });
    expect(r?.steps).toEqual(["2、3分焼く。"]);
  });

  it("概要欄のふつうの文（材料3つで簡単！）は区切りにしない", () => {
    expect(
      parseDescriptionRecipe(
        "材料3つで簡単！\nおいしい\n作り方は動画をチェック\n見てね",
      ),
    ).toBeNull();
  });

  it("番号なしの手順・材料は、空行の後が箇条書きでなければ終わり", () => {
    expect(
      parseDescriptionRecipe(
        "【材料】\n卵 2個\n\nBGM：ダミー\n【作り方】\n・溶く\n・焼く\n\nいつもご視聴ありがとうございます",
      ),
    ).toEqual({
      ingredients: [{ name: "卵", amount: "2個" }],
      steps: ["溶く", "焼く"],
    });
  });

  it("URL の後ろの全角の文字・句読点は URL に含めない。amzn.asia は飛ばす", () => {
    expect(
      pickRecipeUrls(
        "https://amzn.asia/d/xyz\nレシピ→https://a.example.com/r/1。詳しくは\n(https://b.example.com/r/2)",
      ),
    ).toEqual(["https://a.example.com/r/1", "https://b.example.com/r/2"]);
  });

  it("レシピ候補のホスト", () => {
    expect(isRecipeCandidateHost("www.youtube.com")).toBe(false);
    expect(isRecipeCandidateHost("item.rakuten.co.jp")).toBe(false);
    expect(isRecipeCandidateHost("recipe.rakuten.co.jp")).toBe(true);
    expect(isRecipeCandidateHost("bit.ly")).toBe(true);
  });

  it("出典の URL から utm_* を外す。長すぎれば null", () => {
    expect(
      cleanSourceUrl(
        "https://a.example.com/r/1?utm_source=yt&id=3&utm_medium=x",
      ),
    ).toBe("https://a.example.com/r/1?id=3");
    expect(
      cleanSourceUrl("https://a.example.com/" + "a".repeat(2100)),
    ).toBeNull();
  });
});
