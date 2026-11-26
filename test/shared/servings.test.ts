import { describe, expect, it } from "vitest";
import {
  parseServings,
  scaleAmount,
  scaleIngredients,
  servingsFromText,
  servingsNearIngredients,
} from "../../src/shared/servings";

describe("parseServings（構造化データの recipeYield）", () => {
  it.each([
    ["4人前", 4],
    ["2人分", 2],
    ["２人分", 2],
    ["2〜3人分", 2],
    ["4 servings", 4],
    ["Serves 3", 3],
    ["4", 4],
    [4, 4],
    [["4", "4人分"], 4],
  ])("%j → %s", (raw, n) => {
    expect(parseServings(raw)).toBe(n);
  });

  it.each([["作りやすい分量"], ["12個分"], [""], [null], [0], [99], ["1本分"]])(
    "人数でないものは null（%j）",
    (raw) => {
      expect(parseServings(raw)).toBeNull();
    },
  );
});

describe("servingsFromText（概要欄・ページの文）", () => {
  it("材料の見出しの人数を読む", () => {
    expect(servingsFromText("【材料】(2人分)\n鶏もも肉 300g")).toBe(2);
    expect(servingsFromText("材料（4人前）")).toBe(4);
    expect(servingsFromText("■材料 3〜4人分")).toBe(3);
  });
  it("材料の見出しの近くの人数を、他の人数より先に使う", () => {
    expect(servingsFromText("本日1人前限定！\n【材料】\n(3人分)\n卵 2個")).toBe(
      3,
    );
    expect(servingsNearIngredients("本日1人前限定")).toBeNull();
  });
  it("英語の範囲・makes", () => {
    expect(parseServings("6 to 8 servings")).toBe(6);
    expect(parseServings("Makes 4")).toBe(4);
  });

  it("人数が無ければ null", () => {
    expect(servingsFromText("鶏もも肉 300g\n塩 少々")).toBeNull();
    expect(servingsFromText("10個分")).toBeNull();
  });
});

describe("人数のいろいろな書き方（元のレシピの人数を取りこぼさない）", () => {
  it.each([
    ["【材料】（2人）\n鶏もも肉 1枚", 2],
    ["材料 3名分", 3],
    ["■材料 4人\n・豚肉", 4],
    ["材料\n（2〜3人）", 2],
    ["【材料】二人分", 2],
    ["材料（一人前）", 1],
    ["材料（４人分）", 4],
    ["【材料 2人用】", 2],
    ["Ingredients (4 servings)\n- rice", 4],
    ["作り方は動画で。\n分量：2名分", 2],
    ["Serves 4", 4],
    ["2〜3人前の鍋です", 2],
  ])("%j → %d", (text, n) => {
    expect(servingsFromText(text as string)).toBe(n);
  });

  it.each([
    "【材料】（作りやすい分量）\n大根 1本",
    "材料 3つで作れる！\n卵",
    "チャンネル登録者 100万人突破",
    "材料\n鶏もも肉 2枚\n玉ねぎ 1個",
    "本日のお客様は 2名でした",
    "名人が教える材料の選び方",
    "100人分の給食を作る人の話",
    "材料費 300円 2人",
    "材料費1人100円！節約おかず",
    "材料2つ！1人暮らしの簡単レシピ",
    "2人暮らし向けの材料使い切り",
    "家族4人、材料費は1000円以内",
    "たった3つの材料で5人が絶賛",
    "材料を3名の方にプレゼント",
    "【材料】\n3人の子ども用に薄味",
    "材料\n1名様1点限り",
    "材料\n・卵 2個（1人1個）",
    "料理人として一人前になるまで10年。\n今日は肉じゃがです",
    "十人十色の材料アレンジ",
    "第一人者が選ぶ材料",
    "材料\n二人三脚で作りました",
    "二十人分の材料",
    "This recipe makes 12 cookies.",
    "Aim for 5 servings of vegetables a day",
    "It serves 2 purposes",
    "4人用のホットプレートを使います",
    "材料 2人目の離乳食にも",
  ])("%j は人数として読まない", (text) => {
    expect(servingsFromText(text)).toBeNull();
  });

  it.each([
    [
      "材料3つ！3人の子どもが完食した唐揚げ\n\n【材料】（4人分）\n鶏もも肉 2枚",
      4,
    ],
    ["一人暮らしでも材料を使い切り！\n\n■材料（2人分）\n豚こま 200g", 2],
    ["材料費は2人で500円！\n▼材料（3〜4人分）\nキャベツ 1/4個", 3],
    [
      "登録者1万人ありがとう！スタッフ2名で材料を準備\n【材料】4人分\n米 2合",
      4,
    ],
    [
      "本日1人前限定のまかない！\n【材料】(2人分) 鶏もも肉1枚、玉ねぎ1/2個、にんじん1本、じゃがいも2個\n作り方",
      2,
    ],
    ["1人用の土鍋で炊くご飯。\n【材料】（2人）\n米 2合", 2],
    ["材料 二〜三人分", 2],
    ["材料（一〜二人分）", 1],
    ["This makes 12 cookies.\nIngredients\n2 cups flour\nServes 6", 6],
    ["Servings: 4\nIngredients\n- rice", 4],
    ["材料（2人〜3人分）", 2],
  ])(
    "宣伝文や別の数字があっても、材料の見出しの人数を読む：%j → %d",
    (text, n) => {
      expect(servingsFromText(text as string)).toBe(n);
    },
  );

  it("構造化データの書き方も広く読む", () => {
    expect(parseServings("二人分")).toBe(2);
    expect(parseServings("3名分")).toBe(3);
    expect(parseServings("2人用")).toBe(2);
    expect(parseServings("作りやすい分量")).toBeNull();
  });
});

describe("scaleAmount", () => {
  it.each([
    ["300g", 0.5, "150g"],
    ["大さじ2", 0.5, "大さじ1"],
    ["大さじ1と1/2", 2, "大さじ3"],
    ["1/2個", 2, "1個"],
    ["1個", 0.5, "1/2個"],
    ["2本", 1.5, "3本"],
    ["200ml", 1.5, "300ml"],
    ["各大さじ1", 2, "各大さじ2"],
    ["約200g", 0.5, "約100g"],
    ["2〜3個", 2, "4〜6個"],
    ["1パック（200g）", 0.5, "1/2パック（100g）"],
    ["大さじ1強", 2, "大さじ2強"],
    ["１本", 2, "2本"],
  ])("%s × %s → %s", (raw, f, out) => {
    expect(scaleAmount(raw, f)).toBe(out);
  });

  it("グラムは小数にしない", () => {
    expect(scaleAmount("200g", 2 / 3)).toBe("133g");
  });

  it("大さじが少なくなれば小さじ、小さじが多くなれば大さじにする", () => {
    expect(scaleAmount("大さじ1", 0.25)).toBe("小さじ3/4");
    expect(scaleAmount("小さじ1", 3)).toBe("大さじ1");
    expect(scaleAmount("小さじ1", 2)).toBe("小さじ2");
  });

  it("小さじ1/4より少なければ少々・g は分数にしない", () => {
    expect(scaleAmount("小さじ1/3", 0.5)).toBe("少々");
    expect(scaleAmount("小さじ1/4", 1.5)).toBe("小さじ1/3");
    expect(scaleAmount("5g", 0.5)).toBe("2.5g");
  });

  it("数えられない分量・倍率1はそのまま", () => {
    expect(scaleAmount("少々", 2)).toBe("少々");
    expect(scaleAmount("適量", 0.5)).toBe("適量");
    expect(scaleAmount("", 2)).toBe("");
    expect(scaleAmount("大さじ 2", 1)).toBe("大さじ 2");
  });
});

describe("scaleIngredients", () => {
  it("人数の比で分量を変え、名前は触らない", () => {
    expect(
      scaleIngredients(
        [
          { name: "【A】しょうゆ", amount: "大さじ2" },
          { name: "塩", amount: "少々" },
        ],
        4,
        2,
      ),
    ).toEqual([
      { name: "【A】しょうゆ", amount: "大さじ1" },
      { name: "塩", amount: "少々" },
    ]);
  });
  it("元の人数が分からなければそのまま", () => {
    const list = [{ name: "塩", amount: "1g" }];
    expect(scaleIngredients(list, null, 2)).toBe(list);
  });
});
