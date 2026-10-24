import { describe, expect, it } from "vitest";
import {
  applyMemoChanges,
  buildMemoPrompt,
  parseMemoChanges,
  type MemoRecipe,
} from "../../src/shared/memo-apply";

const recipe: MemoRecipe = {
  title: "ダミーの照り焼き",
  servings: 2,
  ingredients: [
    { name: "鶏もも肉", amount: "1枚" },
    { name: "砂糖", amount: "大さじ2" },
    { name: "しょうゆ", amount: "大さじ2" },
  ],
  steps: ["鶏肉を焼く", "タレを入れて煮からめる"],
  tips: [],
};
const MEMO = "甘すぎた。砂糖は半分でいい。最後にごま油を少し入れたい";

describe("buildMemoPrompt", () => {
  it("今のレシピと、メモをそのまま渡す", () => {
    const { user } = buildMemoPrompt(recipe, MEMO);
    expect(user).toContain("1. 鶏もも肉 1枚");
    expect(user).toContain("2. タレを入れて煮からめる");
    expect(user).toContain(MEMO);
  });
});

describe("parseMemoChanges", () => {
  const raw = JSON.stringify({
    changes: [
      {
        kind: "ingredient",
        action: "update",
        index: 2,
        name: "砂糖",
        amount: "大さじ1",
        reason: "甘すぎたので半分に",
        quote: "砂糖は半分でいい",
      },
      {
        kind: "ingredient",
        action: "add",
        name: "ごま油",
        amount: "少々",
        reason: "最後に香りを足す",
        quote: "ごま油を少し入れたい",
      },
      {
        kind: "step",
        action: "add",
        after: 2,
        text: "火を止めてごま油を回し入れる",
        reason: "ごま油を足すため",
        quote: "最後にごま油を少し入れたい",
      },
      {
        kind: "step",
        action: "update",
        index: 1,
        text: "鶏肉を皮目から焼く",
        reason: "皮をパリッとさせる",
        quote: "皮がパリパリだとおいしい",
      },
      { kind: "ingredient", action: "update", index: 9, name: "x" },
      { kind: "nonsense" },
    ],
  });

  it("番号と中身を確かめ、メモの言葉が本当にメモにあるかで「メモより」「AI の推測」を分ける", () => {
    const changes = parseMemoChanges(raw, recipe, MEMO)!;
    expect(changes.map((c) => [c.kind, c.action, c.grounded])).toEqual([
      ["ingredient", "update", true],
      ["ingredient", "add", true],
      ["step", "add", true],
      // 「皮がパリパリ」はメモに無い → AI の推測
      ["step", "update", false],
    ]);
    expect(changes[3]!.quote).toBe("");
  });

  it("変わらない変更・読めない返事は捨てる", () => {
    expect(
      parseMemoChanges(
        JSON.stringify({
          changes: [
            {
              kind: "ingredient",
              action: "update",
              index: 1,
              name: "鶏もも肉",
              amount: "1枚",
            },
          ],
        }),
        recipe,
        MEMO,
      ),
    ).toEqual([]);
    // 読めない返事は null（「案が無い」と分ける）
    expect(parseMemoChanges("ごめんなさい", recipe, MEMO)).toBeNull();
    expect(parseMemoChanges('{"changes": 1}', recipe, MEMO)).toBeNull();
  });

  it("「。」や1文字はメモの言葉とみなさない", () => {
    const one = (quote: string) =>
      parseMemoChanges(
        JSON.stringify({
          changes: [{ kind: "ingredient", action: "remove", index: 1, quote }],
        }),
        recipe,
        MEMO,
      )![0]!.grounded;
    expect(one("。")).toBe(false);
    expect(one("!!")).toBe(false);
    expect(one("た")).toBe(false);
    expect(one("甘すぎた")).toBe(true);
  });

  it("同じ材料への2つ目の「変える・消す」は使わない。番号は数字だけ・範囲外の「後に足す」は使わない", () => {
    const changes = parseMemoChanges(
      JSON.stringify({
        changes: [
          {
            kind: "ingredient",
            action: "update",
            index: 2,
            name: "砂糖",
            amount: "大さじ1",
          },
          { kind: "ingredient", action: "remove", index: 2 },
          { kind: "ingredient", action: "remove", index: true },
          { kind: "ingredient", action: "remove", index: "3" },
          { kind: "step", action: "add", after: 99, text: "どこかに" },
          { kind: "step", action: "add", after: false, text: "先頭？" },
        ],
      }),
      recipe,
      MEMO,
    )!;
    expect(changes.map((c) => [c.kind, c.action])).toEqual([
      ["ingredient", "update"],
      ["ingredient", "remove"],
      ["step", "add"],
    ]);
    expect(changes[1]).toMatchObject({ index: 3 });
    expect(changes[2]).toMatchObject({ after: null, text: "先頭？" });
  });
});

describe("applyMemoChanges", () => {
  it("選んだ変更だけを入れる（番号は元のレシピの番号）", () => {
    const changes = parseMemoChanges(
      JSON.stringify({
        changes: [
          {
            kind: "ingredient",
            action: "update",
            index: 2,
            name: "砂糖",
            amount: "大さじ1",
            quote: "砂糖は半分",
          },
          {
            kind: "ingredient",
            action: "remove",
            index: 3,
            quote: "甘すぎた",
          },
          {
            kind: "ingredient",
            action: "add",
            name: "ごま油",
            amount: "少々",
            quote: "ごま油",
          },
          { kind: "step", action: "add", after: 1, text: "皮目から焼く" },
          {
            kind: "tip",
            action: "add",
            step: 2,
            text: "砂糖は控えめに",
            quote: "甘すぎた",
          },
        ],
      }),
      recipe,
      MEMO,
    )!;
    const out = applyMemoChanges(recipe, changes);
    expect(out.ingredients).toEqual([
      { name: "鶏もも肉", amount: "1枚" },
      { name: "砂糖", amount: "大さじ1" },
      { name: "ごま油", amount: "少々" },
    ]);
    expect(out.steps).toEqual([
      "鶏肉を焼く",
      "皮目から焼く",
      "タレを入れて煮からめる",
    ]);
    // 手順が1つ増えたので、手順2のコツは手順3に付く
    expect(out.tips).toEqual([{ step: 3, text: "砂糖は控えめに" }]);
    // 動画の場面は、元の手順に付いたまま（足した手順は無し）
    expect(
      applyMemoChanges({ ...recipe, stepTimes: [10, 40] }, changes).stepTimes,
    ).toEqual([10, null, 40]);
    // 選ばなければ何も変わらない
    expect(applyMemoChanges(recipe, [])).toEqual(recipe);
  });
});
