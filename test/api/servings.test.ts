import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { todayJst } from "../../src/shared/dates";
import { api, sampleRecipe, signUp } from "./helpers";

// 何人分か：取り込みで読む・版に持つ・買い物リストはふだんの人数に換算する
const ld = (extra: Record<string, unknown>) =>
  `<html><head><title>ダミー</title><script type="application/ld+json">${JSON.stringify(
    {
      "@type": "Recipe",
      name: "ダミーのキーマ",
      recipeIngredient: ["合いびき肉 400g", "カレー粉 大さじ2"],
      recipeInstructions: ["炒める", "煮る"],
      ...extra,
    },
  )}</script></head><body></body></html>`;

const HEADING_PAGE = `<html><head><title>ダミーの煮物</title></head><body>
  <h2>材料（3人分）</h2><ul><li>大根 1/2本</li></ul>
  <h2>作り方</h2><ol><li>切る</li><li>煮る</li></ol></body></html>`;

const mockHtml = (html: string) =>
  vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(
      async () =>
        new Response(html, { headers: { "content-type": "text/html" } }),
    );

beforeEach(() => {
  delete (env as unknown as { AI?: unknown }).AI;
});
afterEach(() => vi.restoreAllMocks());

type Recipe = {
  versions: { servings: number | null; changes: string[] }[];
};
const getRecipe = async (me: Awaited<ReturnType<typeof signUp>>, id: string) =>
  ((await (await api(me, `/recipes/${id}`)).json()) as { recipe: Recipe })
    .recipe;
const create = async (
  me: Awaited<ReturnType<typeof signUp>>,
  body: Record<string, unknown>,
) =>
  (
    (await (await api(me, "/recipes", { method: "POST", body })).json()) as {
      id: string;
    }
  ).id;

describe("何人分か", () => {
  it("取り込みで、構造化データの recipeYield から人数を読む", async () => {
    mockHtml(ld({ recipeYield: "4人前" }));
    const me = await signUp();
    const j = (await (
      await api(me, "/import", {
        method: "POST",
        body: { url: "https://example.com/r/1" },
      })
    ).json()) as { draft: { servings: number | null } };
    expect(j.draft.servings).toBe(4);
  });

  it("構造化データが無ければ、材料の見出し（材料（3人分））から読む", async () => {
    mockHtml(HEADING_PAGE);
    const me = await signUp();
    const j = (await (
      await api(me, "/import", {
        method: "POST",
        body: { url: "https://example.com/r/2" },
      })
    ).json()) as { draft: { servings: number | null } };
    expect(j.draft.servings).toBe(3);
  });

  it("保存した人数は版に残り、変えると改良のあゆみに書く。渡さなければ前の版のまま", async () => {
    const me = await signUp();
    const id = await create(me, { ...sampleRecipe, servings: 4 });
    expect((await getRecipe(me, id)).versions[0]!.servings).toBe(4);

    const { videoUrl: _v, sourceUrl: _s, origin: _o, ...fields } = sampleRecipe;
    await api(me, `/recipes/${id}/versions`, {
      method: "POST",
      body: { ...fields, servings: 2 },
    });
    let r = await getRecipe(me, id);
    expect(r.versions[1]!.servings).toBe(2);
    expect(r.versions[1]!.changes).toContain("2人分にした");

    await api(me, `/recipes/${id}/versions`, {
      method: "POST",
      body: { ...fields, title: "名前だけ変えた" },
    });
    r = await getRecipe(me, id);
    expect(r.versions[2]!.servings).toBe(2);
  });

  it("人数は 1〜20 だけ", async () => {
    const me = await signUp();
    const res = await api(me, "/recipes", {
      method: "POST",
      body: { ...sampleRecipe, servings: 0 },
    });
    expect(res.status).toBe(400);
  });

  it("前に保存したレシピは、一度だけ出典から人数を探して覚える（無ければ 0）", async () => {
    const me = await signUp();
    const id = await create(me, { ...sampleRecipe, videoUrl: null });
    const spy = mockHtml(ld({ recipeYield: "2人分" }));
    const r1 = (await (
      await api(me, `/recipes/${id}/servings`, { method: "POST" })
    ).json()) as { servings: number };
    expect(r1.servings).toBe(2);
    expect((await getRecipe(me, id)).versions[0]!.servings).toBe(2);
    const calls = spy.mock.calls.length;
    await api(me, `/recipes/${id}/servings`, { method: "POST" });
    expect(spy.mock.calls.length).toBe(calls);

    const id2 = await create(me, { ...sampleRecipe, videoUrl: null });
    mockHtml(ld({}));
    const r2 = (await (
      await api(me, `/recipes/${id2}/servings`, { method: "POST" })
    ).json()) as { servings: number };
    expect(r2.servings).toBe(0);
  });

  it("出典が読めなかったときは覚えない", async () => {
    const me = await signUp();
    const id = await create(me, { ...sampleRecipe, videoUrl: null });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("network down");
    });
    const r = (await (
      await api(me, `/recipes/${id}/servings`, { method: "POST" })
    ).json()) as { servings: number | null };
    expect(r.servings).toBeNull();
    expect((await getRecipe(me, id)).versions[0]!.servings).toBeNull();
  });

  it("ページが無い（404）ときは「無かった」として覚え、もう探さない", async () => {
    const me = await signUp();
    const id = await create(me, { ...sampleRecipe, videoUrl: null });
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response("no", { status: 404 }));
    const r = (await (
      await api(me, `/recipes/${id}/servings`, { method: "POST" })
    ).json()) as { servings: number | null };
    expect(r.servings).toBe(0);
    const calls = spy.mock.calls.length;
    await api(me, `/recipes/${id}/servings`, { method: "POST" });
    expect(spy.mock.calls.length).toBe(calls);
  });

  it("人が「分からない」を選んだ版は、出典から探して上書きしない", async () => {
    const me = await signUp();
    const id = await create(me, {
      ...sampleRecipe,
      videoUrl: null,
      servings: 4,
    });
    const { videoUrl: _v, sourceUrl: _s, origin: _o, ...fields } = sampleRecipe;
    await api(me, `/recipes/${id}/versions`, {
      method: "POST",
      body: { ...fields, servings: null },
    });
    const spy = mockHtml(ld({ recipeYield: "2人分" }));
    await api(me, `/recipes/${id}/servings`, { method: "POST" });
    expect(spy).not.toHaveBeenCalled();
    const r = await getRecipe(me, id);
    expect(r.versions.map((v) => v.servings)).toEqual([4, null]);
  });

  it("買い物リストは、ふだん作る人数（設定）に換算する", async () => {
    const me = await signUp();
    const id = await create(me, {
      ...sampleRecipe,
      servings: 4,
      ingredients: [{ name: "合いびき肉", amount: "400g" }],
    });
    await api(me, "/plans", {
      method: "PUT",
      body: { date: todayJst(), meal: "dinner", recipeId: id },
    });
    type Shop = { people: number; items: { name: string; amount: string }[] };
    let res = (await (await api(me, "/shopping?days=1")).json()) as Shop;
    expect(res.people).toBe(2);
    expect(res.items[0]!.amount).toBe("200g");

    const put = await api(me, "/group/servings", {
      method: "PUT",
      body: { servings: 3 },
    });
    expect(put.status).toBe(200);
    expect(
      ((await (await api(me, "/group")).json()) as { servings: number })
        .servings,
    ).toBe(3);
    res = (await (await api(me, "/shopping?days=1")).json()) as Shop;
    expect(res.items[0]!.amount).toBe("300g");
  });

  it("グループをまたいだ漏れがない：他人のレシピの人数は探せない・自分の人数の設定は他人に効かない", async () => {
    const owner = await signUp();
    const id = await create(owner, { ...sampleRecipe, videoUrl: null });
    const spy = mockHtml(ld({ recipeYield: "2人分" }));
    const other = await signUp();
    const res = await api(other, `/recipes/${id}/servings`, {
      method: "POST",
    });
    expect(res.status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
    expect((await getRecipe(owner, id)).versions[0]!.servings).toBeNull();

    await api(other, "/group/servings", {
      method: "PUT",
      body: { servings: 5 },
    });
    expect(
      ((await (await api(owner, "/group")).json()) as { servings: number })
        .servings,
    ).toBe(2);
  });
});
