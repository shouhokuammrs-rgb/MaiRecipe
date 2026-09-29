// URL から取り込み（保存はしない。画面で確認してから POST /api/recipes で保存する）。
// サイトは JSON-LD の Recipe から、無ければ「材料」「作り方」の見出しの後から読む。
// YouTube は概要欄の【材料】【作り方】から、無ければ概要欄に貼られたレシピページ、
// それも無ければ動画のコメント（投稿者本人のものを先に）から読む。AI は使わない。
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
  youtubeComments,
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

/** 概要欄・コメントの文章から。読めなければ null */
function readText(
  text: string,
  title: string,
): { recipe: ImportedRecipe; notice: string | null } | null {
  const parsed = parseRecipeText(text);
  if (!parsed) return null;
  const recipe = recipeFromSections({ title, ...parsed });
  if (!recipe) return null;
  return { recipe, notice: overlapNotice(parsed.overlaps) };
}

/** 貼られたリンクを上から順に読み、最初に取れたものを出典つきで返す（締め切りまで） */
async function readLinks(
  links: string[],
  deadline: number,
): Promise<(ImportedRecipe & { sourceUrl: string }) | null> {
  for (const link of links) {
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
    return { ...r, sourceUrl };
  }
  return null;
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
      const videoDraft = (recipe: ImportedRecipe) => ({
        ...recipe,
        title,
        sourceUrl: video.watchUrl,
        videoUrl: video.watchUrl,
      });
      // ① 概要欄の【材料】【作り方】の区切り、無ければ「名前...分量」の行の塊から
      const fromDesc = readText(snip.description, title);
      if (fromDesc) {
        return c.json({
          kind: "video",
          found: true,
          draft: videoDraft(fromDesc.recipe),
          message: "動画の概要欄から読み取りました（AI なし）。",
          notice: fromDesc.notice,
        });
      }
      // ② 概要欄に貼られた URL を上から順に（最大3件）。転送先が SNS・動画なら読まない
      const deadline = Date.now() + LINKS_DEADLINE_MS;
      const descLinks = pickRecipeUrls(snip.description, 3);
      const fromLink = await readLinks(descLinks, deadline);
      if (fromLink) {
        return c.json({
          kind: "video",
          found: true,
          draft: { ...fromLink, videoUrl: video.watchUrl },
          message:
            "動画の概要欄にあるレシピのページから読み取りました（AI なし）。",
        });
      }
      // ③ コメント（投稿者本人のものを先に、次に上位5件）を1件ずつ、概要欄と同じ読み方で
      const comments = await youtubeComments(c.env, video.id, snip.channelId);
      for (const comment of comments) {
        const fromComment = readText(comment.text, title);
        if (!fromComment) continue;
        return c.json({
          kind: "video",
          found: true,
          draft: videoDraft(fromComment.recipe),
          // 他の人のコメントはアレンジや書き間違いのことがあるので、分けて知らせる
          message: comment.byOwner
            ? "動画のコメントから読み取りました（投稿者本人・AI なし）。"
            : "動画のコメントから読み取りました（投稿者以外の人のコメント・AI なし）。分量が合っているか確かめてから保存してください。",
          notice: fromComment.notice,
        });
      }
      // リンクは投稿者本人のコメントのものだけ（他の人のリンクは宣伝のことがある）
      // 締め切りは概要欄のリンクと共通。概要欄で使い切っていれば、ここは読まない
      const tried = new Set(descLinks);
      const ownerLinks = [
        ...new Set(
          comments
            .filter((cm) => cm.byOwner)
            .flatMap((cm) => pickRecipeUrls(cm.text, 3)),
        ),
      ]
        .filter((l) => !tried.has(l))
        .slice(0, 3);
      const fromOwnerLink = await readLinks(ownerLinks, deadline);
      if (fromOwnerLink) {
        return c.json({
          kind: "video",
          found: true,
          draft: { ...fromOwnerLink, videoUrl: video.watchUrl },
          message:
            "動画の投稿者のコメントにあるレシピのページから読み取りました（AI なし）。",
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
