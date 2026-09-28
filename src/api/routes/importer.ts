// URL から取り込み（保存はしない。画面で確認してから POST /api/recipes で保存する）。
// サイトは JSON-LD の Recipe から、無ければ「材料」「作り方」の見出しの後から読む。
// YouTube は概要欄の【材料】【作り方】から、無ければ概要欄に貼られたレシピページから読む。AI は使わない。
import { Hono } from "hono";
import {
  cleanSourceUrl,
  extractRecipeFromJsonLd,
  guessCategory,
  guessGenre,
  isRecipeCandidateHost,
  overlapNotice,
  parseRecipeText,
  parseVideoUrl,
  pickRecipeUrls,
  recipeFromSections,
  type ImportedRecipe,
} from "../../shared/importer";
import { LIMITS } from "../../shared/constants";
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

// 読めなかった URL の報告（URL だけを保存。グループはセッションから）
importer.get("/reports", async (c) =>
  c.json({ reports: await c.var.repo.listImportReports() }),
);

importer.post("/reports", async (c) => {
  const parsed = importSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(c, parsed.error);
  const ok = await c.var.repo.addImportReport(parsed.data.url, c.var.userId);
  if (!ok)
    return c.json(
      {
        error: `報告は${LIMITS.importReportsMax}件までです。これ以上は報告できません。`,
      },
      429,
    );
  return c.json({ ok: true }, 201);
});

/** 概要欄のリンクを読むときの上限（3件合わせて12秒まで・1件ごとに短め・小さめ） */
const LINKS_DEADLINE_MS = 12_000;
const LINK_SCAN = {
  allowHost: isRecipeCandidateHost,
  timeoutMs: 5000,
  maxRedirects: 3,
  maxBytes: 800_000,
};

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
      // ① 概要欄の【材料】【作り方】の区切り、無ければ「名前...分量」の行の塊から
      const fromDesc = parseRecipeText(snip.description);
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
          notice: overlapNotice(fromDesc?.overlaps ?? []),
        });
      }
      // ② 概要欄に貼られた URL を上から順に（最大3件）。転送先が SNS・動画なら読まない
      const deadline = Date.now() + LINKS_DEADLINE_MS;
      for (const link of pickRecipeUrls(snip.description, 3)) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        let page: PageScan;
        try {
          page = await scanPage(link, {
            ...LINK_SCAN,
            timeoutMs: Math.min(LINK_SCAN.timeoutMs, remaining),
          });
        } catch {
          continue;
        }
        const { recipe: r, via } = readPage(page);
        if (!r) continue;
        // 見出しから読んだときは、材料と手順の両方が取れたページだけ（商品ページなどを避ける）
        if (via === "sections" && (!r.ingredients.length || !r.steps.length))
          continue;
        const sourceUrl = cleanSourceUrl(page.url) ?? cleanSourceUrl(link);
        if (!sourceUrl) continue; // 長すぎて保存できない URL
        return c.json({
          kind: "video",
          found: true,
          draft: {
            ...r,
            sourceUrl,
            videoUrl: video.watchUrl,
          },
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
