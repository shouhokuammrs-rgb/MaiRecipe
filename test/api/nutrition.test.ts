import { describe, expect, it } from "vitest";
import { rankByNutrient } from "../../src/shared/nutrition";
import { api, sampleRecipe, signUp } from "./helpers";

// 栄養で探す（DEC-038）。API は最新版の材料と人数を返すだけで、計算は src/shared/nutrition.ts
type Row = {
  id: string;
  title: string;
  servings: number | null;
  ingredients: { name: string; amount: string }[];
};
const list = async (cookie: string) =>
  (
    (await (await api(cookie, "/recipes/nutrition")).json()) as {
      recipes: Row[];
    }
  ).recipes;
const create = async (cookie: string, body: Record<string, unknown>) =>
  (
    (await (
      await api(cookie, "/recipes", { method: "POST", body })
    ).json()) as {
      id: string;
    }
  ).id;

const komatsuna = {
  ...sampleRecipe,
  title: "小松菜と厚揚げの煮びたし",
  servings: 2,
  ingredients: [
    { name: "小松菜", amount: "1束" },
    { name: "厚揚げ", amount: "1枚" },
  ],
};

describe("GET /api/recipes/nutrition", () => {
  it("レシピごとに、最新版の材料と人数を返す（栄養で並べられる）", async () => {
    const me = await signUp();
    const id = await create(me, komatsuna);
    await create(me, {
      ...sampleRecipe,
      title: "きゅうりの浅漬け",
      servings: 2,
      ingredients: [{ name: "きゅうり", amount: "2本" }],
    });
    const rows = await list(me);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === id)).toEqual({
      id,
      title: "小松菜と厚揚げの煮びたし",
      servings: 2,
      ingredients: [
        { name: "小松菜", amount: "1束" },
        { name: "厚揚げ", amount: "1枚" },
      ],
    });
    const iron = rankByNutrient(rows, "iron");
    expect(iron.ranked.map((r) => r.id)).toEqual([id]);
  });

  it("版を積んだら、新しい版の材料で返す", async () => {
    const me = await signUp();
    const id = await create(me, komatsuna);
    const res = await api(me, `/recipes/${id}/versions`, {
      method: "POST",
      body: {
        ...komatsuna,
        ingredients: [{ name: "ほうれん草", amount: "1束" }],
        note: "",
      },
    });
    expect(res.status).toBeLessThan(300);
    const row = (await list(me)).find((r) => r.id === id);
    expect(row?.ingredients).toEqual([{ name: "ほうれん草", amount: "1束" }]);
  });

  it("ログインしていなければ 401", async () => {
    expect((await api("", "/recipes/nutrition")).status).toBe(401);
  });

  it("グループをまたいだ漏れがない：他人のレシピは出ない", async () => {
    const owner = await signUp();
    await create(owner, komatsuna);
    const other = await signUp();
    expect(await list(other)).toEqual([]);
    const mine = await create(other, { ...komatsuna, title: "自分の煮びたし" });
    expect((await list(other)).map((r) => r.id)).toEqual([mine]);
    expect((await list(owner)).map((r) => r.title)).toEqual([
      "小松菜と厚揚げの煮びたし",
    ]);
  });
});
