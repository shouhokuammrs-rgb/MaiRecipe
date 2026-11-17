import { describe, expect, it } from "vitest";
import { api, signUp } from "./helpers";

// 冷蔵庫の仕分け（DEC-033）。置き場所を手で直すと、食材の名前ごとに家で覚える
type Item = { id: string; name: string; zone: string; zoneSet: boolean };
const list = async (c: string) =>
  ((await (await api(c, "/pantry")).json()) as { items: Item[] }).items;
const add = (c: string, names: string[]) =>
  api(c, "/pantry", { method: "POST", body: { names } });
const byName = (items: Item[], n: string) => items.find((i) => i.name === n)!;

describe("冷蔵庫の置き場所", () => {
  it("名前から室が決まる（おまかせ）", async () => {
    const me = await signUp();
    await add(me, ["卵", "鶏もも肉", "キャベツ", "冷凍うどん", "じゃがいも"]);
    const items = await list(me);
    expect(byName(items, "卵")).toMatchObject({
      zone: "冷蔵室",
      zoneSet: false,
    });
    expect(byName(items, "鶏もも肉").zone).toBe("チルド");
    expect(byName(items, "キャベツ").zone).toBe("野菜室");
    expect(byName(items, "冷凍うどん").zone).toBe("冷凍室");
    expect(byName(items, "じゃがいも").zone).toBe("常温");
  });

  it("手で直すと、使い切ってまた入れても同じ室に出る。null でおまかせに戻る", async () => {
    const me = await signUp();
    await add(me, ["卵"]);
    const egg = byName(await list(me), "卵");
    const r = await api(me, `/pantry/${egg.id}`, {
      method: "PATCH",
      body: { zone: "ドアポケット" },
    });
    expect(r.status).toBe(204);
    expect(byName(await list(me), "卵")).toMatchObject({
      zone: "ドアポケット",
      zoneSet: true,
    });

    await api(me, `/pantry/${egg.id}`, { method: "DELETE" });
    await add(me, ["たまご"]);
    const again = byName(await list(me), "卵");
    expect(again).toMatchObject({ zone: "ドアポケット", zoneSet: true });

    await api(me, `/pantry/${again.id}`, {
      method: "PATCH",
      body: { zone: null },
    });
    expect(byName(await list(me), "卵")).toMatchObject({
      zone: "冷蔵室",
      zoneSet: false,
    });
  });

  it("置き場所だけ直しても、量と期限は変わらない", async () => {
    const me = await signUp();
    await add(me, ["豚こま"]);
    const pork = byName(await list(me), "豚こま");
    await api(me, `/pantry/${pork.id}`, {
      method: "PATCH",
      body: { amount: "300g", expiresOn: "2026-12-01" },
    });
    await api(me, `/pantry/${pork.id}`, {
      method: "PATCH",
      body: { zone: "冷凍室" },
    });
    const after = (await (await api(me, "/pantry")).json()) as {
      items: (Item & { amount: string; expiresOn: string })[];
    };
    expect(after.items[0]).toMatchObject({
      amount: "300g",
      expiresOn: "2026-12-01",
      zone: "冷凍室",
    });
  });

  it("グループをまたいだ漏れがないこと：ほかの家の置き場所は変わらない。ほかの家の食材は直せない", async () => {
    const a = await signUp();
    const b = await signUp();
    await add(a, ["卵"]);
    await add(b, ["卵"]);
    const aEgg = byName(await list(a), "卵");
    await api(a, `/pantry/${aEgg.id}`, {
      method: "PATCH",
      body: { zone: "冷凍室" },
    });
    expect(byName(await list(b), "卵").zone).toBe("冷蔵室");

    const steal = await api(b, `/pantry/${aEgg.id}`, {
      method: "PATCH",
      body: { zone: "常温" },
    });
    expect(steal.status).toBe(404);
    expect(byName(await list(a), "卵").zone).toBe("冷凍室");
  });

  it("知らない室は弾く", async () => {
    const me = await signUp();
    await add(me, ["卵"]);
    const egg = byName(await list(me), "卵");
    const r = await api(me, `/pantry/${egg.id}`, {
      method: "PATCH",
      body: { zone: "物置" },
    });
    expect(r.status).toBe(400);
  });
});
