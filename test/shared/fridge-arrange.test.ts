import { describe, expect, it } from "vitest";
import {
  FRIDGE_SORTS,
  FRIDGE_ZONES,
  fridgeSettingsSchema,
  groupByZone,
  moveIdsSchema,
  planZoneMove,
  resolveFridgeOrder,
  sortPantryBy,
} from "../../src/shared/pantry";

// 冷蔵庫のまとめて移動・並べ替え（DEC-034）
const item = (
  name: string,
  o: {
    expiresOn?: string | null;
    addedOn?: string;
    position?: number | null;
  } = {},
) => ({
  name,
  expiresOn: o.expiresOn ?? null,
  addedOn: o.addedOn ?? "2026-11-10",
  position: o.position ?? null,
});

describe("移動で何が変わるか", () => {
  it("冷凍室へはその品だけ（次に同じ名前が入っても、いつもの室）", () => {
    expect(planZoneMove({ auto: "チルド", pref: null }, "冷凍室")).toEqual({
      itemZone: "冷凍室",
      pref: "keep",
    });
  });
  it("冷凍室から出すと、その品だけの印を消し、行き先を覚える（いつもの室なら覚えない）", () => {
    expect(planZoneMove({ auto: "チルド", pref: null }, "チルド")).toEqual({
      itemZone: null,
      pref: null,
    });
    expect(planZoneMove({ auto: "チルド", pref: null }, "冷蔵室")).toEqual({
      itemZone: null,
      pref: "冷蔵室",
    });
  });
  it("ほかの室へは名前ごとに覚える。いつもの室に戻すと覚えた分を消す", () => {
    expect(
      planZoneMove({ auto: "冷蔵室", pref: null }, "ドアポケット"),
    ).toEqual({
      itemZone: null,
      pref: "ドアポケット",
    });
    expect(
      planZoneMove({ auto: "冷蔵室", pref: "ドアポケット" }, "冷蔵室"),
    ).toEqual({
      itemZone: null,
      pref: null,
    });
  });
  it("いつも冷凍室に入れると覚えている品は、冷凍室へ移しても覚えたまま", () => {
    expect(planZoneMove({ auto: "常温", pref: "冷凍室" }, "冷凍室")).toEqual({
      itemZone: null,
      pref: "冷凍室",
    });
    expect(planZoneMove({ auto: "冷凍室", pref: null }, "冷凍室")).toEqual({
      itemZone: null,
      pref: null,
    });
  });
  it("おまかせ（null）は両方消す", () => {
    expect(planZoneMove({ auto: "冷蔵室", pref: "常温" }, null)).toEqual({
      itemZone: null,
      pref: null,
    });
  });
});

describe("室の中の並び", () => {
  const items = [
    item("にんじん", { expiresOn: null, addedOn: "2026-11-12", position: 0 }),
    item("キャベツ", {
      expiresOn: "2026-11-20",
      addedOn: "2026-11-01",
      position: 2,
    }),
    item("あさつき", {
      expiresOn: "2026-11-18",
      addedOn: "2026-11-05",
      position: null,
    }),
    item("大根", { expiresOn: null, addedOn: "2026-11-15", position: 1 }),
  ];
  const names = (xs: { name: string }[]) => xs.map((x) => x.name);

  it("期限が近い順（期限なしは後ろで、新しく入れた順）", () => {
    expect(names(sortPantryBy(items, "expires"))).toEqual([
      "あさつき",
      "キャベツ",
      "大根",
      "にんじん",
    ]);
  });
  it("入れた順（新しいものが上）", () => {
    expect(names(sortPantryBy(items, "added"))).toEqual([
      "大根",
      "にんじん",
      "あさつき",
      "キャベツ",
    ]);
  });
  it("名前順", () => {
    expect(names(sortPantryBy(items, "name"))).toEqual([
      "あさつき",
      "キャベツ",
      "にんじん",
      "大根",
    ]);
  });
  it("手で並べた順（まだ並べていないものは後ろで、期限が近い順）", () => {
    expect(names(sortPantryBy(items, "manual"))).toEqual([
      "にんじん",
      "大根",
      "キャベツ",
      "あさつき",
    ]);
  });
  it("並べ方は4つ", () => {
    expect([...FRIDGE_SORTS]).toEqual(["expires", "added", "name", "manual"]);
  });
});

describe("室の順番", () => {
  it("保存が無ければ上から冷蔵室。常温はいつも最後", () => {
    expect(resolveFridgeOrder(null)).toEqual([...FRIDGE_ZONES]);
    const mine = resolveFridgeOrder([
      "冷蔵室",
      "冷凍室",
      "野菜室",
      "チルド",
      "ドアポケット",
    ]);
    expect(mine).toEqual([
      "冷蔵室",
      "冷凍室",
      "野菜室",
      "チルド",
      "ドアポケット",
      "常温",
    ]);
    expect(resolveFridgeOrder(["常温", "冷凍室"]).at(-1)).toBe("常温");
  });
  it("室ごとに分けるときは、その順番で返す", () => {
    const order = resolveFridgeOrder([
      "冷凍室",
      "冷蔵室",
      "チルド",
      "ドアポケット",
      "野菜室",
    ]);
    expect(groupByZone([], order).map((g) => g.zone)).toEqual(order);
  });
});

describe("入力の検証", () => {
  it("並べ方と室の順番", () => {
    expect(fridgeSettingsSchema.safeParse({ sort: "name" }).success).toBe(true);
    expect(fridgeSettingsSchema.safeParse({ sort: "random" }).success).toBe(
      false,
    );
    expect(
      fridgeSettingsSchema.safeParse({
        zones: ["冷凍室", "冷蔵室", "チルド", "ドアポケット", "野菜室"],
      }).success,
    ).toBe(true);
    expect(fridgeSettingsSchema.safeParse({ zones: ["冷凍室"] }).success).toBe(
      false,
    );
    expect(fridgeSettingsSchema.safeParse({ zones: null }).success).toBe(true);
    expect(fridgeSettingsSchema.safeParse({}).success).toBe(false);
  });
  it("まとめて移動は1〜100個", () => {
    expect(
      moveIdsSchema.safeParse({ ids: ["a"], zone: "冷凍室" }).success,
    ).toBe(true);
    expect(moveIdsSchema.safeParse({ ids: [], zone: "冷凍室" }).success).toBe(
      false,
    );
    expect(
      moveIdsSchema.safeParse({ ids: Array(101).fill("a"), zone: null })
        .success,
    ).toBe(false);
  });
});
