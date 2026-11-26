import { describe, expect, it } from "vitest";
import { foodByKey, gramsOf } from "../../src/shared/nutrition";
import {
  ADDABLES,
  ADD_MAX,
  dishKinds,
  suggestAdditions,
} from "../../src/shared/nutrition-add";

describe("足しやすい食材の表", () => {
  it("どの行も成分表の食材に当たり、量をグラムに直せる", () => {
    for (const a of ADDABLES) {
      const food = foodByKey(a.key);
      expect(food, a.key).not.toBeNull();
      expect(gramsOf(a.amount, food!), `${a.key} ${a.amount}`).toBeGreaterThan(
        0,
      );
      expect(a.fits, a.key).toMatch(/^[炒煮汁和飯麺卵焼]+$/);
    }
  });
  it("同じ食材が 2 回出てこない", () => {
    const keys = ADDABLES.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("料理の種類", () => {
  it.each([
    ["豚こまとなすの中華炒め", [], ["炒"]],
    ["至高の卵スープ", [], ["汁"]],
    ["鶏と白菜の和風鍋", [], ["汁"]],
    ["ほうれん草のごま和え", [], ["和"]],
    ["絶品カオマンガイの作り方【炊飯器】", [], ["飯"]],
    ["ぶり大根", ["大根を下ゆでし、ぶりと一緒に煮る"], ["煮"]],
    ["ネギ塩チキン", ["フライパンで皮目から焼き、ねぎだれをかける"], ["焼"]],
    ["なぞの一品", ["よく混ぜる"], []],
  ])("%s → %j", (title, steps, kinds) => {
    expect(dishKinds(title as string, steps as string[])).toEqual(kinds);
  });
});

describe("このレシピに足すなら", () => {
  const stirFry = {
    title: "豚こまとなすの中華炒め",
    steps: ["豚肉となすを炒める"],
    servings: 2,
    ingredients: [
      { name: "豚こま切れ肉", amount: "200g" },
      { name: "なす", amount: "3本" },
      { name: "ピーマン", amount: "2個" },
      { name: "醤油", amount: "大さじ1" },
    ],
  };

  it("選んだ栄養が増える順に、合う食材を出す（鉄なら小松菜・厚揚げなど）", () => {
    const r = suggestAdditions(stirFry, "iron");
    expect(r.length).toBeGreaterThan(0);
    expect(r.length).toBeLessThanOrEqual(ADD_MAX);
    expect(r[0]!.key).toBe("小松菜");
    expect(r.map((x) => x.key)).toContain("厚揚げ");
    for (let k = 1; k < r.length; k++)
      expect(r[k - 1]!.gain).toBeGreaterThanOrEqual(r[k]!.gain);
  });

  it("足す前と足した後の段階が分かる", () => {
    const top = suggestAdditions(stirFry, "iron")[0]!;
    expect(top.amount).toBe("1/2束");
    // 豚こま 200g + なす + ピーマン の鉄は 1人前 1.1mg 前後（少なめ〜ふつう）→ 小松菜 125g で +1.75mg
    expect(top.before).not.toBe("high");
    expect(top.after).toBe("high");
  });

  it("すでに入っている食材は出さない", () => {
    expect(
      suggestAdditions(stirFry, "vitaminC").map((x) => x.key),
    ).not.toContain("ピーマン");
    const withKomatsuna = {
      ...stirFry,
      ingredients: [
        ...stirFry.ingredients,
        { name: "こまつな", amount: "1束" },
      ],
    };
    expect(
      suggestAdditions(withKomatsuna, "iron").map((x) => x.key),
    ).not.toContain("小松菜");
  });

  it("料理の種類に合わない食材は出さない（炒め物に納豆・焼きのりは出さない）", () => {
    const keys = suggestAdditions(stirFry, "iron").map((x) => x.key);
    expect(keys).not.toContain("納豆");
    expect(keys).not.toContain("あさり缶");
    const soup = { ...stirFry, title: "豚こまとなすのスープ", steps: [] };
    expect(suggestAdditions(soup, "iron").map((x) => x.key)).toContain(
      "あさり缶",
    );
  });

  it("料理の種類が分からないときは、絞らずに出す", () => {
    const r = suggestAdditions(
      { ...stirFry, title: "なぞの一品", steps: ["よく混ぜる"] },
      "iron",
    );
    expect(r.length).toBe(ADD_MAX);
  });

  it("増え方が小さい食材は出さない（鉄にミニトマトは出さない）", () => {
    const salad = { ...stirFry, title: "豚しゃぶサラダ", steps: [] };
    expect(suggestAdditions(salad, "iron").map((x) => x.key)).not.toContain(
      "ミニトマト",
    );
  });

  it("今の目安が出せないレシピでも、足す分だけの段階で出す（before は null）", () => {
    const r = suggestAdditions(
      {
        title: "なぞの炒め物",
        steps: [],
        servings: 2,
        ingredients: [{ name: "謎の食材", amount: "100g" }],
      },
      "iron",
    );
    expect(r[0]!.before).toBeNull();
    expect(r[0]!.key).toBe("小松菜");
  });

  it("人数が多いほど、同じ量を足しても 1人前の増え方は小さい", () => {
    const two = suggestAdditions(stirFry, "iron")[0]!.gain;
    const four = suggestAdditions({ ...stirFry, servings: 4 }, "iron")[0]!.gain;
    expect(four).toBeCloseTo(two / 2, 5);
  });
});
