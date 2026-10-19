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
  opts: { jsonLdOnly?: boolean } = {},
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
    if (opts.jsonLdOnly && via !== "jsonld") continue;
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

/** AI が1つでも使える設定か（鍵・バインディングがあるか） */
const hasAnyAi = (c: Context<AppEnv>) =>
  Boolean(c.env.AI) || canWatchVideo(c.env);

/** AI が使えなかったとき、規則の結果に理由を添える */
const withReason = (body: RuleBody, reason: string | null) =>
  reason ? { ...body, message: `${body.message}（${reason}）` } : body;

/**
 * URL から取り込む（DEC-019：正確さを優先して一発で）。
 * ① 作者が機械向けに書いたレシピ（構造化データ）があればそれ（速くて正確）
 * ② 無ければ AI（動画は動画そのものを見る・ページは本文を読む）
 * ③ AI が使えないときだけ、規則（見出し・概要欄の形）で読む
 */
importer.post("/", async (c) => {
  const parsed = importSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(c, parsed.error);
  const url = parsed.data.url;

  const video = parseVideoUrl(url);
  if (video) {
    const snip = await youtubeSnippet(c.env, video.id);
    const title = snip?.title || (await youtubeTitle(video.watchUrl)) || "";
    // AI が無い設定では、今までどおり規則だけ（コメントは要るときだけ取りに行く）
    if (!hasAnyAi(c)) return c.json(await videoByRules(c, video, snip, title));
    const comments = snip
      ? await youtubeComments(c.env, video.id, snip.channelId)
      : [];
    const ownerTexts = comments.filter((cm) => cm.byOwner).map((cm) => cm.text);

    // ① 投稿者が概要欄・自分のコメントに貼ったレシピページの構造化データ
    const deadline = Date.now() + LINKS_DEADLINE_MS;
    const links = [
      ...new Set([
        ...pickRecipeUrls(snip?.description ?? "", 3),
        ...ownerTexts.flatMap((t) => pickRecipeUrls(t, 3)),
      ]),
    ].slice(0, 4);
    const fromLink = await readLinks(links, deadline, { jsonLdOnly: true });
    if (fromLink)
      return c.json({
        kind: "video",
        found: true,
        draft: { ...fromLink, videoUrl: video.watchUrl },
        message:
          "動画の投稿者が載せたレシピのページから読み取りました（AI なし）。",
      });

    // ② AI（動画を見る → だめなら概要欄と投稿者のコメントを読む）
    let reason: string | null = null;
    if (hasAnyAi(c)) {
      const source = [snip?.description ?? "", ...ownerTexts]
        .filter(Boolean)
        .join("\n\n");
      const ai = await readWithAi(c, { url }, { source, title });
      if (ai.ok) return c.json(ai.body);
      // 「AI でも読めなかった」は規則の結果で十分。上限・不通のときだけ理由を添える
      reason = ai.status === 422 ? null : ai.error;
    }

    // ③ 規則
    return c.json(
      withReason(await videoByRules(c, video, snip, title, comments), reason),
    );
  }

  const page = await scanPage(url, { collectText: hasAnyAi(c) });
  const { recipe, via } = readPage(page);
  // ① 構造化データ
  if (recipe && via === "jsonld")
    return c.json({
      kind: "page",
      found: true,
      draft: { ...recipe, sourceUrl: url },
      message: "ページの構造化データから読み取りました（AI なし）。",
    });

  // ② AI（ページの本文）
  let reason: string | null = null;
  if (c.env.AI) {
    const ai = await readWithAi(
      c,
      { url },
      { source: page.bodyText, title: page.title },
    );
    if (ai.ok) return c.json(ai.body);
    reason = ai.status === 422 ? null : ai.error;
  }

  // ③ 規則（見出しの後から）
  if (!recipe)
    return c.json(
      withReason(
        {
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
        },
        reason,
      ),
    );
  return c.json(
    withReason(
      {
        kind: "page",
        found: true,
        draft: { ...recipe, sourceUrl: url },
        message:
          "ページの「材料」「作り方」の見出しから読み取りました（AI なし）。内容を確かめてから保存してください。",
      },
      reason,
    ),
  );
});

/** AI が使えないときの、動画の規則での読み方（概要欄 → 貼られたページ → コメント） */
async function videoByRules(
  c: Context<AppEnv>,
  video: NonNullable<ReturnType<typeof parseVideoUrl>>,
  snip: Awaited<ReturnType<typeof youtubeSnippet>>,
  rawTitle: string,
  /** 既に取ってあればそれを使う。無ければ要るときだけ取りに行く */
  fetched?: Awaited<ReturnType<typeof youtubeComments>>,
): Promise<RuleBody> {
  const title = rawTitle || "動画のレシピ";
  const videoDraft = (recipe: ImportedRecipe) => ({
    ...recipe,
    title,
    sourceUrl: video.watchUrl,
    videoUrl: video.watchUrl,
  });
  if (snip) {
    const fromDesc = readText(snip.description, title);
    if (fromDesc)
      return {
        kind: "video",
        found: true,
        draft: videoDraft(fromDesc.recipe),
        message: "動画の概要欄から読み取りました（AI なし）。",
        notice: fromDesc.notice,
      };
    const deadline = Date.now() + LINKS_DEADLINE_MS;
    const descLinks = pickRecipeUrls(snip.description, 3);
    const fromLink = await readLinks(descLinks, deadline);
    if (fromLink)
      return {
        kind: "video",
        found: true,
        draft: { ...fromLink, videoUrl: video.watchUrl },
        message:
          "動画の概要欄にあるレシピのページから読み取りました（AI なし）。",
      };
    const comments =
      fetched ?? (await youtubeComments(c.env, video.id, snip.channelId));
    for (const comment of comments) {
      const fromComment = readText(comment.text, title);
      if (!fromComment) continue;
      return {
        kind: "video",
        found: true,
        draft: videoDraft(fromComment.recipe),
        // 他の人のコメントはアレンジや書き間違いのことがあるので、分けて知らせる
        message: comment.byOwner
          ? "動画のコメントから読み取りました（投稿者本人・AI なし）。"
          : "動画のコメントから読み取りました（投稿者以外の人のコメント・AI なし）。分量が合っているか確かめてから保存してください。",
        notice: fromComment.notice,
      };
    }
    // リンクは投稿者本人のコメントのものだけ（他の人のリンクは宣伝のことがある）
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
    if (fromOwnerLink)
      return {
        kind: "video",
        found: true,
        draft: { ...fromOwnerLink, videoUrl: video.watchUrl },
        message:
          "動画の投稿者のコメントにあるレシピのページから読み取りました（AI なし）。",
      };
  }
  return {
    kind: "video",
    found: false,
    draft: {
      title,
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
  };
}

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
  /** 取り込みで既に取ってきた文章（もう一度取りに行かない） */
  pre?: { source: string; title: string },
): Promise<AiOutcome> {
  const { url, text } = input;
  let title = input.title ?? pre?.title ?? "";
  let source = text ?? pre?.source ?? "";
  const prefetched = Boolean(pre);
  let sourceUrl: string | null = url ? cleanSourceUrl(url) : null;
  const video = url ? parseVideoUrl(url) : null;

  if (!source && !prefetched && video) {
    const snip = await youtubeSnippet(c.env, video.id);
    // 説明が取れなくても、動画を見る AI は URL だけで読める
    if (!snip && !canWatchVideo(c.env))
      return {
        ok: false,
        status: 422,
        error: "動画の説明を取れませんでした。概要欄を貼って試してください。",
      };
    if (snip) {
      title = title || snip.title;
      const comments = await youtubeComments(c.env, video.id, snip.channelId);
      source = [
        snip.description,
        ...comments.filter((cm) => cm.byOwner).map((cm) => cm.text),
      ]
        .filter(Boolean)
        .join("\n\n");
    }
  } else if (!source && !prefetched && url) {
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
  if (source.trim().length < 20 || (watchError && !c.env.AI))
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
      error:
        "AI の無料分の上限に当たりました。少し待ってから、それでも駄目なら明日また試してください。",
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
