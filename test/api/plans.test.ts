import { describe, expect, it } from "vitest";
import { addDays, todayJst } from "../../src/shared/dates";
import { api, insertPlanRaw, sampleRecipe, signUp, signUpAs } from "./helpers";

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

type PlanRow = {
  id: string;
  date: string;
  meal: string;
  position: number;
  recipeId: string;
  title: string;
};

async function plansOf(cookie: string, from: string, to = from) {
  const res = await api(cookie, `/plans?from=${from}&to=${to}`);
  return ((await res.json()) as { plans: PlanRow[] }).plans;
}

const put = (cookie: string, date: string, meal: string, recipeId: string) =>
  api(cookie, "/plans", { method: "PUT", body: { date, meal, recipeId } });

describe("献立と買い物リスト", () => {
  it("1つの枠に何品でも足せて、足した順に返る。同じレシピは2回足しても1品のまま", async () => {
    const me = await signUp();
    const a = await create(me, sampleRecipe);
    const b = await create(me, { ...sampleRecipe, title: "豚汁" });
    const day = "2030-01-07";
    expect((await put(me, day, "dinner", a)).status).toBe(204);
    expect((await put(me, day, "dinner", b)).status).toBe(204);
    expect((await put(me, day, "dinner", a)).status).toBe(204); // 何もしない
    const list = await plansOf(me, day);
    expect(list.map((p) => [p.title, p.position])).toEqual([
      ["鶏むね肉の甘酢炒め", 0],
      ["豚汁", 1],
    ]);
    expect(new Set(list.map((p) => p.id)).size).toBe(2);
    // 同じレシピを足し直しても、位置はずれない（3品目は position 2）
    const c = await create(me, {
      ...sampleRecipe,
      title: "ほうれん草のおひたし",
    });
    await put(me, day, "dinner", c);
    expect((await plansOf(me, day)).map((p) => p.position)).toEqual([0, 1, 2]);
  });

  it("並びは 日付 → 朝昼晩 → 枠の中の順", async () => {
    const me = await signUp();
    const a = await create(me, { ...sampleRecipe, title: "A" });
    const b = await create(me, { ...sampleRecipe, title: "B" });
    const d1 = "2030-02-01";
    const d2 = "2030-02-02";
    await put(me, d2, "breakfast", a);
    await put(me, d1, "dinner", b);
    await put(me, d1, "breakfast", a);
    await put(me, d1, "dinner", a);
    await put(me, d1, "lunch", b);
    expect(
      (await plansOf(me, d1, d2)).map((p) => `${p.date}:${p.meal}:${p.title}`),
    ).toEqual([
      `${d1}:breakfast:A`,
      `${d1}:lunch:B`,
      `${d1}:dinner:B`,
      `${d1}:dinner:A`,
      `${d2}:breakfast:A`,
    ]);
  });

  it("移行前の形（position を書かない）の行は position 0 の1品として読め、2品目を後ろに足せる", async () => {
    const me = await signUpAs("移行前");
    const a = await create(me.cookie, { ...sampleRecipe, title: "昔の献立" });
    const b = await create(me.cookie, { ...sampleRecipe, title: "足した品" });
    const day = "2030-03-01";
    await insertPlanRaw(me.email, { date: day, meal: "dinner", recipeId: a });
    expect(
      (await plansOf(me.cookie, day)).map((p) => [p.title, p.position]),
    ).toEqual([["昔の献立", 0]]);
    await put(me.cookie, day, "dinner", b);
    expect(
      (await plansOf(me.cookie, day)).map((p) => [p.title, p.position]),
    ).toEqual([
      ["昔の献立", 0],
      ["足した品", 1],
    ]);
  });

  it("枠を丸ごと空にする DELETE /plans/:date/:meal は残っている（古い画面のため）", async () => {
    const me = await signUp();
    const a = await create(me, sampleRecipe);
    const b = await create(me, { ...sampleRecipe, title: "豚汁" });
    const day = "2030-01-08";
    await put(me, day, "dinner", a);
    await put(me, day, "dinner", b);
    await put(me, day, "lunch", a);
    expect(
      (await api(me, `/plans/${day}/dinner`, { method: "DELETE" })).status,
    ).toBe(204);
    expect((await plansOf(me, day)).map((p) => p.meal)).toEqual(["lunch"]);
  });

  it("買い物リストは、1つの枠の全品の材料を合算する", async () => {
    const me = await signUp();
    const today = todayJst();
    const a = await create(me, sampleRecipe); // 鶏むね肉・たまねぎ・酢・砂糖
    const b = await create(me, {
      ...sampleRecipe,
      title: "大根の味噌汁",
      ingredients: [{ name: "大根", amount: "1/4本" }],
    });
    await put(me, today, "dinner", a);
    await put(me, today, "dinner", b);
    const res = (await (await api(me, "/shopping?days=1")).json()) as {
      items: ShopItem[];
      recipeCount: number;
    };
    expect(res.recipeCount).toBe(2);
    const names = res.items.map((i) => i.name);
    expect(names).toContain("鶏むね肉");
    expect(names).toContain("大根");
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
