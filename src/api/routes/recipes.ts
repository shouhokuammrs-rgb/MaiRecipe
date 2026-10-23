import { Hono } from "hono";
import { CATEGORIES, GENRES, LIMITS } from "../../shared/constants";
import { findByIngredients } from "../../shared/find";
import { parseVideoUrl } from "../../shared/importer";
import {
  createRecipeSchema,
  findSchema,
  memoSchema,
  newVersionSchema,
  tidyAmount,
} from "../../shared/recipe";
import type { AppEnv } from "../app-env";
import { badRequest } from "../errors";
import { cleanImageUrl } from "../../shared/cover";
import { scanPage } from "../platform/fetch-page";

export const recipes = new Hono<AppEnv>();

const tidy = <T extends { ingredients: { name: string; amount: string }[] }>(
  x: T,
): T => ({
  ...x,
  ingredients: x.ingredients.map((i) => ({
    name: i.name,
    amount: tidyAmount(i.amount),
  })),
});

recipes.get("/", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 50);
  // 古い画面の「丼」は主食で絞る（DEC-020）
  const rawCategory = c.req.query("category");
  const category = rawCategory === "丼" ? "主食" : rawCategory;
  const genre = c.req.query("genre");
  const list = await c.var.repo.listRecipes({
    q: q || undefined,
    category: (CATEGORIES as readonly string[]).includes(category ?? "")
      ? category
      : undefined,
    genre: (GENRES as readonly string[]).includes(genre ?? "")
      ? genre
      : undefined,
  });
  return c.json({ recipes: list });
});

recipes.post("/", async (c) => {
  const parsed = createRecipeSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) return badRequest(c, parsed.error);
  const input = tidy(parsed.data);
  // 動画は YouTube だけ埋め込む。それ以外の URL は出典としてだけ残す
  const video = input.videoUrl ? parseVideoUrl(input.videoUrl) : null;
  const id = await c.var.repo.createRecipe(
    { ...input, videoUrl: video ? video.watchUrl : null },
    c.var.userId,
  );
  return c.json({ id }, 201);
});

recipes.post("/find", async (c) => {
  const parsed = findSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(c, parsed.error);
  const all = await c.var.repo.allLatestIngredients();
  return c.json({ results: findByIngredients(parsed.data.terms, all) });
});

recipes.get("/:id", async (c) => {
  return c.json({ recipe: await c.var.repo.getRecipe(c.req.param("id")) });
});

recipes.delete("/:id", async (c) => {
  await c.var.repo.deleteRecipe(c.req.param("id"));
  return c.body(null, 204);
});

recipes.post("/:id/versions", async (c) => {
  const parsed = newVersionSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) return badRequest(c, parsed.error);
  const result = await c.var.repo.addVersion(
    c.req.param("id"),
    tidy(parsed.data),
    c.var.userId,
  );
  if (!result) return c.json({ unchanged: true });
  return c.json(result, 201);
});

recipes.delete("/:id/versions/:versionId", async (c) => {
  await c.var.repo.deleteVersion(c.req.param("id"), c.req.param("versionId"));
  return c.body(null, 204);
});

recipes.post("/:id/memos", async (c) => {
  const parsed = memoSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(c, parsed.error);
  const id = await c.var.repo.addMemo(
    c.req.param("id"),
    parsed.data.text,
    c.var.userId,
  );
  return c.json({ id }, 201);
});

recipes.delete("/:id/memos/:memoId", async (c) => {
  await c.var.repo.deleteMemo(c.req.param("id"), c.req.param("memoId"));
  return c.body(null, 204);
});

// 写真：画面側で長辺1600px・JPEG に縮めてから送る。API は中身を触らず保存するだけ
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * 表紙に出す、出典のページの画像を探して覚える（DEC-023）。前に保存したレシピのために一度だけ。
 * 画像はこちらに保存せず、URL だけ。見つからなければ "" を覚えて、もう探さない
 */
recipes.post("/:id/cover", async (c) => {
  const id = c.req.param("id");
  const r = await c.var.repo.getRecipe(id);
  if (r.coverUrl !== null) return c.json({ coverUrl: r.coverUrl });
  let cover = "";
  if (r.sourceUrl && !r.videoUrl && !parseVideoUrl(r.sourceUrl)) {
    try {
      const page = await scanPage(r.sourceUrl, { timeoutMs: 6000 });
      cover = cleanImageUrl(page.image, page.url) ?? "";
    } catch {
      // 読めないページは「無かった」として覚える
    }
  }
  await c.var.repo.setCoverUrl(id, cover);
  return c.json({ coverUrl: cover });
});

recipes.put("/:id/image", async (c) => {
  const type = (c.req.header("content-type") ?? "").split(";")[0]!.trim();
  if (!IMAGE_TYPES.includes(type))
    return c.json({ error: "JPEG・PNG・WebP の画像だけ使えます" }, 415);
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength === 0) return c.json({ error: "画像が空です" }, 400);
  if (buf.byteLength > LIMITS.imageMaxBytes)
    return c.json({ error: "画像は1MB以下にしてください" }, 413);
  await c.var.repo.putImage(c.req.param("id"), type, buf);
  return c.body(null, 204);
});

recipes.get("/:id/image", async (c) => {
  const img = await c.var.repo.getImage(c.req.param("id"));
  return new Response(img.data, {
    headers: {
      "content-type": img.mime,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
});

recipes.delete("/:id/image", async (c) => {
  await c.var.repo.deleteImage(c.req.param("id"));
  return c.body(null, 204);
});
