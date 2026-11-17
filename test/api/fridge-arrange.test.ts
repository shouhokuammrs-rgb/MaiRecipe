import { describe, expect, it } from "vitest";
import { api, signUp } from "./helpers";

// 冷蔵庫のまとめて移動・並べ替え・元に戻す（DEC-034）
type Item = {
  id: string;
  name: string;
  zone: string;
  zoneSet: boolean;
  onlyThis: boolean;
  position: number | null;
};
type Pantry = { items: Item[]; sort: string; zones: string[] };
const get = async (c: string) =>
  (await (await api(c, "/pantry")).json()) as Pantry;
const add = (c: string, names: string[]) =>
  api(c, "/pantry", { method: "POST", body: { names } });
const ids = (p: Pantry, names: string[]) =>
  names.map((n) => p.items.find((i) => i.name === n)!.id);
const zoneOf = (p: Pantry, n: string) =>
  p.items.find((i) => i.name === n)!.zone;
const move = (c: string, idList: string[], zone: string | null) =>
  api(c, "/pantry/move", { method: "POST", body: { ids: idList, zone } });

describe("まとめて移動", () => {
  it("冷凍室へまとめて移す。冷凍はその品だけで、また買ってもいつもの室", async () => {
    const me = await signUp();
    await add(me, ["豚こま", "鶏もも肉", "食パン"]);
    const p = await get(me);
    const r = await move(
      me,
      ids(p, ["豚こま", "鶏もも肉", "食パン"]),
      "冷凍室",
    );
    expect(r.status).toBe(200);
    expect(((await r.json()) as { moved: number }).moved).toBe(3);
    const after = await get(me);
    for (const n of ["豚こま", "鶏もも肉", "食パン"])
      expect(zoneOf(after, n)).toBe("冷凍室");
    expect(after.items.find((i) => i.name === "豚こま")).toMatchObject({
      onlyThis: true,
      zoneSet: true,
    });

    // 使い切ってまた買うと、いつものチルド
    await api(me, `/pantry/${ids(after, ["豚こま"])[0]}`, { method: "DELETE" });
    await add(me, ["豚こま"]);
    expect(zoneOf(await get(me), "豚こま")).toBe("チルド");
  });

  it("ほかの室への移動は名前ごとに覚える", async () => {
    const me = await signUp();
    await add(me, ["卵"]);
    await move(me, ids(await get(me), ["卵"]), "ドアポケット");
    const p = await get(me);
    await api(me, `/pantry/${ids(p, ["卵"])[0]}`, { method: "DELETE" });
    await add(me, ["卵"]);
    expect(zoneOf(await get(me), "卵")).toBe("ドアポケット");
  });

  it("元に戻すと、移す前の置き場所に戻る（覚えた置き場所も）", async () => {
    const me = await signUp();
    await add(me, ["卵", "鶏もも肉", "キャベツ"]);
    const p = await get(me);
    await move(me, ids(p, ["卵"]), "ドアポケット");
    const r = await move(me, ids(p, ["卵", "鶏もも肉", "キャベツ"]), "冷凍室");
    const { undo } = (await r.json()) as { undo: unknown };
    const back = await api(me, "/pantry/restore", {
      method: "POST",
      body: undo,
    });
    expect(back.status).toBe(204);
    const after = await get(me);
    expect(zoneOf(after, "卵")).toBe("ドアポケット");
    expect(zoneOf(after, "鶏もも肉")).toBe("チルド");
    expect(zoneOf(after, "キャベツ")).toBe("野菜室");
  });

  it("グループをまたいだ漏れがないこと：ほかの家の品は動かせず、元に戻すでも触れない", async () => {
    const a = await signUp();
    const b = await signUp();
    await add(a, ["卵"]);
    await add(b, ["牛乳"]);
    const aEgg = ids(await get(a), ["卵"]);
    const bMilk = ids(await get(b), ["牛乳"]);
    expect((await move(b, aEgg, "冷凍室")).status).toBe(404);
    expect((await move(b, [...bMilk, ...aEgg], "冷凍室")).status).toBe(404);
    expect(zoneOf(await get(b), "牛乳")).toBe("ドアポケット");

    await api(b, "/pantry/restore", {
      method: "POST",
      body: { items: [{ id: aEgg[0], zone: "冷凍室" }], prefs: [] },
    });
    expect(zoneOf(await get(a), "卵")).toBe("冷蔵室");

    // 名前ごとの置き場所は家ごと
    await api(b, "/pantry/restore", {
      method: "POST",
      body: { items: [], prefs: [{ name: "卵", zone: "常温" }] },
    });
    expect(zoneOf(await get(a), "卵")).toBe("冷蔵室");
  });
});

describe("並べ替え", () => {
  it("はじめは期限が近い順・おすすめの室の順。名前順に変えられる", async () => {
    const me = await signUp();
    await add(me, ["にんじん", "キャベツ", "大根"]);
    const p = await get(me);
    expect(p.sort).toBe("expires");
    expect(p.zones).toEqual([
      "冷蔵室",
      "チルド",
      "ドアポケット",
      "野菜室",
      "冷凍室",
      "常温",
    ]);
    const r = await api(me, "/pantry/settings", {
      method: "PUT",
      body: { sort: "name" },
    });
    expect(r.status).toBe(200);
    const after = await get(me);
    expect(after.sort).toBe("name");
    expect(after.items.map((i) => i.name)).toEqual([
      "キャベツ",
      "にんじん",
      "大根",
    ]);
  });

  it("手で並べた順は、ほかの並べ方にしても消えずに残る", async () => {
    const me = await signUp();
    await add(me, ["にんじん", "キャベツ", "大根"]);
    const p = await get(me);
    const order = ids(p, ["大根", "にんじん", "キャベツ"]);
    expect(
      (await api(me, "/pantry/order", { method: "PUT", body: { ids: order } }))
        .status,
    ).toBe(204);
    await api(me, "/pantry/settings", {
      method: "PUT",
      body: { sort: "manual" },
    });
    expect((await get(me)).items.map((i) => i.name)).toEqual([
      "大根",
      "にんじん",
      "キャベツ",
    ]);
    await api(me, "/pantry/settings", {
      method: "PUT",
      body: { sort: "name" },
    });
    await api(me, "/pantry/settings", {
      method: "PUT",
      body: { sort: "manual" },
    });
    expect((await get(me)).items.map((i) => i.name)).toEqual([
      "大根",
      "にんじん",
      "キャベツ",
    ]);
  });

  it("並べている間に消えた品は飛ばして保存できる。保存すると手で並べた順になる", async () => {
    const me = await signUp();
    await add(me, ["にんじん", "キャベツ", "大根"]);
    const p = await get(me);
    const [carrot, cabbage, radish] = ids(p, ["にんじん", "キャベツ", "大根"]);
    await api(me, `/pantry/${cabbage}`, { method: "DELETE" });
    const r = await api(me, "/pantry/order", {
      method: "PUT",
      body: { ids: [radish, cabbage, carrot] },
    });
    expect(r.status).toBe(204);
    const after = await get(me);
    expect(after.sort).toBe("manual");
    expect(after.items.map((i) => i.name)).toEqual(["大根", "にんじん"]);
  });

  it("室の順番を変える・おすすめに戻す", async () => {
    const me = await signUp();
    const mine = ["冷蔵室", "冷凍室", "野菜室", "チルド", "ドアポケット"];
    const r = await api(me, "/pantry/settings", {
      method: "PUT",
      body: { zones: mine },
    });
    expect(((await r.json()) as { zones: string[] }).zones).toEqual([
      ...mine,
      "常温",
    ]);
    await api(me, "/pantry/settings", { method: "PUT", body: { zones: null } });
    expect((await get(me)).zones[1]).toBe("チルド");
  });

  it("グループをまたいだ漏れがないこと：ほかの家の品は並べられず、並べ方も家ごと", async () => {
    const a = await signUp();
    const b = await signUp();
    await add(a, ["卵"]);
    const aEgg = ids(await get(a), ["卵"]);
    await api(a, "/pantry/settings", { method: "PUT", body: { sort: "name" } });
    expect((await get(b)).sort).toBe("expires");
    // ほかの家の品の id は飛ばされ、その家の並びは何も変わらない
    await api(b, "/pantry/order", { method: "PUT", body: { ids: aEgg } });
    const after = await get(a);
    expect(after.items[0]!.position).toBeNull();
    expect(after.sort).toBe("name");
  });

  it("おかしな入力は弾く", async () => {
    const me = await signUp();
    expect(
      (
        await api(me, "/pantry/settings", {
          method: "PUT",
          body: { sort: "x" },
        })
      ).status,
    ).toBe(400);
    expect((await move(me, [], "冷凍室")).status).toBe(400);
    expect((await move(me, ["x"], "物置")).status).toBe(400);
  });
});
