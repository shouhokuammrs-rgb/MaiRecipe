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
import { cleanImageUrl, jsonLdImage } from "../../shared/cover";
import { addGroupsFromPage } from "../../shared/groups";
import { tipsFromText } from "../../shared/tips";
import {
  servingsFromText,
  servingsNearIngredients,
} from "../../shared/servings";
import {
  aiReadSchema,
  findUnverified,
  unverifiedNotice,
} from "../../shared/ai-read";
import {
  AiBadOutput,
  AiDailyStop,
  AiQuotaExceeded,
  AiUnavailable,
  GeminiRateLimited,
  GeminiTemporary,
  PhotoInvalid,
  canWatchVideo,
  readPhotoWithAi,
  readRecipeWithAi,
  watchVideoWithAi,
} from "../ai";
import type { AiRecipe } from "../../shared/ai-read";
import { importSchema } from "../../shared/recipe";
import type { AppBindings, AppEnv } from "../app-env";
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
  // 構造化データの材料に (A) の印が無くても、ページの一覧から足す（クラシルなど）
  if (fromLd)
    return {
      recipe: {
        ...fromLd,
        ingredients: addGroupsFromPage(
          fromLd.ingredients,
          page.sections.ingredients,
        ),
        // 構造化データに人数が無ければ、材料の見出し（「材料（2人分）」）から
        servings: fromLd.servings ?? page.servings,
        tips: tipsFromText(page.tipsText, fromLd.steps.length),
      },
      via: "jsonld",
    };
  return {
    recipe: recipeFromSections({
      title: page.title,
      ...page.sections,
      servings: page.servings,
      tips: tipsFromText(page.tipsText, page.sections.steps.length),
    }),
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
  const recipe = recipeFromSections({
    title,
    ...parsed,
    servings: servingsFromText(text),
  });
  if (!recipe) return null;
  return { recipe, notice: overlapNotice(parsed.overlaps) };
}

type LinkHit = ImportedRecipe & {
  sourceUrl: string;
  via: "jsonld" | "sections";
};

/** 貼られたリンクを上から順に読み、最初に取れたものを出典つきで返す（締め切りまで） */
async function readLinks(
  links: string[],
  deadline: number,
): Promise<(ImportedRecipe & { sourceUrl: string }) | null> {
  const hits = await scanLinks(links, deadline, { stopAtFirst: true });
  if (!hits[0]) return null;
  const { via: _via, ...r } = hits[0];
  return r;
}

/**
 * リンクを上から順に読み、読めたものを全部返す（締め切りまで）。
 * stopAtFirst なら最初の1件で、jsonLdFirst なら構造化データが取れた時点でやめる
 */
async function scanLinks(
  links: string[],
  deadline: number,
  opts: { stopAtFirst?: boolean; stopAtJsonLd?: boolean } = {},
): Promise<LinkHit[]> {
  const hits: LinkHit[] = [];
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
    hits.push({ ...r, sourceUrl, via });
    if (opts.stopAtFirst || (opts.stopAtJsonLd && via === "jsonld")) break;
  }
  return hits;
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
const hasAnyAi = (env: AppBindings) => Boolean(env.AI) || canWatchVideo(env);

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
  return c.json(await importFromUrl(c.env, parsed.data.url));
});

export type ImportBody = RuleBody | Record<string, unknown>;

/**
 * URL から取り込む本体。画面からの取り込み（裏の読み取り DEC-022）と、すぐ返す POST /api/import の両方で使う。
 * セッションに依存しない（env だけ）。保存はしない
 */
export async function importFromUrl(
  env: AppBindings,
  url: string,
  /**
   * 裏の読み取りでまだやり直せるとき true。動画を見る AI が一時的に失敗したら（Google 側の混雑など）、
   * 文章の AI や規則に落とさず ImportRetryLater を投げる（呼ぶ側が少し待ってやり直す）
   */
  opts: { retryLater?: boolean } = {},
): Promise<ImportBody> {
  const video = parseVideoUrl(url);
  if (video) {
    const snip = await youtubeSnippet(env, video.id);
    const title = snip?.title || (await youtubeTitle(video.watchUrl)) || "";
    // AI が無い設定では、今までどおり規則だけ（コメントは要るときだけ取りに行く）
    if (!hasAnyAi(env)) return await videoByRules(env, video, snip, title);
    const comments = snip
      ? await youtubeComments(env, video.id, snip.channelId)
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
    const linkHits = await scanLinks(links, deadline, { stopAtJsonLd: true });
    const ld = linkHits.find((h) => h.via === "jsonld");
    if (ld) {
      const { via: _via, ...fromLink } = ld;
      return {
        kind: "video",
        found: true,
        draft: { ...fromLink, videoUrl: video.watchUrl },
        message:
          "動画の投稿者が載せたレシピのページから読み取りました（AI なし）。",
      };
    }

    // ② AI（動画を見る → だめなら概要欄と投稿者のコメントを読む）
    const source = [snip?.description ?? "", ...ownerTexts]
      .filter(Boolean)
      .join("\n\n");
    const ai = await readWithAi(env, { url }, { source, title }, opts);
    if (ai.ok) return ai.body;
    // 「AI でも読めなかった」は規則の結果で十分。上限・不通のときだけ理由を添える
    const reason = ai.status === 422 ? null : ai.error;

    // ③ 規則
    return withReason(
      await videoByRules(env, video, snip, title, { comments, linkHits }),
      reason,
    );
  }

  const page = await scanPage(url, { collectText: Boolean(env.AI) });
  // 表紙は、ページの共有用の画像を元の場所から表示する（保存しない。DEC-023）
  const cover =
    cleanImageUrl(page.image, page.url) ??
    jsonLdImage(page.jsonLd, page.url) ??
    "";
  const withCover = (b: ImportBody) => ({
    ...b,
    draft: { ...(b as RuleBody).draft, coverUrl: cover },
  });
  const { recipe, via } = readPage(page);
  // ① 構造化データ
  if (recipe && via === "jsonld")
    return withCover({
      kind: "page",
      found: true,
      draft: { ...recipe, sourceUrl: url },
      message: "ページの構造化データから読み取りました（AI なし）。",
    });

  // ② AI（ページの本文）
  let reason: string | null = null;
  if (env.AI) {
    const ai = await readWithAi(
      env,
      { url },
      {
        source: page.bodyText,
        title: page.title,
        sourceUrl: cleanSourceUrl(page.url) ?? undefined,
      },
    );
    if (ai.ok) return withCover(ai.body);
    reason = ai.status === 422 ? null : ai.error;
  }

  // ③ 規則（見出しの後から）
  if (!recipe)
    return withCover(
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
  return withCover(
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
}

/** AI が使えないときの、動画の規則での読み方（概要欄 → 貼られたページ → コメント） */
async function videoByRules(
  env: AppBindings,
  video: NonNullable<ReturnType<typeof parseVideoUrl>>,
  snip: Awaited<ReturnType<typeof youtubeSnippet>>,
  rawTitle: string,
  /** AI の前に取ってあればそれを使う（もう一度取りに行かない）。無ければ要るときだけ取りに行く */
  fetched?: {
    comments: Awaited<ReturnType<typeof youtubeComments>>;
    linkHits: LinkHit[];
  },
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
    // 既に読んだリンクは、材料と手順の両方が取れたもの（readLinks と同じ基準）を使う
    const fromLink = fetched
      ? (fetched.linkHits.map(({ via: _via, ...r }) => r)[0] ?? null)
      : await readLinks(descLinks, deadline);
    if (fromLink)
      return {
        kind: "video",
        found: true,
        draft: { ...fromLink, videoUrl: video.watchUrl },
        message:
          "動画の概要欄にあるレシピのページから読み取りました（AI なし）。",
      };
    const comments =
      fetched?.comments ??
      (await youtubeComments(env, video.id, snip.channelId));
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
    // AI の前に投稿者のリンクも読んであるので、ここでは読み直さない
    const fromOwnerLink = fetched
      ? null
      : await readLinks(ownerLinks, deadline);
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
  env: AppBindings,
  input: AiInput,
  /** 取り込みで既に取ってきた文章（もう一度取りに行かない） */
  pre?: { source: string; title: string; sourceUrl?: string },
  opts: { retryLater?: boolean } = {},
): Promise<AiOutcome> {
  const { url, text } = input;
  let title = input.title ?? pre?.title ?? "";
  let source = text ?? pre?.source ?? "";
  const prefetched = Boolean(pre);
  let sourceUrl: string | null =
    pre?.sourceUrl ?? (url ? cleanSourceUrl(url) : null);
  const video = url ? parseVideoUrl(url) : null;

  if (!source && !prefetched && video) {
    const snip = await youtubeSnippet(env, video.id);
    // 説明が取れなくても、動画を見る AI は URL だけで読める
    if (!snip && !canWatchVideo(env))
      return {
        ok: false,
        status: 422,
        error: "動画の説明を取れませんでした。概要欄を貼って試してください。",
      };
    if (snip) {
      title = title || snip.title;
      const comments = await youtubeComments(env, video.id, snip.channelId);
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
  // 動画を見る AI がだめだった理由（文章を読む AI に回したとき、画面で知らせる）
  let watchNote: string | null = null;
  if (video && !text && canWatchVideo(env)) {
    try {
      const watched = await watchVideoWithAi(
        env,
        video.watchUrl,
        title,
        source,
        opts.retryLater,
      );
      const recipe = {
        ...watched,
        // 人数は概要欄の材料の見出し → AI → 概要欄のどこか、の順
        servings:
          servingsNearIngredients(source) ??
          watched.servings ??
          servingsFromText(source),
      };
      if (recipe.steps.length > 0 || source.trim().length < 20)
        return aiDraftBody(recipe, title, video.watchUrl, null, true);
      watchNote = "動画を見ても手順が見つかりませんでした";
    } catch (e) {
      if (opts.retryLater && isTemporary(e))
        throw new ImportRetryLater(
          e instanceof Error ? e.message : "一時的に読めませんでした",
        );
      watchError = aiError(e);
      watchNote =
        e instanceof Error && e.message ? e.message : "動画を読めませんでした";
    }
  }
  if (source.trim().length < 20 || (watchError && !env.AI))
    return (
      watchError ?? {
        ok: false,
        status: 422,
        error: "読み取れる文章がありませんでした。",
      }
    );

  let recipe: AiRecipe;
  try {
    recipe = await readRecipeWithAi(env, source, title);
  } catch (e) {
    return aiError(e);
  }
  // 人数は材料の見出しに書いてあればそちらを優先（AI の読み違いを避ける）
  recipe = {
    ...recipe,
    servings:
      servingsNearIngredients(source) ??
      recipe.servings ??
      servingsFromText(source),
  };
  const notices = [
    unverifiedNotice(findUnverified(recipe.ingredients, source)),
    watchNote && !recipe.steps.length
      ? `手順は動画の中で話しているだけのようです。動画を見る AI では読めませんでした（${watchNote}）。手順は手で入れてください。`
      : null,
  ].filter(Boolean);
  return aiDraftBody(
    recipe,
    title,
    video?.watchUrl ?? sourceUrl ?? url ?? "",
    notices.length ? notices.join(" ") : null,
    false,
    video ? "video" : "page",
  );
}

/** 少し待てば読めそうな失敗（裏の読み取りなら、待ってやり直す） */
export class ImportRetryLater extends Error {}

/** Google 側の一時的な失敗（混雑・5xx・1分あたりの上限）。今日の分を使い切ったときは違う */
function isTemporary(e: unknown): boolean {
  return e instanceof GeminiTemporary || e instanceof GeminiRateLimited;
}

/** AI の失敗を、画面に出す日本語の理由にする */
function aiError(e: unknown): AiOutcome {
  if (e instanceof AiDailyStop)
    return {
      ok: false,
      status: 429,
      error:
        "今日の AI の無料分の9割を使ったので、AI を止めています。明日また使えます（使った量は設定で見られます）。",
    };
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
        servings: recipe.servings,
        tips: recipe.tips,
        stepTimes: recipe.stepTimes,
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
  const r = await readWithAi(c.env, parsed.data);
  return r.ok ? c.json(r.body) : c.json({ error: r.error }, r.status);
});

/** 写真の base64 の上限（画面で長辺1600px・1MB 以下に縮めてから送る。base64 で約1.37倍） */
const PHOTO_BASE64_MAX = 1_400_000;

/**
 * 料理本・レシピカードの写真から読む（#15）。写真は画面で縮めた JPEG を base64 の文字で受け取り、
 * 中身を触らずに AI に渡す（DEC-008）。写真は保存しない。結果は下書き（保存は画面で確かめてから）
 */
importer.post("/photo", async (c) => {
  // 読む前に大きさを確かめる（大きな本文をメモリに読み込まない）
  const length = Number(c.req.header("content-length"));
  if (!Number.isInteger(length) || length < 4)
    return c.json({ error: "写真を受け取れませんでした" }, 411);
  if (length > PHOTO_BASE64_MAX)
    return c.json({ error: "写真が大きすぎます。撮り直してください" }, 413);
  const body = c.req.raw.body;
  if (!body) return c.json({ error: "写真を受け取れませんでした" }, 411);
  if (!canWatchVideo(c.env))
    return c.json({ error: "今は写真を読む AI を使えない設定です。" }, 503);
  let recipe: AiRecipe;
  try {
    recipe = await readPhotoWithAi(c.env, { body, length });
  } catch (e) {
    if (e instanceof PhotoInvalid)
      return c.json({ error: "JPEG の写真だけ読めます" }, 400);
    const r = aiError(e);
    if (r.ok) throw e;
    return c.json(
      {
        error:
          r.status === 422
            ? "写真からレシピを読み取れませんでした。文字がはっきり写るように撮り直すか、手で入れてください。"
            : r.error,
      },
      r.status,
    );
  }
  const title = recipe.title || "写真から読んだレシピ";
  const hints = [title, ...recipe.ingredients.map((i) => i.name)];
  return c.json({
    kind: "photo",
    found: recipe.ingredients.length > 0 || recipe.steps.length > 0,
    draft: {
      title: title.slice(0, LIMITS.titleMax),
      ingredients: recipe.ingredients,
      steps: recipe.steps,
      timeLabel: recipe.timeLabel,
      servings: recipe.servings,
      tips: recipe.tips,
      category: guessCategory(hints),
      genre: guessGenre(hints),
      sourceUrl: null,
      videoUrl: null,
    },
    message:
      recipe.ingredients.length || recipe.steps.length
        ? "AI（無料）が写真を読み取りました。読み間違えることがあるので、分量と手順を確かめてから保存してください。"
        : "写真から材料と作り方を見つけられませんでした。文字がはっきり写るように撮り直すか、手で入れてください。",
  });
});
