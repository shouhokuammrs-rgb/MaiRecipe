import { describe, expect, it } from "vitest";
import {
  firstEmptyDinner,
  pickSet,
  rankRecommendations,
  scoreRecipe,
  slotOf,
  type RecoRecipe,
} from "../../src/shared/recommend";

const T = "2026-09-30";
const r = (
  id: string,
  category: string,
  names: string[],
  updatedAt = 0,
): RecoRecipe => ({
  id,
  title: id,
  category,
  updatedAt,
  ingredients: names.map((name) => ({ name, amount: "" })),
});

describe("分類", () => {
  it("主菜と丼は main、副菜は side、汁物は soup、ほかは出さない", () => {
    expect(slotOf("主菜")).toBe("main");
    expect(slotOf("丼")).toBe("main");
    expect(slotOf("副菜")).toBe("side");
    expect(slotOf("汁物")).toBe("soup");
    expect(slotOf("デザート")).toBeNull();
    expect(slotOf("その他")).toBeNull();
  });
});

describe("点数", () => {
  it("調味料を除いた材料のうち、冷蔵庫にある割合 × 100。名寄せと「材料から探す」と同じ当て方", () => {
    const s = scoreRecipe(
      r("a", "主菜", ["鶏むね肉", "たまねぎ", "ピーマン", "醤油", "砂糖"]),
      [
        { name: "玉ねぎ", expiresOn: null },
        { name: "鶏肉", expiresOn: null },
      ],
      [],
      T,
    );
    expect(s.score).toBeCloseTo((2 / 3) * 100);
    expect(s.have).toEqual(["鶏むね肉", "たまねぎ"]);
    expect(s.soon).toEqual([]);
  });

  it("主な材料が0なら0点", () => {
    expect(scoreRecipe(r("a", "汁物", ["味噌"]), [], [], T).score).toBe(0);
  });

  it("期限が3日以内（過ぎたものも）の食材を使うと、1つにつき +15", () => {
    const s = scoreRecipe(
      r("a", "主菜", ["鮭", "しめじ", "玉ねぎ"]),
      [
        { name: "鮭", expiresOn: "2026-10-03" },
        { name: "しめじ", expiresOn: "2026-09-28" },
        { name: "玉ねぎ", expiresOn: "2026-10-10" },
      ],
      [],
      T,
    );
    expect(s.score).toBeCloseTo(100 + 30);
    expect(s.soon).toEqual(["鮭", "しめじ"]);
  });

  it("過去7日の献立に入っていたら −25、今日から6日後までに入っていたら −60（両方なら両方）", () => {
    const rec = r("a", "主菜", ["鮭"]);
    const pantry = [{ name: "鮭", expiresOn: null }];
    expect(
      scoreRecipe(rec, pantry, [{ recipeId: "a", date: "2026-09-23" }], T)
        .score,
    ).toBe(75);
    expect(
      scoreRecipe(rec, pantry, [{ recipeId: "a", date: "2026-09-22" }], T)
        .score,
    ).toBe(100);
    expect(
      scoreRecipe(rec, pantry, [{ recipeId: "a", date: "2026-10-06" }], T)
        .score,
    ).toBe(40);
    expect(
      scoreRecipe(rec, pantry, [{ recipeId: "a", date: "2026-10-07" }], T)
        .score,
    ).toBe(100);
    expect(
      scoreRecipe(
        rec,
        pantry,
        [
          { recipeId: "a", date: "2026-09-29" },
          { recipeId: "a", date: T },
        ],
        T,
      ).score,
    ).toBe(15);
  });
});

describe("分類ごとの並び", () => {
  it("点数 → 更新が新しい順 → 名前。デザートは出さず、各10件まで", () => {
    const recipes = [
      r("古い主菜", "主菜", ["鮭"], 1),
      r("新しい主菜", "主菜", ["鮭"], 2),
      r("丼", "丼", ["玉ねぎ"], 3),
      r("副菜", "副菜", ["ほうれん草"], 0),
      r("プリン", "デザート", ["卵"], 9),
      ...Array.from({ length: 12 }, (_, i) =>
        r(`汁物${String(i).padStart(2, "0")}`, "汁物", ["豆腐"], 0),
      ),
    ];
    const lists = rankRecommendations(
      recipes,
      [{ name: "鮭", expiresOn: null }],
      [],
      T,
    );
    expect(lists.main.map((x) => x.id)).toEqual([
      "新しい主菜",
      "古い主菜",
      "丼",
    ]);
    expect(lists.side.map((x) => x.id)).toEqual(["副菜"]);
    expect(lists.soup).toHaveLength(10);
    expect(lists.soup[0]!.id).toBe("汁物00");
    expect(lists.main[0]).toEqual({
      id: "新しい主菜",
      title: "新しい主菜",
      category: "主菜",
      have: ["鮭"],
      soon: [],
    });
  });
});

describe("セットの組み方", () => {
  const reco = (id: string) => ({
    id,
    title: id,
    category: "",
    have: [],
    soon: [],
  });
  const lists = {
    main: [reco("m0"), reco("m1"), reco("m2")],
    side: [reco("s0")],
    soup: [],
  };
  it("組み合わせ番号と ⇄ の回数の和を、候補の数で割った余り番目。レシピの無い分類は出さない", () => {
    expect(
      pickSet(lists, 0, { main: 0, side: 0, soup: 0 }).map((x) => [
        x.slot,
        x.reco.id,
      ]),
    ).toEqual([
      ["main", "m0"],
      ["side", "s0"],
    ]);
    expect(
      pickSet(lists, 1, { main: 1, side: 5, soup: 2 }).map((x) => x.reco.id),
    ).toEqual(["m2", "s0"]);
    expect(
      pickSet(lists, 2, { main: 2, side: 0, soup: 0 }).map((x) => x.reco.id),
    ).toEqual(["m1", "s0"]);
  });
});

describe("最初に空いている夜", () => {
  it("今日から14日以内で夜が空いている最初の日。無ければ今日", () => {
    expect(firstEmptyDinner([], T)).toBe(T);
    expect(
      firstEmptyDinner(
        [
          { date: T, meal: "dinner" },
          { date: "2026-10-01", meal: "lunch" },
        ],
        T,
      ),
    ).toBe("2026-10-01");
    const full = Array.from({ length: 14 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 8, 30 + i)).toISOString().slice(0, 10),
      meal: "dinner",
    }));
    expect(firstEmptyDinner(full, T)).toBe(T);
  });
});
