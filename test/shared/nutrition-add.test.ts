import { describe, expect, it } from "vitest";
import {
  NUTRIENTS,
  NUTRIENT_IDS,
  foodByKey,
  foodFor,
  gramsOf,
} from "../../src/shared/nutrition";
import {
  ADDABLES,
  ADD_MAX,
  ADD_MIN_GAIN,
  dishKind,
  suggestAdditions,
} from "../../src/shared/nutrition-add";

const ing = (list: [string, string][]) =>
  list.map(([name, amount]) => ({ name, amount }));
const keys = (r: ReturnType<typeof suggestAdditions>) =>
  r.items.map((x) => x.key);

describe("足しやすい食材の表", () => {
  it("どの行も成分表の食材に当たり、量をグラムに直せる", () => {
    for (const a of ADDABLES) {
      const food = foodByKey(a.key);
      expect(food, a.key).not.toBeNull();
      expect(gramsOf(a.amount, food!), `${a.key} ${a.amount}`).toBeGreaterThan(
        0,
      );
      expect(a.fits, a.key).toMatch(/^[麺飯卵汁和炒煮添]+$/);
    }
  });
  it("同じ食材が 2 回出てこない", () => {
    const all = ADDABLES.map((a) => a.key);
    expect(new Set(all).size).toBe(all.length);
  });
  it("缶詰は固形量で数える（成分表の水煮缶は、液汁を除いた値）", () => {
    expect(gramsOf("1缶", foodByKey("あさり缶")!)).toBe(65);
    expect(gramsOf("1缶", foodByKey("さば缶")!)).toBe(140);
  });
  it("どの行も、どれかの栄養をしっかり足せる（出ることのない行を表に置かない）", () => {
    const daily = NUTRIENT_IDS.map((id) => NUTRIENTS[id].daily);
    for (const a of ADDABLES) {
      const food = foodByKey(a.key)!;
      const grams = gramsOf(a.amount, food)!;
      const best = Math.max(
        ...food.per100g.map((v, i) => (v * grams) / 100 / 2 / daily[i]!),
      );
      expect(best, a.key).toBeGreaterThanOrEqual(ADD_MIN_GAIN);
    }
  });
});

describe("料理の種類（名前から 1 つ）", () => {
  it.each([
    ["豚こまとなすの中華炒め", "炒"],
    ["至高を超えた回鍋肉", "炒"],
    ["至高の卵スープ", "汁"],
    ["【小林シェフ】鶏と白菜の和風鍋", "汁"],
    ["豚とキャベツのモツ鍋風", "汁"],
    ["3つのコツでプロの味！スンドゥブ", "汁"],
    ["すき焼き", "汁"],
    ["ほうれん草のごま和え", "和"],
    ["豚しゃぶサラダ", "和"],
    ["絶品カオマンガイの作り方【炊飯器】", "飯"],
    ["至高のきのこご飯", "飯"],
    ["お茶漬け", "飯"],
    ["漬け丼", "飯"],
    ["親子丼", "飯"],
    ["焼きそば", "麺"],
    ["鍋焼きうどん", "麺"],
    ["汁なし担々麺", "麺"],
    ["カレーライス", "煮"],
    ["リュウジさん考案！無水ヨーグルトキーマカレー", "飯"],
    ["【野﨑シェフ】ぶり大根", "煮"],
    ["炊飯器で簡単柔らか豚バラ大根", "煮"],
    ["煮込みハンバーグ", "煮"],
    ["包丁まな板不要！とろっと絶品ニラたま", "卵"],
    ["卵焼き", "卵"],
    ["麻婆豆腐", "炒"],
  ])("%s → %s", (title, kind) => {
    expect(dishKind(title)).toBe(kind);
  });

  it.each([
    "鶏の唐揚げ",
    "ハンバーグ",
    "ネギ塩チキン",
    "究極の鮭ホイル",
    "鶏胸チャーシュー",
    "ピーマンの肉詰め",
    "土鍋プリン",
    "煮卵",
    "サラダチキン",
    "そば粉のガレット",
    "豚の味噌漬け",
  ])("%s は種類を決めない", (title) => {
    expect(dishKind(title)).toBeNull();
  });
});

describe("このレシピに足すなら", () => {
  const stirFry = {
    title: "豚こまとなすの中華炒め",
    servings: 2,
    ingredients: ing([
      ["豚こま切れ肉", "200g"],
      ["なす", "3本"],
      ["長ねぎ", "1/2本"],
      ["醤油", "大さじ1"],
    ]),
  };

  it("選んだ栄養が増える順に、料理に混ぜやすい食材を出す（鉄なら小松菜・厚揚げなど）", () => {
    const r = suggestAdditions(stirFry, "iron");
    expect(r.mode).toBe("mix");
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items.length).toBeLessThanOrEqual(ADD_MAX);
    expect(r.items[0]!.key).toBe("小松菜");
    expect(keys(r)).toContain("厚揚げ");
    for (let k = 1; k < r.items.length; k++)
      expect(r.items[k - 1]!.gain).toBeGreaterThanOrEqual(r.items[k]!.gain);
  });

  it("足す前と足した後の段階が分かる", () => {
    const top = suggestAdditions(stirFry, "iron").items[0]!;
    expect(top.amount).toBe("1/2束");
    expect(top.before).not.toBe("high");
    expect(top.after).toBe("high");
  });

  it("もう「多い」栄養には、食材を出さずにそう伝える", () => {
    const r = suggestAdditions(stirFry, "vitaminB1");
    expect(r.alreadyHigh).toBe(true);
    expect(r.items).toEqual([]);
  });

  it("すでに入っている食材と、その仲間は出さない", () => {
    const withK = (name: string, amount = "1束") => ({
      ...stirFry,
      ingredients: [...stirFry.ingredients, { name, amount }],
    });
    for (const name of ["小松菜", "こまつな", "コマツナ"])
      expect(keys(suggestAdditions(withK(name), "calcium"))).not.toContain(
        "小松菜",
      );
    expect(foodFor("コマツナ")?.key).toBe("小松菜");
    // 絹豆腐があるのに「豆腐」を勧めない
    expect(
      keys(suggestAdditions(withK("絹ごし豆腐", "1丁"), "calcium")),
    ).not.toContain("木綿豆腐");
    const soup = (name: string, amount: string) => ({
      title: "具だくさんスープ",
      servings: 2,
      ingredients: ing([
        ["白菜", "1/8個"],
        [name, amount],
      ]),
    });
    expect(keys(suggestAdditions(soup("白菜", "1枚"), "iron"))).toContain(
      "あさり缶",
    );
    for (const [name, amount] of [
      ["あさり", "200g"],
      ["あさり水煮缶", "1缶"],
    ] as const)
      expect(keys(suggestAdditions(soup(name, amount), "iron"))).not.toContain(
        "あさり缶",
      );
    expect(
      keys(suggestAdditions(soup("さば", "1切れ"), "calcium")),
    ).not.toContain("さば缶");
    expect(
      keys(suggestAdditions(soup("しいたけ", "2枚"), "vitaminD")),
    ).not.toContain("干ししいたけ");
  });

  it("料理の種類に合わない食材は出さない（炒め物に納豆・缶詰は出さない）", () => {
    const fry = keys(suggestAdditions(stirFry, "iron"));
    expect(fry).not.toContain("納豆");
    expect(fry).not.toContain("あさり缶");
    expect(fry).not.toContain("さば缶");
    // 丼には納豆は出すが、あさり缶・さば缶は出さない
    const don = keys(suggestAdditions({ ...stirFry, title: "豚丼" }, "iron"));
    expect(don).toContain("納豆");
    expect(don).not.toContain("あさり缶");
  });

  it("缶詰は 1 つまで", () => {
    const pasta = {
      title: "きのこのパスタ",
      servings: 2,
      ingredients: ing([
        ["パスタ", "200g"],
        ["エリンギ", "1本"],
      ]),
    };
    for (const id of ["protein", "vitaminD", "iron"] as const) {
      const cans = keys(suggestAdditions(pasta, id)).filter((k) =>
        k.endsWith("缶"),
      );
      expect(cans.length, id).toBeLessThanOrEqual(1);
    }
  });

  it("種類が分からない料理・焼き物には、添えられる物だけを出す", () => {
    const r = suggestAdditions(
      {
        title: "鶏の唐揚げ",
        servings: 2,
        ingredients: ing([["鶏もも肉", "1枚"]]),
      },
      "vitaminC",
    );
    expect(r.mode).toBe("side");
    expect(keys(r)).toContain("ブロッコリー");
    for (const k of ["納豆", "さば缶", "あさり缶", "高野豆腐", "卵", "ごま"])
      expect(keys(r)).not.toContain(k);
    const iron = suggestAdditions(
      {
        title: "鶏の唐揚げ",
        servings: 2,
        ingredients: ing([["鶏もも肉", "1枚"]]),
      },
      "iron",
    );
    expect(keys(iron)).toContain("小松菜");
    for (const k of ["納豆", "さば缶", "あさり缶", "木綿豆腐", "厚揚げ"])
      expect(keys(iron)).not.toContain(k);
  });

  it("お菓子・たれ・材料の無いレシピには出さない", () => {
    expect(
      suggestAdditions(
        {
          title: "なめらかプリン",
          servings: 4,
          ingredients: ing([
            ["卵", "2個"],
            ["牛乳", "300ml"],
          ]),
        },
        "iron",
      ),
    ).toMatchObject({ mode: "none", items: [] });
    expect(
      suggestAdditions(
        { title: "野菜炒め", servings: 2, ingredients: [] },
        "iron",
      ).mode,
    ).toBe("none");
  });

  it("増え方が小さい食材は出さない（鉄にミニトマトは出さない）", () => {
    const salad = { ...stirFry, title: "豚しゃぶサラダ" };
    expect(keys(suggestAdditions(salad, "iron"))).not.toContain("ミニトマト");
  });

  it("今の目安が出せないレシピでは、足す分だけで「ふつう」に届く物だけ出す（before は null）", () => {
    const r = suggestAdditions(
      {
        title: "なぞの炒め物",
        servings: 2,
        ingredients: ing([["謎の食材", "100g"]]),
      },
      "iron",
    );
    expect(r.items[0]!.before).toBeNull();
    expect(r.items[0]!.key).toBe("小松菜");
    for (const x of r.items) expect(x.after).not.toBe("low");
  });

  it("量は見ている人数に合わせる。1人前の増え方は人数によらない", () => {
    const two = suggestAdditions(stirFry, "iron").items[0]!;
    const four = suggestAdditions({ ...stirFry, servings: 4 }, "calcium")
      .items[0]!;
    const twoCa = suggestAdditions(stirFry, "calcium").items[0]!;
    expect(four.key).toBe(twoCa.key);
    expect(four.gain).toBeCloseTo(twoCa.gain, 5);
    expect(two.amount).toBe("1/2束");
    expect(suggestAdditions(stirFry, "iron", 1).items[0]!.amount).toBe("1/4束");
    // レシピは 2人分のまま、画面で 4人分を見ているとき
    expect(suggestAdditions(stirFry, "iron", 4).items[0]!.amount).toBe("1束");
  });

  it("人数が書かれていないレシピは 2人分として量を出し、その印を付ける", () => {
    const r = suggestAdditions({ ...stirFry, servings: null }, "iron");
    expect(r.servingsAssumed).toBe(true);
    expect(r.items[0]!.amount).toBe("1/2束");
  });
});
