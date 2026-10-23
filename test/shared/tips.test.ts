import { describe, expect, it } from "vitest";
import {
  TIPS_MAX,
  TIP_MAX,
  parseAiTips,
  tipsForStep,
  tipsFromText,
} from "../../src/shared/tips";

describe("tipsFromText（ページのコツ・ポイント欄）", () => {
  it("行ごとに分け、箇条書きの印を外す", () => {
    expect(
      tipsFromText(
        "・玉ねぎはしっかり炒めると甘みが出ます。\n\n・ヨーグルトは無糖を使ってください。",
      ),
    ).toEqual([
      { step: null, text: "玉ねぎはしっかり炒めると甘みが出ます。" },
      { step: null, text: "ヨーグルトは無糖を使ってください。" },
    ]);
  });

  it("「手順3で」「③の」のように手順を指していれば、その手順に付ける", () => {
    expect(tipsFromText("手順3で強火にすると焦げます", 5)[0]?.step).toBe(3);
    expect(tipsFromText("③のときは弱火で", 5)[0]?.step).toBe(3);
    // 手順の数を超える番号は付けない
    expect(tipsFromText("手順9で", 5)[0]?.step).toBeNull();
  });

  it("行頭の①②は箇条書きの番号として外し、手順にはしない", () => {
    expect(tipsFromText("①玉ねぎはよく炒める\n②塩は最後に", 5)).toEqual([
      { step: null, text: "玉ねぎはよく炒める" },
      { step: null, text: "塩は最後に" },
    ]);
    expect(
      tipsFromText("3分ほど煮る\n2〜3回に分けて", 5).map((t) => t.step),
    ).toEqual([null, null]);
  });

  it("件数と長さに上限がある。空なら空の配列", () => {
    const many = Array.from({ length: 20 }, (_, k) => `コツ${k}`).join("\n");
    expect(tipsFromText(many)).toHaveLength(TIPS_MAX);
    expect(tipsFromText("あ".repeat(500))[0]!.text.length).toBe(TIP_MAX);
    expect(tipsFromText("  \n ")).toEqual([]);
  });
});

describe("parseAiTips（AI の返事）", () => {
  it("手順番号と文を読み、手順の範囲外は全体のコツにする", () => {
    expect(
      parseAiTips(
        [
          { step: 2, text: "皮目から焼く" },
          { step: 99, text: "冷めてもおいしい" },
          { step: null, text: "  " },
          "強火で一気に",
        ],
        4,
      ),
    ).toEqual([
      { step: 2, text: "皮目から焼く" },
      { step: null, text: "冷めてもおいしい" },
      { step: null, text: "強火で一気に" },
    ]);
  });
  it("配列でなければ空", () => {
    expect(parseAiTips(undefined, 3)).toEqual([]);
    expect(parseAiTips("x", 3)).toEqual([]);
  });
});

describe("tipsForStep", () => {
  it("手順に付いたコツだけを返す（手順は1始まり）", () => {
    const tips = [
      { step: 1, text: "a" },
      { step: null, text: "b" },
      { step: 1, text: "c" },
    ];
    expect(tipsForStep(tips, 1)).toEqual(["a", "c"]);
    expect(tipsForStep(tips, null)).toEqual(["b"]);
  });
  it("手順の数を超えた番号のコツは、全体のコツとして出す", () => {
    const tips = [{ step: 5, text: "x" }];
    expect(tipsForStep(tips, null, 3)).toEqual(["x"]);
    expect(tipsForStep(tips, 5, 3)).toEqual([]);
  });
});
