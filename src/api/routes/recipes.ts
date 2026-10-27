import { Hono } from "hono";
import { CATEGORIES, GENRES, LIMITS } from "../../shared/constants";
import { findByIngredients } from "../../shared/find";
import { extractRecipeFromJsonLd, parseVideoUrl } from "../../shared/importer";
import { servingsFromText } from "../../shared/servings";
import {
  createRecipeSchema,
  findSchema,
  memoSchema,
  newVersionSchema,
  tidyAmount,
} from "../../shared/recipe";
import type { AppEnv } from "../app-env";
import { badRequest } from "../errors";
import { cleanImageUrl, jsonLdImage } from "../../shared/cover";
import {
  FetchPageError,
  scanPage,
  youtubeSnippet,
} from "../platform/fetch-page";
import { startImportJob } from "./import-jobs";
import {
  AiBadOutput,
  AiDailyStop,
  AiQuotaExceeded,
  AiUnavailable,
  suggestMemoChanges,
  GeminiRateLimited,
  suggestRecipeIdeas,
} from "../ai";
import { ideaSchema } from "../../shared/ai-idea";
import { cookedSchema } from "../../shared/cooked";
import { todayJst } from "../../shared/dates";

const isTransient = (e: FetchPageError) =>
  e.message === "ページを取得できませんでした" ||
  /（(?:5\d\d|429)）/.test(e.message);

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
  const cookedQ = c.req.query("cooked");
  const list = await c.var.repo.listRecipes(
    {
      q: q || undefined,
      category: (CATEGORIES as readonly string[]).includes(category ?? "")
        ? category
        : undefined,
      genre: (GENRES as readonly string[]).includes(genre ?? "")
        ? genre
        : undefined,
      cooked:
        cookedQ === "again" || cookedQ === "often" || cookedQ === "stale"
          ? cookedQ
          : undefined,
    },
    c.var.userId,
  );
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

/** 同じ出典のレシピが保存済みか（取り込む前に「保存済みです」と知らせる） */
recipes.get("/by-source", async (c) => {
  const url = (c.req.query("url") ?? "").trim().slice(0, LIMITS.urlMax);
  return c.json({ recipe: url ? await c.var.repo.findBySource(url) : null });
});

recipes.post("/find", async (c) => {
  const parsed = findSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(c, parsed.error);
  const all = await c.var.repo.allLatestIngredients();
  return c.json({ results: findByIngredients(parsed.data.terms, all) });
});

/**
 * 冷蔵庫の食材から、AI に新しいレシピを考えてもらう（#15 / DEC-029）。保存はしない。
 * 冷蔵庫のほかの食材も「使ってよい」として渡す（グループの中から読む）
 */
recipes.post("/ideas", async (c) => {
  const parsed = ideaSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(c, parsed.error);
  if (!c.env.AI && !c.env.GEMINI_API_KEY)
    return c.json({ error: "今は AI を使えない設定です。" }, 503);
  const { use, wish } = parsed.data;
  const chosen = new Set(use);
  const others = (await c.var.repo.listPantry())
    .map((p) => p.name)
    .filter((n) => !chosen.has(n))
    .slice(0, 30);
  try {
    return c.json({
      ideas: await suggestRecipeIdeas(c.env, { use, others, wish }),
    });
  } catch (e) {
    if (e instanceof AiDailyStop)
      return c.json(
        { error: "今日の AI の無料分の9割を使ったので、止めています。" },
        429,
      );
    if (e instanceof GeminiRateLimited)
      return c.json(
        { error: "AI が混み合っています。1分ほど待ってから試してください。" },
        429,
      );
    if (e instanceof AiQuotaExceeded)
      return c.json(
        { error: "今日の AI の無料分を使い切りました。明日また使えます。" },
        429,
      );
    if (e instanceof AiUnavailable)
      return c.json(
        { error: "今は AI につながりません。少し待ってから試してください。" },
        503,
      );
    if (e instanceof AiBadOutput)
      return c.json(
        { error: "レシピの案を作れませんでした。もう一度試してください。" },
        422,
      );
    throw e;
  }
});

recipes.get("/:id", async (c) => {
  return c.json({
    recipe: await c.var.repo.getRecipe(c.req.param("id"), c.var.userId),
  });
});

/** 作った！（DEC-030）。作った記録は共有、食べた人の記録と評価は本人のもの */
recipes.post("/:id/cooked", async (c) => {
  const parsed = cookedSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(c, parsed.error);
  const id = await c.var.repo.addCooked(
    c.req.param("id"),
    c.var.userId,
    parsed.data,
    todayJst(),
  );
  return c.json({ id }, 201);
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

/**
 * メモから、レシピの変更案を AI に出してもらう（#23 / DEC-027）。保存はしない。
 * レシピとメモはセッションのグループからだけ読む（クライアントの送った本文は使わない）
 */
recipes.post("/:id/memos/:memoId/suggest", async (c) => {
  const r = await c.var.repo.getRecipe(c.req.param("id"));
  const memo = r.memos.find((m) => m.id === c.req.param("memoId"));
  if (!memo) return c.json({ error: "メモが見つかりません" }, 404);
  if (!c.env.AI && !c.env.GEMINI_API_KEY)
    return c.json({ error: "今は AI を使えない設定です。" }, 503);
  const v = r.versions[r.versions.length - 1]!;
  try {
    const changes = await suggestMemoChanges(
      c.env,
      {
        title: v.title,
        servings: v.servings || null,
        ingredients: v.ingredients,
        steps: v.steps,
        tips: v.tips,
      },
      memo.text,
    );
    return c.json({ versionId: v.id, changes });
  } catch (e) {
    if (e instanceof AiDailyStop)
      return c.json(
        {
          error:
            "今日の AI の無料分の9割を使ったので、止めています。手で直すことはできます。",
        },
        429,
      );
    if (e instanceof AiQuotaExceeded)
      return c.json(
        {
          error:
            "AI の無料分の上限に当たりました。少し待ってから試してください。",
        },
        429,
      );
    if (e instanceof AiUnavailable)
      return c.json(
        { error: "今は AI につながりません。少し待ってから試してください。" },
        503,
      );
    if (e instanceof AiBadOutput)
      return c.json(
        { error: "変更案を作れませんでした。手で直してください。" },
        422,
      );
    throw e;
  }
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
      cover =
        cleanImageUrl(page.image, page.url) ??
        jsonLdImage(page.jsonLd, page.url) ??
        "";
    } catch {
      // 読めなかった（不通・時間切れ）ときは覚えない。次に一覧を開いたときにまた探す
      return c.json({ coverUrl: null });
    }
  }
  await c.var.repo.setCoverUrl(id, cover);
  return c.json({ coverUrl: cover });
});

/**
 * 人数の分からないレシピ（人数を読む前に取り込んだもの）の人数を、出典から探して覚える。
 * ページは構造化データか材料の見出し、動画は概要欄から。見つからなければ 0（もう探さない）。
 * 出典が読めなかったときは覚えない（次に開いたときにまた探す）
 */
recipes.post("/:id/servings", async (c) => {
  const id = c.req.param("id");
  const r = await c.var.repo.getRecipe(id);
  const latest = r.versions[r.versions.length - 1];
  // 探すのは、どの版にも人数が無い（人数を読む前に保存した）レシピだけ。
  // 人が「分からない」を選んだ版は上書きしない
  if (!latest || r.versions.some((v) => v.servings !== null))
    return c.json({ servings: latest?.servings ?? null });
  let found: number | null = null;
  const video = r.videoUrl ? parseVideoUrl(r.videoUrl) : null;
  const pageUrl =
    r.sourceUrl && !parseVideoUrl(r.sourceUrl) ? r.sourceUrl : null;
  try {
    if (pageUrl) {
      const page = await scanPage(pageUrl, { timeoutMs: 6000 });
      found = extractRecipeFromJsonLd(page.jsonLd)?.servings ?? page.servings;
    }
    if (!found && video) {
      const snip = await youtubeSnippet(c.env, video.id);
      if (!snip) return c.json({ servings: null });
      found = servingsFromText(snip.description);
    }
  } catch (e) {
    // 一時的な失敗（不通・時間切れ・相手の 5xx）は覚えない。次に開いたときにまた探す。
    // ページが無い・レシピのページでない などは、何度読んでも同じなので「無かった」として覚える
    if (!(e instanceof FetchPageError) || isTransient(e))
      return c.json({ servings: null });
  }
  await c.var.repo.fillServings(id, found ?? 0);
  return c.json({ servings: found ?? 0 });
});

/**
 * 保存済みのレシピを、出典から読み直す（裏の読み取り）。読めた結果は、画面で確かめてから新しい版として保存する。
 * 読む URL は保存してある出典（クライアントの値は使わない）
 */
recipes.post("/:id/reread", async (c) => {
  const r = await c.var.repo.getRecipe(c.req.param("id"));
  const url = r.sourceUrl ?? r.videoUrl;
  if (!url) return c.json({ error: "出典の URL がないレシピです" }, 422);
  return startImportJob(c, url, r.id);
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
