import { describe, expect, it } from "vitest";
import {
  classifyHeading,
  cleanPageTitle,
  cleanSourceUrl,
  durationLabel,
  extractRecipeFromJsonLd,
  isRecipeCandidateHost,
  overlapNotice,
  parseDescriptionRecipe,
  parseRecipeText,
  parseVideoUrl,
  pickRecipeUrls,
  recipeFromSections,
} from "../../src/shared/importer";
import { splitIngredientLine } from "../../src/shared/recipe";
import {
  DESCRIPTION_LOOSE,
  DESCRIPTION_LOOSE_REAL_SHAPE,
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
          recipeYield: ["2", "2人分"],
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
      servings: 2,
      tips: [],
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
      servings: null,
      tips: [],
      category: "主食",
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
  it("罫線（＊＊＊＊ など）の行と、URL のある行で材料を終える", () => {
    const desc = [
      "ダミーのきのこパスタを作ります。",
      "＊＊＊＊＊",
      "●材料(約1人前)",
      "玉ねぎ　　1/4個",
      "しめじ　　1/2pc",
      "醤油・酒・みりん　大さじ1",
      "＊＊＊＊＊",
      "●ダミーのケーキのご購入はこちら。",
      "https://shop.example.test/",
    ].join("\n");
    expect(parseDescriptionRecipe(desc)?.ingredients).toEqual([
      { name: "玉ねぎ", amount: "1/4個" },
      { name: "しめじ", amount: "1/2pc" },
      { name: "醤油・酒・みりん", amount: "大さじ1" },
    ]);
    const noRuler = [
      "●材料",
      "玉ねぎ　1/4個",
      "寄付のお知らせ https://shop.example.test/",
      "●ダミーのご購入はこちら。",
    ].join("\n");
    expect(parseDescriptionRecipe(noRuler)?.ingredients).toEqual([
      { name: "玉ねぎ", amount: "1/4個" },
    ]);
  });

  it("【材料】【作り方】の区切りから材料と手順を取り出す", () => {
    expect(parseDescriptionRecipe(DESCRIPTION_WITH_RECIPE)).toEqual({
      ingredients: [
        { name: "鶏もも肉", amount: "1枚（300g）" },
        { name: "片栗粉", amount: "大さじ1" },
        { name: "【タレ】しょうゆ", amount: "大さじ2" },
        { name: "【タレ】みりん", amount: "大さじ2" },
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
    ["材料 2〜3人分", "ingredients"],
    ["材料（2～3人分）", "ingredients"],
    ["材料・調味料", "ingredients"],
    ["材料/2人分", "ingredients"],
    ["【材料・2人分】", "ingredients"],
    ["材料 作りやすい分量", "ingredients"],
    ["作り方・手順", "steps"],
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

describe("見出しの無い概要欄・貼り付けたテキスト（parseRecipeText）", () => {
  it("罫線の区間から、全体の量・内訳・手順を読み、重なりを知らせる", () => {
    expect(parseRecipeText(DESCRIPTION_LOOSE)).toEqual({
      ingredients: [
        { name: "ダミー魚", amount: "4尾（500g）" },
        { name: "ダミー魚（塩焼き）", amount: "2尾" },
        { name: "塩（塩焼き）", amount: "小さじ1/2" },
        { name: "すだち（塩焼き）", amount: "適量" },
        { name: "ダミー魚（混ぜご飯）", amount: "2尾" },
        { name: "米（混ぜご飯）", amount: "2合" },
        { name: "醤油（混ぜご飯）", amount: "大さじ2" },
        { name: "酒（混ぜご飯）", amount: "大さじ1" },
        { name: "しょうが（混ぜご飯）", amount: "1かけ" },
      ],
      steps: [
        "魚に塩をふって10分おく",
        "グリルで両面をこんがり焼く",
        "身をほぐして炊いたご飯に混ぜる",
      ],
      overlaps: ["ダミー魚"],
    });
  });

  it("内訳だけ（全体の量が無い）なら重なりは無く、同じ材料が別のまとまりにあってもよい", () => {
    const r = parseRecipeText(
      "＝タレ＝\n醤油：大さじ2\nみりん：大さじ2\n＝仕上げ＝\n醤油：少々\nごま　適量\n焼く\n絡める",
    );
    expect(r?.ingredients).toEqual([
      { name: "【タレ】醤油", amount: "大さじ2" },
      { name: "【タレ】みりん", amount: "大さじ2" },
      { name: "醤油（仕上げ）", amount: "少々" },
      { name: "ごま（仕上げ）", amount: "適量" },
    ]);
    expect(r?.steps).toEqual(["焼く", "絡める"]);
    expect(r?.overlaps).toEqual([]);
  });

  it("まとまりの見出しが1つだけなら料理名とみなして付けない。■ も見出し", () => {
    const r = parseRecipeText(
      "■ダミー丼\nご飯 1杯\n卵 2個\n塩 ひとつまみ\nのせる",
    );
    expect(r?.ingredients).toEqual([
      { name: "ご飯", amount: "1杯" },
      { name: "卵", amount: "2個" },
      { name: "塩", amount: "ひとつまみ" },
    ]);
    expect(r?.steps).toEqual(["のせる"]);
  });

  it("罫線が無ければ全体から。ハッシュタグ・タイムスタンプは捨て、リンクの行で手順は終わり", () => {
    const r = parseRecipeText(
      "今日はダミーのスープ\n\n玉ねぎ 1個\nにんじん　1本\nコンソメ：小さじ2\n水 400ml\n\n1. 切る\n#スープ\n00:12 作る\n2. 煮る\nhttps://example.com/x\n3. リンクの後は読まない\n\nご視聴ありがとうございました",
    );
    expect(r?.ingredients.map((i) => i.name)).toEqual([
      "玉ねぎ",
      "にんじん",
      "コンソメ",
      "水",
    ]);
    expect(r?.steps).toEqual(["切る", "煮る"]);
  });

  it("「1つまみ」も分量として読む", () => {
    const r = parseRecipeText(
      "塩...1つまみ\n砂糖...小さじ1\n酢...大さじ1\n混ぜる",
    );
    expect(r?.ingredients[0]).toEqual({ name: "塩", amount: "1つまみ" });
  });

  it("材料らしい行が3行続かなければ null（ふつうの文章を材料にしない）", () => {
    expect(
      parseRecipeText("今日は 2回目の配信です\n明日は 3時から\nよろしく"),
    ).toBeNull();
    expect(parseRecipeText(DESCRIPTION_WITH_LINKS)).toBeNull();
    expect(parseRecipeText("")).toBeNull();
  });

  it("【材料】【作り方】の区切りがあれば、今まで通りの読み方を先に使う", () => {
    expect(parseRecipeText(DESCRIPTION_WITH_RECIPE)).toEqual({
      ...parseDescriptionRecipe(DESCRIPTION_WITH_RECIPE),
      overlaps: [],
    });
  });
});

describe("overlapNotice", () => {
  it("重なりが無ければ null、あれば材料名を入れた注意", () => {
    expect(overlapNotice([])).toBeNull();
    expect(overlapNotice(["ダミー魚"])).toContain("ダミー魚");
  });
});

describe("見出しの無い読み取り：レビュー指摘の再現", () => {
  it("見出しの無い本体の後に【タレ】があり、醤油が両方にあっても重なりにしない", () => {
    const r = parseRecipeText(
      "鶏肉 300g\n醤油 大さじ1\n酒 大さじ1\n【タレ】\n醤油 大さじ2\n砂糖 大さじ1\n焼く\n絡める",
    );
    expect(r?.overlaps).toEqual([]);
    expect(r?.ingredients.map((i) => i.name)).toEqual([
      "鶏肉",
      "醤油",
      "酒",
      "【タレ】醤油",
      "【タレ】砂糖",
    ]);
  });

  it("＝ が大量に並んだ行や長い行でも、すぐに返る", () => {
    const evil = [
      "=".repeat(4000) + "x",
      "塩" + " ".repeat(4000) + "…x",
      "1".repeat(4000),
      "卵 1個\n塩 少々\n砂糖 小さじ1\n混ぜる",
    ].join("\n");
    const t = performance.now();
    parseRecipeText(evil);
    expect(performance.now() - t).toBeLessThan(50);
  });

  it("空行と見出しが大量にあっても、すぐに返る", () => {
    const text = [
      ...Array(200).fill(""),
      "卵 1個",
      ...Array(190).fill("＝タレ＝"),
    ].join("\n");
    const t = performance.now();
    expect(parseRecipeText(text)).toBeNull();
    expect(performance.now() - t).toBeLessThan(50);
  });

  it("手順が無い（商品の並びだけ）なら読まない。URL の行で材料は終わる", () => {
    expect(
      parseRecipeText(
        "▼使った調味料\n・ダミー醤油 1本\n・ダミー味噌 1個\n・ダミーみりん 1本 https://amzn.to/x\n",
      ),
    ).toBeNull();
  });

  it("罫線の外でも、番号つきの手順は空行をはさんで続く", () => {
    const r = parseRecipeText(
      "卵 2個\n塩 少々\n牛乳 大さじ2\n\n1. 溶く\n\n2. 焼く\n\n3. 盛る\n\nご視聴ありがとうございました",
    );
    expect(r?.steps).toEqual(["溶く", "焼く", "盛る"]);
  });

  it("材料の後ろにあるまとまりの見出しは手順に入れない", () => {
    const r = parseRecipeText(
      "卵 2個\n塩 少々\n牛乳 大さじ2\n■トッピング\n混ぜる\n焼く",
    );
    expect(r?.steps).toEqual(["混ぜる", "焼く"]);
  });

  it("空白の無い「塩1つまみ」「胡椒適宜」も分ける", () => {
    expect(splitIngredientLine("塩1つまみ")).toEqual({
      name: "塩",
      amount: "1つまみ",
    });
    expect(splitIngredientLine("胡椒適宜")).toEqual({
      name: "胡椒",
      amount: "適宜",
    });
  });
});

describe("見出しの無い読み取り：再レビュー指摘の再現", () => {
  it("番号なしの最後の手順の後に、空行をはさんでリンクがあっても消さない", () => {
    const r = parseRecipeText(
      "卵 2個\n塩 少々\n牛乳 大さじ2\n溶く\n焼く\n\nInstagram\nhttps://example.com/ig",
    );
    expect(r?.steps).toEqual(["溶く", "焼く"]);
  });

  it("手順の後の【ポイント】で読むのをやめる", () => {
    const r = parseRecipeText(
      "卵 2個\n塩 少々\n牛乳 大さじ2\n溶く\n焼く\n【ポイント】\n強火にしない",
    );
    expect(r?.steps).toEqual(["溶く", "焼く"]);
  });
});

describe("見出しの無い読み取り：本番で読めなかった形", () => {
  it("注記の行を飛ばし、先頭の【料理名】は付けず、4尾＝2尾＋2尾を重なりとして知らせる", () => {
    expect(parseRecipeText(DESCRIPTION_LOOSE_REAL_SHAPE)).toEqual({
      ingredients: [
        { name: "ダミー魚", amount: "4尾（500g）" },
        { name: "塩", amount: "5g強" },
        { name: "砂糖", amount: "2つまみ（2g）" },
        { name: "油", amount: "大さじ1" },
        { name: "ダミー魚（塩焼き）", amount: "2尾" },
        { name: "すだち（塩焼き）", amount: "2切れ" },
        { name: "ダミー魚（混ぜご飯）", amount: "2尾" },
        { name: "ご飯（混ぜご飯）", amount: "400g" },
        { name: "ごま（混ぜご飯）", amount: "3つまみ" },
      ],
      steps: [
        "魚に塩と砂糖をふって10分おく",
        "水気をふく",
        "油で2尾を両面焼く",
        "残りも焼いて骨を取り、ご飯と混ぜる",
      ],
      overlaps: ["ダミー魚"],
    });
  });

  it("量が合わなければ（4尾と1尾＋1尾）重なりにしない", () => {
    const r = parseRecipeText(
      "【ダミー】\n魚 4尾\n塩 少々\n油 大さじ1\n＝A＝\n魚 1尾\n＝B＝\n魚 1尾\n焼く",
    );
    expect(r?.overlaps).toEqual([]);
  });
});

describe("カテゴリの推測（DEC-020：丼は主食にまとめる）", () => {
  it("ご飯もの・麺・パンは主食", async () => {
    const { guessCategory } = await import("../../src/shared/importer");
    for (const t of [
      "親子丼",
      "ナポリタン（パスタ）",
      "焼きうどん",
      "炊き込みご飯",
      "カオマンガイ",
      "ホットサンド",
      "ピザトースト",
    ])
      expect(guessCategory([t])).toBe("主食");
    expect(guessCategory(["鮭のホイル焼き"])).toBe("主菜");
    // 材料・紛らわしい言葉では主食にしない
    expect(guessCategory(["とんかつ", "豚ロース", "パン粉"])).toBe("主菜");
    expect(guessCategory(["チキングラタン", "ピザ用チーズ"])).toBe("主菜");
    expect(guessCategory(["肉じゃが", "麺つゆ"])).toBe("主菜");
    expect(guessCategory(["フライパンで焼くハンバーグ"])).toBe("主菜");
    expect(guessCategory(["ミルフィーユサンドかつ"])).toBe("主菜");
    expect(guessCategory(["パンケーキ"])).toBe("デザート");
    expect(guessCategory(["そうめん"])).toBe("主食");
    expect(guessCategory(["かぼちゃのスープ"])).toBe("汁物");
  });
});

describe("構造化データの手順（1つの手順の中の改行・紹介文）", () => {
  it("手順の中の改行では分けない。見出しと説明は1つの手順にする", async () => {
    const { extractRecipeFromJsonLd } =
      await import("../../src/shared/importer");
    const ld = JSON.stringify({
      "@type": "Recipe",
      name: "ダミーの焼き魚",
      recipeIngredient: ["ダミー魚 2切れ"],
      recipeInstructions: [
        {
          "@type": "HowToStep",
          text: "まずは動画で。YouTubeで「ダミー」と検索！",
        },
        { "@type": "HowToStep", text: "「魚」ポイント①\nバットに並べる。" },
        { "@type": "HowToStep", text: "「焼く」\n弱めの中火で2分焼く。" },
        { "@type": "HowToStep", text: "火を止める\n余熱で火を通す" },
        {
          "@type": "HowToStep",
          text: "「完成」\n香ばしく焼けたら完成。\n【ダミーシリーズ】ほかのレシピ ID12345678\n【ダミーシリーズ】もう1つ ID23456789",
        },
      ],
    });
    const r = extractRecipeFromJsonLd([ld])!;
    expect(r.steps).toEqual([
      "「魚」バットに並べる。",
      "「焼く」弱めの中火で2分焼く。",
      "火を止める 余熱で火を通す",
      "「完成」香ばしく焼けたら完成。",
    ]);
  });

  it("手順全体が1つの文字列で改行区切りのサイトは、今までどおり行で分ける", async () => {
    const { extractRecipeFromJsonLd } =
      await import("../../src/shared/importer");
    const ld = JSON.stringify({
      "@type": "Recipe",
      name: "ダミー",
      recipeIngredient: ["大根 1/2本"],
      recipeInstructions: "大根を切る。\n煮る。",
    });
    expect(extractRecipeFromJsonLd([ld])!.steps).toEqual([
      "大根を切る。",
      "煮る。",
    ]);
  });
});

describe("構造化データの手順（レビューで見つかった点）", () => {
  const steps = async (recipeInstructions: unknown) => {
    const { extractRecipeFromJsonLd } =
      await import("../../src/shared/importer");
    return extractRecipeFromJsonLd([
      JSON.stringify({
        "@type": "Recipe",
        name: "ダミー",
        recipeIngredient: ["大根 1/2本"],
        recipeInstructions,
      }),
    ])!.steps;
  };
  it("番号の付いた行は、1つの中に入っていても分ける", async () => {
    expect(await steps(["1. 玉ねぎを切る\n2. 炒める"])).toEqual([
      "玉ねぎを切る",
      "炒める",
    ]);
    expect(
      await steps([{ "@type": "HowToStep", text: "①切る<br>②炒める" }]),
    ).toEqual(["切る", "炒める"]);
  });
  it("本当の手順や言葉は消さない", async () => {
    expect(
      await steps([
        {
          "@type": "HowToStep",
          text: "【おすすめの切り方】玉ねぎは繊維に沿って切る",
        },
        { "@type": "HowToStep", text: "火加減のコツ1つ目は弱火" },
        { "@type": "HowToStep", text: "ポイント2つを押さえる" },
      ]),
    ).toEqual([
      "【おすすめの切り方】玉ねぎは繊維に沿って切る",
      "火加減のコツ1つ目は弱火",
      "ポイント2つを押さえる",
    ]);
  });
  it("「関連レシピID12345678」のような紹介は除く", async () => {
    expect(
      await steps([
        { "@type": "HowToStep", text: "煮る\n関連レシピID12345678" },
      ]),
    ).toEqual(["煮る"]);
  });
});
