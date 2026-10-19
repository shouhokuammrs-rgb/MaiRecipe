import { describe, expect, it } from "vitest";
import { todayJst } from "../../src/shared/dates";
import { api, sampleRecipe, signUp } from "./helpers";

type Reco = {
  id: string;
  title: string;
  category: string;
  have: string[];
  soon: string[];
};
type Lists = { main: Reco[]; side: Reco[]; soup: Reco[]; today: string };

async function create(
  cookie: string,
  title: string,
  category: string,
  names: string[],
) {
  const res = await api(cookie, "/recipes", {
    method: "POST",
    body: {
      ...sampleRecipe,
      title,
      category,
      ingredients: names.map((name) => ({ name, amount: "1個" })),
    },
  });
  return ((await res.json()) as { id: string }).id;
}
const reco = async (c: string) =>
  (await (await api(c, "/recommend")).json()) as Lists;

describe("おすすめ", () => {
  it("冷蔵庫の食材を多く使う順。分類ごとに分かれ、デザートは出ない", async () => {
    const me = await signUp();
    const a = await create(me, "鮭のホイル焼き", "主菜", [
      "鮭",
      "しめじ",
      "醤油",
    ]);
    const b = await create(me, "親子丼", "丼", ["鶏もも肉", "卵"]);
    const c = await create(me, "豚汁", "汁物", ["豚こま肉", "大根"]);
    await create(me, "プリン", "デザート", ["卵"]);
    await api(me, "/pantry", {
      method: "POST",
      body: { names: ["鮭", "しめじ", "卵"] },
    });
    const r = await reco(me);
    expect(r.today).toBe(todayJst());
    expect(r.main.map((x) => x.id)).toEqual([a, b]);
    expect(r.main[0]).toMatchObject({
      category: "主菜",
      have: ["鮭", "しめじ"],
    });
    expect(r.side).toEqual([]);
    expect(r.soup.map((x) => x.id)).toEqual([c]);
  });

  it("今週の献立にもう入っているレシピは下がる", async () => {
    const me = await signUp();
    const a = await create(me, "A", "主菜", ["鮭"]);
    const b = await create(me, "B", "主菜", ["鮭"]);
    await api(me, "/pantry", { method: "POST", body: { names: ["鮭"] } });
    await api(me, "/plans", {
      method: "PUT",
      body: { date: todayJst(), meal: "dinner", recipeId: b },
    });
    expect((await reco(me)).main.map((x) => x.id)).toEqual([a, b]);
  });

  it("グループをまたいだ漏れがない：他人のレシピは出ず、他人の冷蔵庫は効かない", async () => {
    const alice = await signUp();
    const bob = await signUp();
    await create(alice, "Aの主菜", "主菜", ["鮭"]);
    const mine = await create(bob, "Bの主菜", "主菜", ["鮭"]);
    await api(alice, "/pantry", { method: "POST", body: { names: ["鮭"] } });
    const r = await reco(bob);
    expect(r.main.map((x) => x.id)).toEqual([mine]);
    expect(r.main[0]!.have).toEqual([]);
  });

  it("ログインしていなければ 401", async () => {
    expect((await api(null, "/recommend")).status).toBe(401);
  });
});
