import { describe, expect, it } from "vitest";
import { addDays, todayJst } from "../../src/shared/dates";
import { api, insertPlanRaw, sampleRecipe, signUp, signUpAs } from "./helpers";

// 献立ごとの人数（作り置きなど）。買い物リストはその人数で計算する
type Plan = { id: string; servings: number | null };
const plansOf = async (me: string, day: string) =>
  (
    (await (await api(me, `/plans?from=${day}&to=${day}`)).json()) as {
      plans: Plan[];
    }
  ).plans;

async function planned(me: string) {
  const { id } = (await (
    await api(me, "/recipes", {
      method: "POST",
      body: {
        ...sampleRecipe,
        servings: 2,
        ingredients: [{ name: "合いびき肉", amount: "200g" }],
      },
    })
  ).json()) as { id: string };
  const today = todayJst();
  await api(me, "/plans", {
    method: "PUT",
    body: { date: today, meal: "dinner", recipeId: id },
  });
  return (await plansOf(me, today))[0]!;
}

const setServings = (me: string, id: string, servings: number | null) =>
  api(me, `/plans/items/${id}/servings`, {
    method: "PUT",
    body: { servings },
  });

describe("PUT /api/plans/items/:id/servings", () => {
  it("人数を決めると買い物リストに効き、null で「ふだんの人数」に戻る", async () => {
    const me = await signUp();
    const p = await planned(me);
    expect(p.servings).toBeNull();
    expect((await setServings(me, p.id, 4)).status).toBe(204);
    expect((await plansOf(me, todayJst()))[0]!.servings).toBe(4);
    type Shop = { items: { amount: string }[] };
    let shop = (await (await api(me, "/shopping?days=1")).json()) as Shop;
    expect(shop.items[0]!.amount).toBe("400g");
    await setServings(me, p.id, null);
    shop = (await (await api(me, "/shopping?days=1")).json()) as Shop;
    expect(shop.items[0]!.amount).toBe("200g");
  });

  it("1〜20人分だけ。過ぎた日の献立は変えられない", async () => {
    const who = await signUpAs();
    const me = who.cookie;
    const p = await planned(me);
    expect((await setServings(me, p.id, 0)).status).toBe(400);
    const noKey = await api(me, `/plans/items/${p.id}/servings`, {
      method: "PUT",
      body: {},
    });
    expect(noKey.status).toBe(400);
    expect((await setServings(me, p.id, 21)).status).toBe(400);
    const { id: rid } = (await (
      await api(me, "/recipes", { method: "POST", body: sampleRecipe })
    ).json()) as { id: string };
    const old = await insertPlanRaw(who.email, {
      date: addDays(todayJst(), -1),
      meal: "dinner",
      recipeId: rid,
    });
    expect((await setServings(me, old, 3)).status).toBe(400);
  });

  it("グループをまたいだ漏れがない：他人の献立の人数は変えられない", async () => {
    const owner = await signUp();
    const p = await planned(owner);
    const other = await signUp();
    expect((await setServings(other, p.id, 6)).status).toBe(404);
    expect((await plansOf(owner, todayJst()))[0]!.servings).toBeNull();
  });

  it("人数の分からないレシピは換算せず、買い物リストで知らせる", async () => {
    const me = await signUp();
    const { id } = (await (
      await api(me, "/recipes", {
        method: "POST",
        body: {
          ...sampleRecipe,
          title: "人数なし",
          ingredients: [{ name: "卵", amount: "2個" }],
        },
      })
    ).json()) as { id: string };
    await api(me, "/plans", {
      method: "PUT",
      body: { date: todayJst(), meal: "dinner", recipeId: id },
    });
    const p = (await plansOf(me, todayJst()))[0]!;
    await setServings(me, p.id, 6);
    const shop = (await (await api(me, "/shopping?days=1")).json()) as {
      unscaled: string[];
      items: { amount: string }[];
    };
    expect(shop.items[0]!.amount).toBe("2個");
    expect(shop.unscaled).toEqual(["人数なし"]);
  });
});
