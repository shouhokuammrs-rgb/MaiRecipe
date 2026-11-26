import { describe, expect, it } from "vitest";
import { api, sampleRecipe, signUp } from "./helpers";

// 元のレシピに人数が書かれていないときだけ、人が人数を入れる（DEC-039）
const base = {
  ...sampleRecipe,
  sourceUrl: null,
  videoUrl: null,
  origin: "own",
};
const create = async (cookie: string, body: Record<string, unknown> = base) =>
  (
    (await (
      await api(cookie, "/recipes", { method: "POST", body })
    ).json()) as {
      id: string;
    }
  ).id;
const put = (cookie: string, id: string, servings: unknown) =>
  api(cookie, `/recipes/${id}/servings`, { method: "PUT", body: { servings } });
const versions = async (cookie: string, id: string) =>
  (
    (await (await api(cookie, `/recipes/${id}`)).json()) as {
      recipe: { versions: { servings: number | null }[] };
    }
  ).recipe.versions.map((v) => v.servings);

describe("PUT /api/recipes/:id/servings（人数を手で入れる）", () => {
  it("人数の無い版に人数が入り、栄養で探すにも反映される", async () => {
    const me = await signUp();
    const id = await create(me);
    expect(await versions(me, id)).toEqual([null]);
    const res = await put(me, id, 4);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ servings: 4 });
    expect(await versions(me, id)).toEqual([4]);
    const list = (await (await api(me, "/recipes/nutrition")).json()) as {
      recipes: { id: string; servings: number | null }[];
    };
    expect(list.recipes.find((r) => r.id === id)?.servings).toBe(4);
  });

  it("出典を探して「書いていなかった」（0）になったレシピにも入れられる", async () => {
    const me = await signUp();
    const id = await create(me);
    // 出典の無いレシピは、探しても見つからないので 0 が入る
    const found = await api(me, `/recipes/${id}/servings`, { method: "POST" });
    expect(await found.json()).toEqual({ servings: 0, read: true });
    expect(await versions(me, id)).toEqual([0]);
    // もう一度探す（読み方を広げたあとの探し直し）でも、出典が無ければ 0 のまま
    const again = await api(me, `/recipes/${id}/servings?again=1`, {
      method: "POST",
    });
    expect(await again.json()).toEqual({ servings: 0, read: true });
    // 続けて頼まれた探し直しは読まない（read: false。相手のサイトを何度も読まない）
    const soon = await api(me, `/recipes/${id}/servings?again=1`, {
      method: "POST",
    });
    expect(await soon.json()).toEqual({ servings: 0, read: false });
    expect((await put(me, id, 3)).status).toBe(200);
    expect(await versions(me, id)).toEqual([3]);
  });

  it("元のレシピの人数・人が決めた人数は上書きしない", async () => {
    const me = await signUp();
    const id = await create(me, { ...base, servings: 2 });
    const res = await put(me, id, 6);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ servings: 2 });
    expect(await versions(me, id)).toEqual([2]);
    // 探し直しも、人数がある版には触らない
    const again = await api(me, `/recipes/${id}/servings?again=1`, {
      method: "POST",
    });
    expect(await again.json()).toEqual({ servings: 2, read: true });
  });

  it("どれかの版に人数があるレシピには書かない（版ごとに違う人数を並べない）", async () => {
    const me = await signUp();
    const id = await create(me);
    const v2 = await api(me, `/recipes/${id}/versions`, {
      method: "POST",
      body: { ...base, servings: 2, note: "" },
    });
    expect(v2.status).toBeLessThan(300);
    expect(await versions(me, id)).toEqual([null, 2]);
    expect(await (await put(me, id, 6)).json()).toEqual({ servings: 2 });
    expect(await versions(me, id)).toEqual([null, 2]);
  });

  it.each([0, 21, 2.5, "x", null])("人数 %j は 400", async (bad) => {
    const me = await signUp();
    const id = await create(me);
    expect((await put(me, id, bad)).status).toBe(400);
    expect(await versions(me, id)).toEqual([null]);
  });

  it("ログインしていなければ 401", async () => {
    expect((await put("", "nope", 2)).status).toBe(401);
  });

  it("グループをまたいだ漏れがない：他人のレシピの人数は変えられない・探せない", async () => {
    const owner = await signUp();
    const id = await create(owner);
    const other = await signUp();
    expect((await put(other, id, 4)).status).toBe(404);
    expect(
      (await api(other, `/recipes/${id}/servings?again=1`, { method: "POST" }))
        .status,
    ).toBe(404);
    expect(await versions(owner, id)).toEqual([null]);
  });
});
