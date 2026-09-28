import { describe, expect, it } from "vitest";
import { addDays, todayJst } from "../../src/shared/dates";
import { api, sampleRecipe, signUp } from "./helpers";

type ShopItem = {
  key: string;
  name: string;
  amount: string;
  section: string;
  home: boolean;
  bought: boolean;
  recipes: string[];
};

async function create(cookie: string, body: object): Promise<string> {
  const res = await api(cookie, "/recipes", { method: "POST", body });
  return ((await res.json()) as { id: string }).id;
}

describe("献立と買い物リスト", () => {
  it("献立に入れると一覧に出て、同じ枠は置き換わり、外せる", async () => {
    const me = await signUp();
    const a = await create(me, sampleRecipe);
    const b = await create(me, { ...sampleRecipe, title: "豚汁" });
    const day = "2030-01-07";
    await api(me, "/plans", {
      method: "PUT",
      body: { date: day, meal: "dinner", recipeId: a },
    });
    await api(me, "/plans", {
      method: "PUT",
      body: { date: day, meal: "dinner", recipeId: b },
    });
    let list = (await (
      await api(me, `/plans?from=${day}&to=${day}`)
    ).json()) as { plans: { title: string }[] };
    expect(list.plans.map((p) => p.title)).toEqual(["豚汁"]);
    expect(
      (await api(me, `/plans/${day}/dinner`, { method: "DELETE" })).status,
    ).toBe(204);
    list = (await (await api(me, `/plans?from=${day}&to=${day}`)).json()) as {
      plans: { title: string }[];
    };
    expect(list.plans).toEqual([]);
  });

  it("買い物リストは今日から期間内だけ・最新版の材料・名寄せして合計・調味料は家にある扱い", async () => {
    const me = await signUp();
    const today = todayJst();
    const a = await create(me, sampleRecipe); // たまねぎ 1個
    const b = await create(me, {
      ...sampleRecipe,
      title: "親子丼",
      ingredients: [
        { name: "玉ねぎ", amount: "1/2個" },
        { name: "卵", amount: "3個" },
      ],
    });
    const pastRecipe = await create(me, {
      ...sampleRecipe,
      title: "昨日の料理",
      ingredients: [{ name: "なす", amount: "2本" }],
    });
    const far = await create(me, {
      ...sampleRecipe,
      title: "来月の料理",
      ingredients: [{ name: "かぼちゃ", amount: "1/4個" }],
    });
    await api(me, "/plans", {
      method: "PUT",
      body: { date: today, meal: "dinner", recipeId: a },
    });
    await api(me, "/plans", {
      method: "PUT",
      body: { date: addDays(today, 1), meal: "lunch", recipeId: b },
    });
    // 過ぎた日には入れられない
    const pastRes = await api(me, "/plans", {
      method: "PUT",
      body: { date: addDays(today, -1), meal: "dinner", recipeId: pastRecipe },
    });
    expect(pastRes.status).toBe(400);
    await api(me, "/plans", {
      method: "PUT",
      body: { date: addDays(today, 20), meal: "dinner", recipeId: far },
    });

    // 最新版で酢 → 米酢 に変えておく
    await api(me, `/recipes/${a}/versions`, {
      method: "POST",
      body: {
        ...sampleRecipe,
        ingredients: sampleRecipe.ingredients.map((i) =>
          i.name === "酢" ? { ...i, name: "米酢" } : i,
        ),
      },
    });

    const res = (await (await api(me, "/shopping?days=3")).json()) as {
      items: ShopItem[];
      recipeCount: number;
    };
    expect(res.recipeCount).toBe(2);
    const names = res.items.map((i) => i.name);
    expect(names).not.toContain("なす");
    expect(names).not.toContain("かぼちゃ");
    expect(names).toContain("米酢");
    expect(names).not.toContain("酢");
    const onion = res.items.find((i) => i.name === "玉ねぎ")!;
    expect(onion).toMatchObject({
      amount: "1と1/2個",
      home: false,
      recipes: ["鶏むね肉の甘酢炒め", "親子丼"],
    });
    expect(res.items.find((i) => i.name === "砂糖")).toMatchObject({
      section: "調味料",
      home: true,
    });

    // 今日の分だけ
    const todayOnly = (await (await api(me, "/shopping?days=1")).json()) as {
      items: ShopItem[];
    };
    expect(todayOnly.items.find((i) => i.name === "卵")).toBeUndefined();

    // 印を付ける
    await api(me, "/shopping/marks", {
      method: "PUT",
      body: { key: onion.key, kind: "home", value: true },
    });
    await api(me, "/shopping/marks", {
      method: "PUT",
      body: { key: onion.key, kind: "bought", value: true },
    });
    let again = (await (await api(me, "/shopping?days=3")).json()) as {
      items: ShopItem[];
    };
    expect(again.items.find((i) => i.name === "玉ねぎ")).toMatchObject({
      home: true,
      bought: true,
    });
    await api(me, "/shopping/bought", { method: "DELETE" });
    again = (await (await api(me, "/shopping?days=3")).json()) as {
      items: ShopItem[];
    };
    expect(again.items.find((i) => i.name === "玉ねぎ")).toMatchObject({
      home: true,
      bought: false,
    });
  });

  it("他の人の買い物リスト・献立は見えない", async () => {
    const alice = await signUp();
    const bob = await signUp();
    const a = await create(alice, sampleRecipe);
    await api(alice, "/plans", {
      method: "PUT",
      body: { date: todayJst(), meal: "dinner", recipeId: a },
    });
    const shop = (await (await api(bob, "/shopping?days=7")).json()) as {
      items: unknown[];
    };
    expect(shop.items).toEqual([]);
    const t = todayJst();
    const plans = (await (
      await api(bob, `/plans?from=${t}&to=${t}`)
    ).json()) as { plans: unknown[] };
    expect(plans.plans).toEqual([]);
  });

  it("期間がおかしければ 400", async () => {
    const me = await signUp();
    expect((await api(me, "/plans?from=2030-01-10&to=2030-01-01")).status).toBe(
      400,
    );
    expect((await api(me, "/plans?from=x&to=y")).status).toBe(400);
  });
});

describe("取り込み", () => {
  it("社内・ローカルの URL には取りに行かない", async () => {
    const me = await signUp();
    const res = await api(me, "/import", {
      method: "POST",
      body: { url: "http://127.0.0.1/recipe" },
    });
    expect(res.status).toBe(422);
    const res2 = await api(me, "/import", {
      method: "POST",
      body: { url: "http://localhost:8787/x" },
    });
    expect(res2.status).toBe(422);
  });
});
