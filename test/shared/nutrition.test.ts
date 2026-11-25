import { describe, expect, it } from "vitest";
import { FOOD_ROWS } from "../../src/shared/nutrition-data";
import {
  NUTRIENT_IDS,
  foodFor,
  gramsOf,
  highNutrients,
  levelOf,
  mainSources,
  rankByNutrient,
  recipeNutrition,
} from "../../src/shared/nutrition";

const food = (name: string) => {
  const f = foodFor(name);
  if (!f) throw new Error(`食材が見つからない: ${name}`);
  return f;
};
const at = (id: (typeof NUTRIENT_IDS)[number]) => NUTRIENT_IDS.indexOf(id);

describe("成分表のデータ", () => {
  it("どの食材も 8 つの栄養素を持ち、成分表の食品番号（5桁）が付いている", () => {
    for (const f of FOOD_ROWS) {
      expect(f.per100g).toHaveLength(NUTRIENT_IDS.length);
      expect(f.no).toMatch(/^\d{5}$/);
      expect(() => new RegExp(f.pattern)).not.toThrow();
    }
  });
  it("成分表の値がそのまま入っている（小松菜の鉄 2.8mg・木綿豆腐のカルシウム 93mg）", () => {
    expect(food("小松菜").per100g[at("iron")]).toBe(2.8);
    expect(food("木綿豆腐").per100g[at("calcium")]).toBe(93);
  });

  it("添加物のビタミンC（ハム・ベーコン）は数えない", () => {
    expect(food("ベーコン").per100g[at("vitaminC")]).toBe(0);
    expect(food("ハム").per100g[at("vitaminC")]).toBe(0);
    expect(food("ピーマン").per100g[at("vitaminC")]).toBe(76);
  });
});

describe("材料名 → 成分表の食材", () => {
  it.each([
    ["たまねぎ", "玉ねぎ"],
    ["鶏もも肉（皮なし）", "鶏もも肉"],
    ["豚こま切れ肉", "豚もも肉"],
    ["豚肉", "豚もも肉"],
    ["豚肩ロース", "豚ロース肉"],
    ["合いびき肉", "合いびき肉"],
    ["牛豚合いびき肉", "合いびき肉"],
    ["★醤油", "醤油"],
    ["ごま油", "油"],
    ["オリーブオイル", "油"],
    ["白ごま", "ごま"],
    ["切り干し大根", "切り干し大根"],
    ["大根おろし", "大根"],
    ["干ししいたけ", "干ししいたけ"],
    ["ミニトマト", "ミニトマト"],
    ["カットトマト缶", "トマト缶"],
    ["サバ缶", "さば缶"],
    ["生鮭", "鮭"],
    ["絹ごし豆腐", "絹豆腐"],
    ["豆腐", "木綿豆腐"],
    ["高野豆腐", "高野豆腐"],
    ["ねぎ", "長ねぎ"],
    ["小ねぎ", "青ねぎ"],
    ["卵", "卵"],
    ["卵 L", "卵"],
    ["おろし生姜", "しょうが"],
    ["レモン汁", "レモン汁"],
    ["ピザ用チーズ", "チーズ"],
    ["生ハム", "生ハム"],
    ["卵黄", "卵黄"],
    ["豚ロース薄切り肉", "豚薄切り肉"],
    ["牛薄切り肉", "牛薄切り肉"],
    ["とりもも肉", "鶏もも肉"],
    ["絹さや", "スナップえんどう"],
    ["桜えび", "桜えび"],
    ["生わかめ", "生わかめ"],
    ["乾燥わかめ", "わかめ"],
    ["ひじき（水戻し）", "ひじき"],
    ["ひじきの水煮", "ひじき（戻したもの）"],
    ["冷凍むきあさり", "あさり（むき身）"],
    ["レモン", "レモン汁"],
    ["だいこん", "大根"],
    ["かつおぶし", "かつお節"],
    ["うなぎの蒲焼き", "うなぎ"],
    ["ゴーヤ", "ゴーヤ"],
    ["手羽元", "手羽"],
    ["ツナ缶", "ツナ缶"],
    ["オイスターソース", "オイスターソース"],
  ])("%s → %s", (name, key) => {
    expect(foodFor(name)?.key).toBe(key);
  });

  it.each([
    "鶏がらスープの素",
    "コーンスープ",
    "コーンスターチ",
    "スイカ",
    "ピーナッツバター",
    "卵豆腐",
    "米粉",
    "紅しょうが",
    "だし醤油",
    "塩",
    "水",
    "たらの芽",
    "トマトジュース",
    "生きくらげ",
    "アーモンドミルク",
    "アーモンドパウダー",
    "いちごジャム",
    "りんごジュース",
    "みかん缶",
    "たこ焼き粉",
    "たこ糸",
    "とろろ昆布",
    "青のり",
    "のりの佃煮",
    "昆布だし",
    "昆布茶",
    "あさりだし",
    "牡蠣醤油",
    "ステーキソース",
    "バターロール",
    "じゃがバター",
    "チーズケーキ",
    "ハムカツ",
    "ピーマンの肉詰め",
    "パプリカパウダー",
    "乾燥パセリ",
    "木綿糸",
    "ちくわぶ",
    "いかの塩辛",
    "コーンフレーク",
  ])("%s は当てはめない（別の食材と取り違えない）", (name) => {
    expect(foodFor(name)).toBeNull();
  });
});

describe("分量 → グラム", () => {
  it.each([
    ["200g", "豚こま切れ肉", 200],
    ["約200ｇ", "豚こま切れ肉", 200],
    ["1kg", "キャベツ", 1000],
    ["1枚（250g）", "鶏もも肉", 250],
    ["1枚", "鶏もも肉", 250],
    ["1/2個", "玉ねぎ", 100],
    ["1と1/2本", "にんじん", 225],
    ["2", "卵", 110],
    ["2個分", "卵", 110],
    ["小1個", "玉ねぎ", 140],
    ["1〜2本", "なす", 80],
    ["１束", "小松菜", 250],
    ["1かけ", "にんにく", 6],
    ["1丁", "豆腐", 300],
    ["大さじ1", "味噌", 18],
    ["小さじ1", "醤油", 6],
    ["各大さじ2", "みりん", 36],
    ["1カップ", "牛乳", 210],
    ["200ml", "牛乳", 210],
    ["200cc", "豆乳", 210],
    ["1缶", "サバ缶", 190],
    ["少々", "小松菜", 0],
    ["適量", "ごま", 0],
    ["ひとかけ", "にんにく", 6],
    ["1つ", "玉ねぎ", 200],
    ["ひとつ", "玉ねぎ", 200],
    ["一個", "玉ねぎ", 200],
    ["半分", "玉ねぎ", 100],
    ["半個", "玉ねぎ", 100],
    ["半丁", "豆腐", 150],
    ["1個半", "玉ねぎ", 300],
    ["1 1/2個", "玉ねぎ", 300],
    ["½個", "玉ねぎ", 100],
    ["1個くらい", "玉ねぎ", 200],
    ["1個分のみじん切り", "玉ねぎ", 200],
    ["2、3個", "玉ねぎ", 400],
    ["1から2個", "玉ねぎ", 200],
    ["中玉1個", "玉ねぎ", 200],
    ["M2個", "卵", 110],
    ["Lサイズ2個", "卵", 110],
    ["茶碗2杯分", "ご飯", 300],
    ["全形1枚", "のり", 3],
    ["8本", "えび", 120],
    ["3葉", "キャベツ", 150],
    ["5cm", "にんじん", 50],
    ["大匙2", "牛乳", 30],
    ["大2", "ヨーグルト", 30],
    ["8枚", "豚ロース薄切り肉", 160],
    ["100〜150g", "豚こま切れ肉", 100],
    ["150g×2", "鶏むね肉", 300],
    ["2個(1個200g)", "玉ねぎ", 400],
    ["2パック(各150g)", "豆腐", 300],
    ["1/2個", "レモン", 15],
  ])("%s（%s）→ %dg", (amount, name, grams) => {
    expect(gramsOf(amount, food(name))).toBeCloseTo(grams, 5);
  });

  it.each([
    ["", "玉ねぎ"],
    ["1袋", "玉ねぎ"],
    ["大さじ1", "玉ねぎ"],
    ["100ml", "玉ねぎ"],
    ["たっぷり", "小松菜"],
    ["200", "豚肉"],
    ["150", "豆腐"],
    ["200", "玉ねぎ"],
    // 厚さが分からない肉の「枚」は数えない（とんかつ用と薄切りで 5 倍違う）
    ["6枚", "豚ロース肉"],
  ])("「%s」（%s）は直せないので null（当て推量しない）", (amount, name) => {
    expect(gramsOf(amount, food(name))).toBeNull();
  });
});

describe("レシピの栄養の目安", () => {
  const komatsuna = [
    { name: "小松菜", amount: "1束" },
    { name: "厚揚げ", amount: "1枚" },
    { name: "醤油", amount: "大さじ1" },
    { name: "だしの素", amount: "小さじ1" },
  ];

  it("1人前あたりを、成分表の値 × グラム ÷ 人数で出す", () => {
    const n = recipeNutrition(komatsuna, 2);
    // 小松菜 250g×2.8 + 厚揚げ 150g×2.6 = 7.0 + 3.9（mg）→ 2人で割る。醤油（調味料）は数えない
    expect(n.perServing[at("iron")]).toBeCloseTo((7 + 3.9) / 2, 3);
    expect(n.servings).toBe(2);
    expect(n.servingsAssumed).toBe(false);
    expect(n.enough).toBe(true);
    expect(n.unknown).toEqual([]);
  });

  it("殻つきで量る貝は、食べられる分だけを数える（あさり 300g → 成分表の廃棄率 70% を引く）", () => {
    const n = recipeNutrition([{ name: "あさり", amount: "300g" }], 1);
    expect(n.perServing[at("iron")]).toBeCloseTo((300 * 0.3 * 2.2) / 100, 3);
  });

  it("人数が書いていなければ 2人分とみなし、その印を付ける", () => {
    const n = recipeNutrition(komatsuna, null);
    expect(n.servings).toBe(2);
    expect(n.servingsAssumed).toBe(true);
  });

  it("「多い」栄養素と、それを運んでいる材料が分かる", () => {
    const n = recipeNutrition(komatsuna, 2);
    expect(highNutrients(n)).toContain("iron");
    expect(highNutrients(n)).toContain("calcium");
    expect(mainSources(n, "iron")).toEqual(["小松菜", "厚揚げ"]);
  });

  it("計算できない材料の方が多いレシピは、目安を出さない", () => {
    const n = recipeNutrition(
      [
        { name: "謎の食材", amount: "100g" },
        { name: "もう1つの謎", amount: "1個" },
        { name: "小松菜", amount: "1束" },
      ],
      2,
    );
    expect(n.enough).toBe(false);
    expect(n.unknown).toEqual(["謎の食材", "もう1つの謎"]);
    expect(highNutrients(n)).toEqual([]);
  });

  it("分量が読めない材料は、分からない材料に数える", () => {
    const n = recipeNutrition([{ name: "小松菜", amount: "" }], 2);
    expect(n.unknown).toEqual(["小松菜"]);
    expect(n.enough).toBe(false);
  });

  it("肉・魚が「適量」のときは、分からない材料に数える（薬味の適量は数えない）", () => {
    const n = recipeNutrition(
      [
        { name: "豚レバー", amount: "適量" },
        { name: "もやし", amount: "1袋" },
        { name: "小ねぎ", amount: "適量" },
      ],
      2,
    );
    expect(n.unknown).toEqual(["豚レバー"]);
  });

  it("じゃがいもは加熱した値で数える（生の食物繊維 8.9g をそのまま使わない）", () => {
    expect(food("じゃがいも").source).toContain("水煮");
    expect(food("じゃがいも").per100g[at("fiber")]).toBeLessThan(5);
  });

  it("調味料しか計算できないレシピは、目安を出さない", () => {
    const n = recipeNutrition(
      [
        { name: "醤油", amount: "大さじ2" },
        { name: "砂糖", amount: "大さじ1" },
      ],
      2,
    );
    expect(n.enough).toBe(false);
  });

  it("段階は 1日の目安の 1/3 以上で「多い」、1/6 以上で「ふつう」", () => {
    expect(levelOf("iron", 6.5 / 3)).toBe("high");
    expect(levelOf("iron", 2.1)).toBe("mid");
    expect(levelOf("iron", 6.5 / 6)).toBe("mid");
    expect(levelOf("iron", 1.0)).toBe("low");
  });

  it("調味料と、だしを取って捨てる物は数えない（煮汁の醤油・かつお節で「多い」を出さない）", () => {
    const base = [
      { name: "豚バラ肉", amount: "200g" },
      { name: "キャベツ", amount: "1/4個" },
    ];
    const plain = recipeNutrition(base, 2);
    const withSauce = recipeNutrition(
      [
        ...base,
        { name: "醤油", amount: "100ml" },
        { name: "かつおぶし", amount: "30g" },
        { name: "昆布", amount: "10g" },
        { name: "味噌", amount: "大さじ3" },
      ],
      2,
    );
    expect(withSauce.perServing).toEqual(plain.perServing);
    expect(withSauce.parts.map((p) => p.name)).toEqual([
      "豚バラ肉",
      "キャベツ",
    ]);
    expect(withSauce.unknown).toEqual([]);
  });

  it("食べ切る物は数える（ごま・きな粉・粉・塩昆布・刻み昆布・おかか以外のかつお節は外す）", () => {
    const names = (ings: [string, string][]) =>
      recipeNutrition(
        ings.map(([name, amount]) => ({ name, amount })),
        2,
      ).parts.map((p) => p.name);
    expect(
      names([
        ["ほうれん草", "1束"],
        ["すりごま", "大さじ3"],
        ["練りごま", "大さじ1"],
        ["きな粉", "大さじ2"],
        ["小麦粉", "100g"],
        ["パン粉", "大さじ4"],
        ["刻み昆布", "30g"],
        ["塩昆布", "10g"],
        ["はちみつ", "大さじ1"],
      ]),
    ).toEqual([
      "ほうれん草",
      "すりごま",
      "練りごま",
      "きな粉",
      "小麦粉",
      "パン粉",
      "刻み昆布",
      "塩昆布",
      "はちみつ",
    ]);
    expect(
      names([
        ["だし昆布", "10g"],
        ["かつお節", "20g"],
        ["みりん", "大さじ2"],
        ["酒", "大さじ2"],
        ["めんつゆ", "大さじ2"],
        ["オイスターソース", "大さじ1"],
      ]),
    ).toEqual([]);
  });

  it("名前に「塩麹漬け」などが付いた肉・魚も数える", () => {
    const n = recipeNutrition(
      [
        { name: "鮭の塩麹漬け", amount: "2切れ" },
        { name: "大根", amount: "100g" },
      ],
      2,
    );
    expect(n.parts.map((p) => p.name)).toEqual(["鮭の塩麹漬け", "大根"]);
    expect(levelOf("vitaminD", n.perServing[at("vitaminD")]!)).toBe("high");
  });

  it("調味料だけ・粉だけでは目安を出さない", () => {
    const only = (ings: [string, string][]) =>
      recipeNutrition(
        ings.map(([name, amount]) => ({ name, amount })),
        2,
      ).enough;
    expect(
      only([
        ["醤油", "大さじ2"],
        ["みりん", "大さじ2"],
        ["砂糖", "大さじ1"],
      ]),
    ).toBe(false);
    expect(only([["小松菜", "少々"]])).toBe(false);
  });
});

describe("栄養で探す", () => {
  const recipes = [
    {
      id: "a",
      title: "小松菜と厚揚げの煮びたし",
      servings: 2,
      ingredients: [
        { name: "小松菜", amount: "1束" },
        { name: "厚揚げ", amount: "1枚" },
      ],
    },
    {
      id: "b",
      title: "あさりの酒蒸し",
      servings: 2,
      ingredients: [
        { name: "あさり", amount: "500g" },
        { name: "酒", amount: "大さじ2" },
      ],
    },
    {
      id: "c",
      title: "きゅうりの浅漬け",
      servings: 2,
      ingredients: [{ name: "きゅうり", amount: "2本" }],
    },
    {
      id: "d",
      title: "読めないレシピ",
      servings: 2,
      ingredients: [{ name: "謎の食材", amount: "100g" }],
    },
  ];

  it("多い順に並べ、「少なめ」と計算できないレシピは出さない", () => {
    const r = rankByNutrient(recipes, "iron");
    expect(r.ranked.map((x) => x.id)).toEqual(["a", "b"]);
    expect(r.ranked[0]!.level).toBe("high");
    expect(r.ranked[0]!.sources).toEqual(["小松菜", "厚揚げ"]);
    expect(r.skipped).toBe(1);
    expect(r.ranked[0]!.servingsAssumed).toBe(false);
    expect(
      rankByNutrient([{ ...recipes[0]!, servings: null }], "iron").ranked[0]!
        .servingsAssumed,
    ).toBe(true);
  });

  it("栄養素を変えると並びが変わる", () => {
    const r = rankByNutrient(recipes, "vitaminC");
    expect(r.ranked[0]!.id).toBe("a");
    expect(r.ranked.map((x) => x.id)).not.toContain("b");
  });
});
