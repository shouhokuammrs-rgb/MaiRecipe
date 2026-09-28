// URL から取り込み（保存はしない。画面で確認してから POST /api/recipes で保存する）。
// サイトは JSON-LD の Recipe から、YouTube は題名と埋め込み用 URL だけ。AI は使わない。
import { Hono } from "hono";
import {
  extractRecipeFromJsonLd,
  guessCategory,
  guessGenre,
  parseVideoUrl,
} from "../../shared/importer";
import { importSchema } from "../../shared/recipe";
import type { AppEnv } from "../app-env";
import { badRequest } from "../errors";
import { scanPage, youtubeTitle } from "../platform/fetch-page";

export const importer = new Hono<AppEnv>();

importer.post("/", async (c) => {
  const parsed = importSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(c, parsed.error);
  const url = parsed.data.url;

  const video = parseVideoUrl(url);
  if (video) {
    const title = await youtubeTitle(video.watchUrl);
    return c.json({
      kind: "video",
      found: false,
      draft: {
        title: title || "動画のレシピ",
        ingredients: [],
        steps: [],
        timeLabel: "",
        category: guessCategory([title]),
        genre: guessGenre([title]),
        sourceUrl: video.watchUrl,
        videoUrl: video.watchUrl,
      },
      message:
        "動画はアプリ内で再生できます。材料と作り方は、動画を見ながら入れてください。",
    });
  }

  const page = await scanPage(url);
  const recipe = extractRecipeFromJsonLd(page.jsonLd);
  if (!recipe) {
    return c.json({
      kind: "page",
      found: false,
      draft: {
        title: page.title || "取り込んだレシピ",
        ingredients: [],
        steps: [],
        timeLabel: "",
        category: guessCategory([page.title]),
        genre: guessGenre([page.title]),
        sourceUrl: url,
        videoUrl: null,
      },
      message:
        "このページからは材料と作り方を読み取れませんでした。出典を残したまま、手で入れられます。",
    });
  }
  return c.json({
    kind: "page",
    found: true,
    draft: { ...recipe, sourceUrl: url },
    message: "ページの構造化データから読み取りました（AI なし）。",
  });
});
