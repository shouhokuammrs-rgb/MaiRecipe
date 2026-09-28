// URL から取り込み（保存はしない。画面で確認してから POST /api/recipes で保存する）。
// サイトは JSON-LD の Recipe から、無ければ「材料」「作り方」の見出しの後から読む。
// YouTube は概要欄の【材料】【作り方】から、無ければ概要欄に貼られたレシピページから読む。AI は使わない。
import { Hono } from "hono";
import {
  extractRecipeFromJsonLd,
  guessCategory,
  guessGenre,
  parseDescriptionRecipe,
  parseVideoUrl,
  pickRecipeUrls,
  recipeFromSections,
  type ImportedRecipe,
} from "../../shared/importer";
import { importSchema } from "../../shared/recipe";
import type { AppEnv } from "../app-env";
import { badRequest } from "../errors";
import {
  scanPage,
  youtubeSnippet,
  youtubeTitle,
  type PageScan,
} from "../platform/fetch-page";

export const importer = new Hono<AppEnv>();

const NOT_FOUND_MESSAGE =
  "このページからは材料と作り方を読み取れませんでした。出典を残したまま、手で入れられます。";

/** JSON-LD を先に、無ければ見出しの後から */
function readPage(page: PageScan): {
  recipe: ImportedRecipe | null;
  via: "jsonld" | "sections";
} {
  const fromLd = extractRecipeFromJsonLd(page.jsonLd);
  if (fromLd) return { recipe: fromLd, via: "jsonld" };
  return {
    recipe: recipeFromSections({ title: page.title, ...page.sections }),
    via: "sections",
  };
}

importer.post("/", async (c) => {
  const parsed = importSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(c, parsed.error);
  const url = parsed.data.url;

  const video = parseVideoUrl(url);
  if (video) {
    const snip = await youtubeSnippet(c.env, video.id);
    if (snip) {
      const title = snip.title || "動画のレシピ";
      // ① 概要欄に【材料】【作り方】の区切りがあれば、そこから
      const fromDesc = parseDescriptionRecipe(snip.description);
      const recipe = fromDesc
        ? recipeFromSections({ title, ...fromDesc })
        : null;
      if (recipe) {
        return c.json({
          kind: "video",
          found: true,
          draft: {
            ...recipe,
            title,
            sourceUrl: video.watchUrl,
            videoUrl: video.watchUrl,
          },
          message: "動画の概要欄から読み取りました（AI なし）。",
        });
      }
      // ② 概要欄に貼られた URL を上から順に（最大3件）
      for (const link of pickRecipeUrls(snip.description, 3)) {
        let page: PageScan;
        try {
          page = await scanPage(link);
        } catch {
          continue;
        }
        const { recipe: r } = readPage(page);
        if (!r) continue;
        return c.json({
          kind: "video",
          found: true,
          draft: { ...r, sourceUrl: page.url, videoUrl: video.watchUrl },
          message:
            "動画の概要欄にあるレシピのページから読み取りました（AI なし）。",
        });
      }
    }
    const title = snip?.title || (await youtubeTitle(video.watchUrl));
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
  const { recipe, via } = readPage(page);
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
      message: NOT_FOUND_MESSAGE,
    });
  }
  return c.json({
    kind: "page",
    found: true,
    draft: { ...recipe, sourceUrl: url },
    message:
      via === "jsonld"
        ? "ページの構造化データから読み取りました（AI なし）。"
        : "ページの「材料」「作り方」の見出しから読み取りました（AI なし）。内容を確かめてから保存してください。",
  });
});
