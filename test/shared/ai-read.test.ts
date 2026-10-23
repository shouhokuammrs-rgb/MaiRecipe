import { describe, expect, it } from "vitest";
import {
  AI_SOURCE_MAX,
  buildReadPrompt,
  findUnverified,
  parseAiRecipe,
  unverifiedNotice,
} from "../../src/shared/ai-read";

describe("AI の返事を読む", () => {
  it("前後に説明やコードの囲みがあっても JSON を取り出す", () => {
    const raw =
      'はい。\n```json\n{"title":"小松菜の卵炒め","ingredients":[{"name":"小松菜","amount":"1束"},{"name":"卵","amount":3}],"steps":["1. 小松菜を切る","卵を炒める"],"time":"10分","servings":"2人分"}\n```';
    expect(parseAiRecipe(raw)).toEqual({
      title: "小松菜の卵炒め",
      ingredients: [
        { name: "小松菜", amount: "1束" },
        { name: "卵", amount: "3" },
      ],
      steps: ["小松菜を切る", "卵を炒める"],
      timeLabel: "10分",
      servings: 2,
      tips: [],
    });
  });

  it("人数が空・数字でなければ null（想像で決めない）", () => {
    expect(
      parseAiRecipe('{"ingredients":[{"name":"卵"}],"servings":""}')?.servings,
    ).toBeNull();
    expect(
      parseAiRecipe('{"ingredients":[{"name":"卵"}],"servings":4}')?.servings,
    ).toBe(4);
  });

  it("コツを手順の番号つきで読む", () => {
    const r = parseAiRecipe(
      '{"ingredients":[{"name":"卵"}],"steps":["割る","焼く"],"tips":[{"step":2,"text":"弱火で"},{"step":null,"text":"冷蔵庫から出しておく"}]}',
    );
    expect(r?.tips).toEqual([
      { step: 2, text: "弱火で" },
      { step: null, text: "冷蔵庫から出しておく" },
    ]);
  });

  it("材料も手順も空なら null（レシピが無かった）", () => {
    expect(parseAiRecipe('{"ingredients":[],"steps":[]}')).toBeNull();
  });

  it("JSON でなければ null", () => {
    expect(parseAiRecipe("ごめんなさい、分かりません")).toBeNull();
    expect(parseAiRecipe("{壊れた json")).toBeNull();
  });

  it("手順が {text} の形でも読む。名前の無い材料は捨てる", () => {
    const r = parseAiRecipe(
      '{"ingredients":[{"name":"","amount":"1個"},{"name":"玉ねぎ"}],"steps":[{"text":"切る"}]}',
    );
    expect(r?.ingredients).toEqual([{ name: "玉ねぎ", amount: "" }]);
    expect(r?.steps).toEqual(["切る"]);
  });
});

describe("元の文との照らし合わせ", () => {
  const source = "【材料】\n・小松菜：1束（200g）\n・卵：3個\n・たまねぎ 1/2個";
  it("元の文に無い材料だけを返す（表記ゆれ・括弧は許す）", () => {
    expect(
      findUnverified(
        [
          { name: "小松菜", amount: "1束" },
          { name: "卵（Mサイズ）", amount: "3個" },
          { name: "玉ねぎ", amount: "1/2個" },
          { name: "鶏もも肉", amount: "200g" },
        ],
        source,
      ),
    ).toEqual(["鶏もも肉"]);
  });

  it("知らせる文は、無ければ null", () => {
    expect(unverifiedNotice([])).toBeNull();
    expect(unverifiedNotice(["鶏もも肉"])).toContain("「鶏もも肉」");
  });
});

describe("プロンプト", () => {
  it("長すぎる文は上限で切る", () => {
    const { user } = buildReadPrompt("あ".repeat(AI_SOURCE_MAX + 500), "題名");
    expect(user.length).toBeLessThan(AI_SOURCE_MAX + 100);
    expect(user).toContain("題名");
  });
});
