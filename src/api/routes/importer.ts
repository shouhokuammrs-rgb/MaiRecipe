// URL から取り込み（保存はしない。画面で確認してから POST /api/recipes で保存する）。
// サイトは JSON-LD の Recipe から、無ければ「材料」「作り方」の見出しの後から読む。
// YouTube は概要欄の【材料】【作り方】から、無ければ概要欄に貼られたレシピページ、
// それも無ければ動画のコメント（投稿者本人のものを先に）から読む。AI は使わない。
import { Hono, type Context } from "hono";
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
import {
  aiReadSchema,
  findUnverified,
  unverifiedNotice,
} from "../../shared/ai-read";
import {
  AiBadOutput,
  AiQuotaExceeded,
  AiUnavailable,
  canWatchVideo,
  readRecipeWithAi,
  watchVideoWithAi,
} from "../ai";
import type { AiRecipe } from "../../shared/ai-read";
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

type RuleBody = {
  kind: "video" | "page";
  found: boolean;
  draft: {
    title: string;
    ingredients: unknown[];
    steps: unknown[];
    sourceUrl: string;
  } & Record<string, unknown>;
  message: string;
  notice?: string | null;
};

/**
 * 規則で読めなかった（材料か手順が 0）ときは、自動で AI（無料）に回す（DEC-017）。
 * AI でも読めなければ、規則の結果をそのまま返し、AI で読めなかった理由を添える
 */
async function finishWithAi(c: Context<AppEnv>, body: RuleBody, url: string) {
  const complete =
    body.found &&
    body.draft.ingredients.length > 0 &&
    body.draft.steps.length > 0;
  if (complete || (!c.env.AI && !canWatchVideo(c.env))) return c.json(body);
  const ai = await readWithAi(c, { url, title: body.draft.title });
  if (ai.ok) {
    const aiDraft = ai.body.draft as {
      ingredients: unknown[];
      steps: unknown[];
    };
    // 動画で、材料は概要欄から読めていて AI が手順を取れたときは、
    // 材料は概要欄（投稿者が書いた分量）を、手順は AI のものを使う
    if (
      body.kind === "video" &&
      body.draft.ingredients.length > 0 &&
      aiDraft.steps.length > 0
    )
      return c.json({
        ...ai.body,
        draft: {
          ...(ai.body.draft as Record<string, unknown>),
          title: body.draft.title,
          ingredients: body.draft.ingredients,
        },
        message: ai.body.watched
          ? "材料は概要欄から、手順は AI（無料）が動画を見て書き出しました。手順を確かめてから保存してください。"
          : "材料は概要欄から、手順は AI（無料）で読み取りました。手順を確かめてから保存してください。",
        notice: body.notice ?? null,
      });
    // 規則で一部は読めていて、AI の方が少なければ規則の方を残す
    const aiScore = aiDraft.ingredients.length + aiDraft.steps.length;
    const ruleScore = body.draft.ingredients.length + body.draft.steps.length;
    if (aiScore > ruleScore)
      return c.json({
        ...ai.body,
        message: body.found
          ? "規則では一部しか読めなかったので、AI（無料）で読み直しました。分量と手順を確かめてから保存してください。"
          : (ai.body.message as string),
      });
  }
  return c.json({
    ...body,
    message: ai.ok ? body.message : `${body.message}（${ai.error}）`,
  });
}

importer.post("/", async (c) => {
  const parsed = importSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(c, parsed.error);
  const url = parsed.data.url;
  const finish = (body: RuleBody) => finishWithAi(c, body, url);

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
        return finish({
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
        return finish({
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
        return finish({
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
        return finish({
          kind: "video",
          found: true,
          draft: { ...fromOwnerLink, videoUrl: video.watchUrl },
          message:
            "動画の投稿者のコメントにあるレシピのページから読み取りました（AI なし）。",
        });
      }
    }
    const title = snip?.title || (await youtubeTitle(video.watchUrl));
    return finish({
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
    return finish({
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
  return finish({
    kind: "page",
    found: true,
    draft: { ...recipe, sourceUrl: url },
    message:
      via === "jsonld"
        ? "ページの構造化データから読み取りました（AI なし）。"
        : "ページの「材料」「作り方」の見出しから読み取りました（AI なし）。内容を確かめてから保存してください。",
  });
});

/**
 * AI で読み取る（押した時だけ。DEC-012 / #36）。規則で読めなかったときに画面から呼ぶ。
 * 文章が来ればそれを、URL だけならページの本文・動画の概要欄とコメントを AI に渡す。
 * 保存はしない（画面で確かめてから POST /api/recipes）。元の文に無い材料は消さずに知らせる
 */
type AiInput = { url?: string; text?: string; title?: string };
type AiOutcome =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: 422 | 429 | 503; error: string };

/** AI（無料）で読み取った下書きを作る。ボタンからも、規則で読めなかったときの自動の予備からも使う */
async function readWithAi(
  c: Context<AppEnv>,
  input: AiInput,
): Promise<AiOutcome> {
  const { url, text } = input;
  let title = input.title ?? "";
  let source = text ?? "";
  let sourceUrl: string | null = url ? cleanSourceUrl(url) : null;
  const video = url ? parseVideoUrl(url) : null;

  if (!source && video) {
    const snip = await youtubeSnippet(c.env, video.id);
    if (!snip)
      return {
        ok: false,
        status: 422,
        error: "動画の説明を取れませんでした。概要欄を貼って試してください。",
      };
    title = title || snip.title;
    const comments = await youtubeComments(c.env, video.id, snip.channelId);
    source = [
      snip.description,
      ...comments.filter((cm) => cm.byOwner).map((cm) => cm.text),
    ]
      .filter(Boolean)
      .join("\n\n");
  } else if (!source && url) {
    const page = await scanPage(url, { collectText: true });
    title = title || page.title;
    source = page.bodyText;
    sourceUrl = cleanSourceUrl(page.url) ?? sourceUrl;
  }
  // 動画は、鍵があれば動画そのものを AI に見せる（手順が話すだけで書かれていない動画が多い）。
  // 失敗したら、文章（概要欄・投稿者のコメント）を読む AI に回す
  let watchError: AiOutcome | null = null;
  if (video && !text && canWatchVideo(c.env)) {
    try {
      const recipe = await watchVideoWithAi(
        c.env,
        video.watchUrl,
        title,
        source,
      );
      if (recipe.steps.length > 0 || source.trim().length < 20)
        return aiDraftBody(recipe, title, video.watchUrl, null, true);
    } catch (e) {
      watchError = aiError(e);
    }
  }
  if (source.trim().length < 20)
    return (
      watchError ?? {
        ok: false,
        status: 422,
        error: "読み取れる文章がありませんでした。",
      }
    );

  let recipe;
  try {
    recipe = await readRecipeWithAi(c.env, source, title);
  } catch (e) {
    return aiError(e);
  }
  return aiDraftBody(
    recipe,
    title,
    video?.watchUrl ?? sourceUrl ?? url ?? "",
    unverifiedNotice(findUnverified(recipe.ingredients, source)),
    false,
    video ? "video" : "page",
  );
}

/** AI の失敗を、画面に出す日本語の理由にする */
function aiError(e: unknown): AiOutcome {
  if (e instanceof AiQuotaExceeded)
    return {
      ok: false,
      status: 429,
      error: "今日の AI の無料分を使い切りました。明日また使えます。",
    };
  if (e instanceof AiUnavailable)
    return {
      ok: false,
      status: 503,
      error: "今は AI を使えません。少し待ってからもう一度試してください。",
    };
  if (e instanceof AiBadOutput)
    return {
      ok: false,
      status: 422,
      error: "AI でもレシピを読み取れませんでした。手で入れてください。",
    };
  throw e;
}

/** AI の結果を、画面で確かめる下書きにする（保存はしない） */
function aiDraftBody(
  recipe: AiRecipe,
  title: string,
  sourceUrl: string,
  notice: string | null,
  watched: boolean,
  kind: "video" | "page" = "video",
): AiOutcome {
  const finalTitle = recipe.title || title || "AI で読み取ったレシピ";
  const hints = [finalTitle, ...recipe.ingredients.map((i) => i.name)];
  const isVideo = kind === "video";
  return {
    ok: true,
    body: {
      kind,
      found: true,
      watched,
      draft: {
        title: finalTitle.slice(0, LIMITS.titleMax),
        ingredients: recipe.ingredients,
        steps: recipe.steps,
        timeLabel: recipe.timeLabel,
        category: guessCategory(hints),
        genre: guessGenre(hints),
        sourceUrl,
        videoUrl: isVideo ? sourceUrl : null,
      },
      message: watched
        ? "AI（無料）が動画を見て読み取りました。AI は聞き間違えることがあるので、分量と手順を確かめてから保存してください。"
        : "AI（無料）で読み取りました。AI は間違えることがあるので、分量と手順を確かめてから保存してください。",
      notice,
    },
  };
}

importer.post("/ai", async (c) => {
  const parsed = aiReadSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(c, parsed.error);
  const r = await readWithAi(c, parsed.data);
  return r.ok ? c.json(r.body) : c.json({ error: r.error }, r.status);
});
