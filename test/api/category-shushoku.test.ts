import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import migration from "../../drizzle/0005_category_shushoku.sql?raw";
import { api, signUp } from "./helpers";
import { sampleRecipe } from "./helpers";

// DEC-020：「丼」を「主食」にまとめる
describe("カテゴリ「主食」", () => {
  it("古い画面から「丼」が来ても受け取り、主食として保存する", async () => {
    const me = await signUp();
    const res = await api(me, "/recipes", {
      method: "POST",
      body: { ...sampleRecipe, category: "丼" },
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const r = (await (await api(me, `/recipes/${id}`)).json()) as {
      recipe: { category: string };
    };
    expect(r.recipe.category).toBe("主食");
  });

  it("マイグレーションで、保存済みの「丼」が主食になる（版も）。件数は変わらない", async () => {
    const me = await signUp();
    const { id } = (await (
      await api(me, "/recipes", { method: "POST", body: sampleRecipe })
    ).json()) as { id: string };
    // 移す前の状態を作る（昔の値を直接入れる）
    await env.DB.prepare("UPDATE recipes SET category = '丼' WHERE id = ?")
      .bind(id)
      .run();
    await env.DB.prepare(
      "UPDATE recipe_versions SET category = '丼' WHERE recipe_id = ?",
    )
      .bind(id)
      .run();
    const count = async () =>
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM recipes").first<{
        n: number;
      }>())!.n;
    const before = await count();
    for (const stmt of migration.split("--> statement-breakpoint"))
      if (stmt.replace(/--.*$/gm, "").trim()) await env.DB.prepare(stmt).run();
    expect(await count()).toBe(before);
    const left = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM recipes WHERE category = '丼') + (SELECT COUNT(*) FROM recipe_versions WHERE category = '丼') AS n",
    ).first<{ n: number }>();
    expect(left!.n).toBe(0);
    const r = (await (await api(me, `/recipes/${id}`)).json()) as {
      recipe: { category: string };
    };
    expect(r.recipe.category).toBe("主食");
  });

  it("古い画面の「丼」で絞ると、主食で絞った結果を返す", async () => {
    const me = await signUp();
    await api(me, "/recipes", {
      method: "POST",
      body: { ...sampleRecipe, title: "親子丼", category: "主食" },
    });
    await api(me, "/recipes", {
      method: "POST",
      body: { ...sampleRecipe, title: "鮭", category: "主菜" },
    });
    const r = (await (
      await api(me, "/recipes?category=" + encodeURIComponent("丼"))
    ).json()) as { recipes: { title: string }[] };
    expect(r.recipes.map((x) => x.title)).toEqual(["親子丼"]);
  });
});
