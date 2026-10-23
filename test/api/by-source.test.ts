import { describe, expect, it } from "vitest";
import { api, sampleRecipe, signUp } from "./helpers";

// 二重の取り込みを知らせる：同じ出典のレシピが保存済みか
const find = async (cookie: string, url: string) =>
  (
    (await (
      await api(cookie, `/recipes/by-source?url=${encodeURIComponent(url)}`)
    ).json()) as { recipe: { id: string; title: string } | null }
  ).recipe;

describe("GET /api/recipes/by-source", () => {
  it("表記の揺れがあっても、同じページ・同じ動画なら保存済みのレシピを返す", async () => {
    const me = await signUp();
    const { id } = (await (
      await api(me, "/recipes", {
        method: "POST",
        body: {
          ...sampleRecipe,
          sourceUrl: "https://www.example.com/recipes/1",
          videoUrl: "https://www.youtube.com/watch?v=abcDEF12345",
        },
      })
    ).json()) as { id: string };
    expect(
      await find(me, "http://example.com/recipes/1/?utm_source=x"),
    ).toEqual({ id, title: sampleRecipe.title });
    expect((await find(me, "https://youtu.be/abcDEF12345"))?.id).toBe(id);
    expect(await find(me, "https://www.example.com/recipes/2")).toBeNull();
    expect(await find(me, "")).toBeNull();
  });

  it("グループをまたいだ漏れがない：他人の保存済みは見えない", async () => {
    const owner = await signUp();
    await api(owner, "/recipes", {
      method: "POST",
      body: { ...sampleRecipe, sourceUrl: "https://example.com/secret" },
    });
    const other = await signUp();
    expect(await find(other, "https://example.com/secret")).toBeNull();
  });
});
