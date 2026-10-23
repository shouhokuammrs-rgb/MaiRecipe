import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, sampleRecipe, signUp } from "./helpers";

// 表紙（DEC-023）：出典の画像は URL だけ覚え、元の場所から表示する
const PAGE = `<html><head><title>ダミー</title>
  <meta property="og:image" content="/img/dummy.jpg">
  <script type="application/ld+json">${JSON.stringify({
    "@type": "Recipe",
    name: "ダミーの煮物",
    recipeIngredient: ["大根 1/2本"],
    recipeInstructions: ["切る", "煮る"],
  })}</script></head><body></body></html>`;

beforeEach(() => {
  delete (env as unknown as { AI?: unknown }).AI;
});
afterEach(() => vi.restoreAllMocks());

const mockPage = () =>
  vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(
      async () =>
        new Response(PAGE, { headers: { "content-type": "text/html" } }),
    );

describe("表紙（出典の画像）", () => {
  it("取り込みの下書きに、ページの共有用の画像を https の絶対 URL で入れる", async () => {
    mockPage();
    const me = await signUp();
    const j = (await (
      await api(me, "/import", {
        method: "POST",
        body: { url: "https://example.com/r/1" },
      })
    ).json()) as { draft: { coverUrl: string } };
    expect(j.draft.coverUrl).toBe("https://example.com/img/dummy.jpg");
  });

  it("保存すると一覧に出る。http の画像は受け付けない", async () => {
    const me = await signUp();
    const ok = await api(me, "/recipes", {
      method: "POST",
      body: { ...sampleRecipe, coverUrl: "https://example.com/a.jpg" },
    });
    expect(ok.status).toBe(201);
    const list = (await (await api(me, "/recipes")).json()) as {
      recipes: { coverUrl: string | null }[];
    };
    expect(list.recipes[0]!.coverUrl).toBe("https://example.com/a.jpg");
    const bad = await api(me, "/recipes", {
      method: "POST",
      body: { ...sampleRecipe, coverUrl: "http://example.com/a.jpg" },
    });
    expect(bad.status).toBe(400);
  });

  it("前に保存したレシピは、一度だけ出典のページから探して覚える", async () => {
    const me = await signUp();
    const { id } = (await (
      await api(me, "/recipes", {
        method: "POST",
        body: { ...sampleRecipe, videoUrl: null },
      })
    ).json()) as { id: string };
    const spy = mockPage();
    const r1 = (await (
      await api(me, `/recipes/${id}/cover`, { method: "POST" })
    ).json()) as { coverUrl: string };
    expect(r1.coverUrl).toBe("https://example.com/img/dummy.jpg");
    const calls = spy.mock.calls.length;
    await api(me, `/recipes/${id}/cover`, { method: "POST" });
    expect(spy.mock.calls.length).toBe(calls);
  });

  it("動画のレシピはページを読まない（サムネイルを使う）", async () => {
    const me = await signUp();
    const { id } = (await (
      await api(me, "/recipes", { method: "POST", body: sampleRecipe })
    ).json()) as { id: string };
    const spy = mockPage();
    const r = (await (
      await api(me, `/recipes/${id}/cover`, { method: "POST" })
    ).json()) as { coverUrl: string };
    expect(r.coverUrl).toBe("");
    expect(spy).not.toHaveBeenCalled();
  });

  it("グループをまたいだ漏れがない：他人のレシピの表紙は探せない・変えられない", async () => {
    const owner = await signUp();
    const { id } = (await (
      await api(owner, "/recipes", {
        method: "POST",
        body: { ...sampleRecipe, videoUrl: null },
      })
    ).json()) as { id: string };
    const spy = mockPage();
    const other = await signUp();
    const res = await api(other, `/recipes/${id}/cover`, { method: "POST" });
    expect(res.status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
  });
});
