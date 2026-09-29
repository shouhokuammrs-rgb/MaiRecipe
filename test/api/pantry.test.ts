import { describe, expect, it } from "vitest";
import { api, signUp } from "./helpers";

type Item = {
  id: string;
  name: string;
  amount: string | null;
  expiresOn: string | null;
  addedOn: string;
};
const list = async (c: string) =>
  (await (await api(c, "/pantry")).json()) as { items: Item[]; today: string };
const add = (c: string, names: string[]) =>
  api(c, "/pantry", { method: "POST", body: { names } });

describe("冷蔵庫", () => {
  it("まとめて入れる：名寄せし、調味料とすでにあるものは飛ばす", async () => {
    const me = await signUp();
    const res = await add(me, ["たまねぎ", "卵", "しょうゆ", "玉葱", " "]);
    // " " は検証で 400 になるので、空白だけの名前は画面側で落とす前提。ここでは空白なしで送り直す
    expect(res.status).toBe(400);
    const ok = await add(me, ["たまねぎ", "卵", "しょうゆ", "玉葱"]);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      added: ["玉ねぎ", "卵"],
      skipped: ["醤油", "玉ねぎ"],
    });
    const again = await add(me, ["卵"]);
    expect(await again.json()).toEqual({ added: [], skipped: ["卵"] });
    const { items, today } = await list(me);
    expect(items.map((i) => i.name).sort()).toEqual(["卵", "玉ねぎ"].sort());
    expect(items[0]!.addedOn).toBe(today);
  });

  it("30個まとめて入れられる（D1 の値の上限に当たらない）", async () => {
    const me = await signUp();
    const names = Array.from({ length: 30 }, (_, i) => `食材${i}`);
    const res = await add(me, names);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { added: string[] }).added).toHaveLength(30);
    expect((await list(me)).items).toHaveLength(30);
  });

  it("量と期限を直す・消す。並びは期限が近い順", async () => {
    const me = await signUp();
    await add(me, ["卵", "しめじ"]);
    let { items } = await list(me);
    const egg = items.find((i) => i.name === "卵")!;
    const shimeji = items.find((i) => i.name === "しめじ")!;
    expect(
      (
        await api(me, `/pantry/${shimeji.id}`, {
          method: "PATCH",
          body: { expiresOn: "2030-01-02", amount: "1袋" },
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await api(me, `/pantry/${egg.id}`, {
          method: "PATCH",
          body: { expiresOn: "2030-01-01" },
        })
      ).status,
    ).toBe(204);
    ({ items } = await list(me));
    expect(items.map((i) => i.name)).toEqual(["卵", "しめじ"]);
    expect(items[1]).toMatchObject({ amount: "1袋", expiresOn: "2030-01-02" });
    await api(me, `/pantry/${egg.id}`, {
      method: "PATCH",
      body: { expiresOn: null, amount: "" },
    });
    ({ items } = await list(me));
    expect(items.find((i) => i.name === "卵")).toMatchObject({
      amount: null,
      expiresOn: null,
    });
    expect(
      (await api(me, `/pantry/${egg.id}`, { method: "DELETE" })).status,
    ).toBe(204);
    expect((await list(me)).items.map((i) => i.name)).toEqual(["しめじ"]);
    expect(
      (await api(me, `/pantry/${egg.id}`, { method: "DELETE" })).status,
    ).toBe(404);
  });

  it("おかしな入力は 400", async () => {
    const me = await signUp();
    expect((await add(me, [])).status).toBe(400);
    await add(me, ["卵"]);
    const id = (await list(me)).items[0]!.id;
    expect(
      (await api(me, `/pantry/${id}`, { method: "PATCH", body: {} })).status,
    ).toBe(400);
    expect(
      (
        await api(me, `/pantry/${id}`, {
          method: "PATCH",
          body: { expiresOn: "明日" },
        })
      ).status,
    ).toBe(400);
  });

  it("グループをまたいだ漏れがない：他人の冷蔵庫は見えない・直せない・消せない", async () => {
    const alice = await signUp();
    const bob = await signUp();
    await add(alice, ["卵"]);
    const id = (await list(alice)).items[0]!.id;
    expect((await list(bob)).items).toEqual([]);
    expect(
      (
        await api(bob, `/pantry/${id}`, {
          method: "PATCH",
          body: { amount: "1個" },
        })
      ).status,
    ).toBe(404);
    expect((await api(bob, `/pantry/${id}`, { method: "DELETE" })).status).toBe(
      404,
    );
    // bob が同じ名前を入れても alice の行とは別
    expect(await (await add(bob, ["卵"])).json()).toEqual({
      added: ["卵"],
      skipped: [],
    });
    expect((await list(alice)).items[0]).toMatchObject({ id, amount: null });
  });

  it("ログインしていなければ 401", async () => {
    expect((await api(null, "/pantry")).status).toBe(401);
  });
});
