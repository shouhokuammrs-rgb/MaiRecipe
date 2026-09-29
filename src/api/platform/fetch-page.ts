// 取り込み用にページを取りに行く（Cloudflare の fetch と HTMLRewriter を使う部品）。
// 無料プランの CPU 10ms を守るため、HTMLRewriter で流し読みし、JSON-LD の Recipe が見つかったら
// そこで読むのをやめる。予備として「材料」「作り方」の見出しの後の dt/dd・li・th/td の文字も拾う
// （件数と文字数に上限あり。見出しの判定と整形は src/shared/importer.ts）。
import {
  classifyHeading,
  isNoteHeading,
  type HeadingKind,
  type RawIngredient,
} from "../../shared/importer";

const MAX_BYTES = 1_500_000;
const MAX_JSONLD_CHARS = 300_000;
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 5;
const MAX_HEADING_CHARS = 40;
const MAX_ITEM_CHARS = 600;
const MAX_INGREDIENTS = 60;
const MAX_STEPS = 40;

export class FetchPageError extends Error {}

/** 社内・ローカル向けのアドレスには取りに行かない（リダイレクト先も毎回確かめる） */
export function assertPublicHttpUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new FetchPageError("URL の形が正しくありません");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:")
    throw new FetchPageError("http(s) の URL だけ使えます");
  if (u.username || u.password)
    throw new FetchPageError("この URL は取り込めません");
  if (u.port && u.port !== "80" && u.port !== "443")
    throw new FetchPageError("この URL は取り込めません");
  const h = u.hostname.toLowerCase();
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h.endsWith(".nip.io") ||
    h.endsWith(".sslip.io") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(h) ||
    /^\d+$/.test(h) ||
    h.includes(":") ||
    h.startsWith("[") ||
    !h.includes(".")
  ) {
    throw new FetchPageError("この URL は取り込めません");
  }
  return u;
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export type ScanOptions = {
  /** 行き先（転送先も毎回）のホストを読んでよいか。false ならそこで失敗にする */
  allowHost?: (host: string) => boolean;
  timeoutMs?: number;
  maxRedirects?: number;
  maxBytes?: number;
};

/** リダイレクトは自分でたどり、行き先ごとに assertPublicHttpUrl（と allowHost）を通す */
async function fetchPublic(
  url: string,
  opts: ScanOptions,
): Promise<{ res: Response; url: string }> {
  const check = (raw: string) => {
    const u = assertPublicHttpUrl(raw);
    if (opts.allowHost && !opts.allowHost(u.hostname))
      throw new FetchPageError("この URL は取り込めません");
    return u;
  };
  let current = check(url);
  for (let i = 0; i <= (opts.maxRedirects ?? MAX_REDIRECTS); i++) {
    let res: Response;
    try {
      res = await fetchWithTimeout(
        current.toString(),
        {
          redirect: "manual",
          headers: {
            "user-agent":
              "Mozilla/5.0 (compatible; MaiRecipe/0.1; +https://github.com/shouhokuammrs-rgb/MaiRecipe)",
            accept: "text/html,application/xhtml+xml",
            "accept-language": "ja,en;q=0.8",
          },
        },
        opts.timeoutMs ?? TIMEOUT_MS,
      );
    } catch {
      throw new FetchPageError("ページを取得できませんでした");
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await res.body?.cancel();
      if (!loc) throw new FetchPageError("ページを取得できませんでした");
      current = check(new URL(loc, current).toString());
      continue;
    }
    return { res, url: current.toString() };
  }
  throw new FetchPageError("転送が多すぎて取得できませんでした");
}

export type PageScan = {
  jsonLd: string[];
  title: string;
  /** 見出しの後から拾った材料・手順（JSON-LD が無いときの予備） */
  sections: { ingredients: RawIngredient[]; steps: string[] };
  /** 転送をたどった後の URL */
  url: string;
};

const HEADINGS =
  "h1, h2, h3, h4, h5, h6, [class*=title], [class*=Title], [class*=head], [class*=Head]";
/** class に head/title を含んでも、ページの枠（ヘッダー・メニュー・一覧）は見出しとして扱わない */
const NOT_HEADING_TAGS = new Set([
  "html",
  "body",
  "header",
  "nav",
  "footer",
  "main",
  "section",
  "article",
  "aside",
  "form",
  "ul",
  "ol",
  "dl",
  "table",
  "thead",
  "tbody",
  "tr",
  "li",
  "a",
  "button",
  "input",
  "script",
  "style",
  // 閉じタグの無い要素（onEndTag が使えない）
  "img",
  "br",
  "hr",
  "meta",
  "link",
  "source",
  "area",
  "col",
  "embed",
  "wbr",
  "track",
  "base",
]);

export async function scanPage(
  url: string,
  opts: ScanOptions = {},
): Promise<PageScan> {
  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  const { res, url: finalUrl } = await fetchPublic(url, opts);
  if (!res.ok) {
    await res.body?.cancel();
    throw new FetchPageError(`ページを取得できませんでした（${res.status}）`);
  }
  const type = res.headers.get("content-type") ?? "";
  if (type && !/html|xml/i.test(type)) {
    await res.body?.cancel();
    throw new FetchPageError("レシピのページではないようです");
  }
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > maxBytes) {
    await res.body?.cancel();
    throw new FetchPageError("ページが大きすぎます");
  }

  const jsonLd: string[] = [];
  let jsonChars = 0;
  let current: string | null = null;
  let truncated = false;
  let foundRecipe = false;
  let title = "";
  let ogTitle = "";
  let inTitle = false;

  // ---- 予備の読み取り ----
  // 「材料」「作り方」の見出しが閉じたら、その後の最初の一覧（ol/ul/dl/table）の項目を拾う。
  // 一覧が閉じたら一旦止め、それより深い h タグの小見出し（タレ など）が来たら同じ種類で再開する。
  // header/nav/footer/aside の中と、項目の中で閉じた見出し（li の中の番号など）は見出しとして扱わない。
  const ingredients: RawIngredient[] = [];
  const steps: string[] = [];
  let mode: HeadingKind = "other";
  let modeLevel: number | null = null;
  /** 一覧が閉じて一旦止めたときの状態。list は閉じた一覧の tag と class（同じ形の一覧が続けば再開する） */
  let paused: {
    mode: HeadingKind;
    level: number | null;
    list: string;
  } | null = null;
  let listOpen = false;
  let chromeDepth = 0;
  const openHeadings: { text: string }[] = [];
  let item: { tag: string; text: string } | null = null;
  let itemDepth = 0;
  /** 項目の中で開いている一覧の数（入れ子の li と、閉じタグを省いた li を見分ける） */
  let innerLists = 0;
  let pendingName: string | null = null;
  let rowCells: { tag: string; text: string }[] = [];
  const full = () =>
    ingredients.length >= MAX_INGREDIENTS && steps.length >= MAX_STEPS;

  const startMode = (kind: HeadingKind, level: number | null) => {
    // <div class="c-heading"><h2>材料</h2></div>：外側の class の枠で h2 の level を消さない
    if (level === null && (mode === kind || paused?.mode === kind)) return;
    mode = kind;
    modeLevel = level;
    paused = null;
    pendingName = null;
  };

  const onHeadingEnd = (raw: string, level: number | null) => {
    if (chromeDepth > 0) return;
    if (itemDepth > 0) {
      // li の中の <span class="step-head">1</span> のような番号は、項目の文字から外す
      const num = raw.trim();
      if (
        item &&
        /^\d{1,2}$/.test(num) &&
        item.text.trimStart().startsWith(num)
      )
        item.text = item.text.trimStart().slice(num.length);
      return;
    }
    const kind = classifyHeading(raw);
    if (kind === "ignore") return;
    if (kind !== "other") return startMode(kind, level);
    // class で当たっただけの要素（h タグでない）では止めない
    if (level === null) return;
    // 「ポイント」「コツ」などの欄に入ったら、深さに関係なくそこで止める（説明文を取り込まない。DEC-011）
    if (isNoteHeading(raw)) {
      mode = "other";
      paused = null;
      return;
    }
    if (mode !== "other") {
      if (modeLevel !== null && level > modeLevel) return; // 材料の中の小見出し
      mode = "other";
      paused = null;
      return;
    }
    if (
      paused &&
      paused.mode === "ingredients" &&
      paused.level !== null &&
      level > paused.level
    ) {
      // 材料の一覧の後の小見出し（タレ など）：材料として再開する。手順は再開しない
      mode = paused.mode;
      modeLevel = paused.level;
      return;
    }
    paused = null;
  };

  const onItemEnd = (tag: string, raw: string) => {
    const t = raw.trim();
    if (mode === "ingredients" && ingredients.length < MAX_INGREDIENTS) {
      if (tag === "dt") {
        if (pendingName) ingredients.push({ name: pendingName, amount: "" });
        pendingName = t;
      } else if (tag === "dd") {
        ingredients.push(
          pendingName !== null
            ? { name: pendingName, amount: t }
            : { name: t, amount: "" },
        );
        pendingName = null;
      } else if (tag === "li") ingredients.push({ name: t, amount: "" });
      else rowCells.push({ tag, text: t });
    } else if (mode === "steps" && steps.length < MAX_STEPS) {
      if (tag === "li" || tag === "dd" || tag === "td") steps.push(t);
    }
  };

  const sameRow = (a: string, b: string) =>
    a === b ||
    ((a === "dt" || a === "dd") && (b === "dt" || b === "dd")) ||
    ((a === "th" || a === "td") && (b === "th" || b === "td"));

  /** onEndTag を付けられない要素（閉じタグの無い要素）では false */
  const onEnd = (el: Element, fn: () => void): boolean => {
    try {
      el.onEndTag(fn);
      return true;
    } catch {
      return false;
    }
  };

  const rewriter = new HTMLRewriter()
    .on('script[type="application/ld+json"]', {
      element(el) {
        current = "";
        truncated = false;
        onEnd(el, () => {
          // 上限で途中まで切れたものは JSON として読めないので捨てる
          if (current !== null && !truncated) {
            jsonLd.push(current);
            if (/"Recipe"/.test(current)) foundRecipe = true;
          }
          current = null;
        });
      },
      text(t) {
        if (current === null) return;
        if (jsonChars + t.text.length > MAX_JSONLD_CHARS) {
          truncated = true;
          return;
        }
        jsonChars += t.text.length;
        current += t.text;
      },
    })
    .on('meta[property="og:title"]', {
      element(el) {
        ogTitle = el.getAttribute("content") ?? "";
      },
    })
    .on("title", {
      element(el) {
        inTitle = true;
        onEnd(el, () => {
          inTitle = false;
        });
      },
      text(t) {
        if (inTitle && title.length < 200) title += t.text;
      },
    })
    // ページの枠（body 直下のヘッダー・フッターとメニュー）だけ読まない。section の中の header や aside は読む
    .on("body > header, body > footer, nav", {
      element(el) {
        chromeDepth++;
        if (
          !onEnd(el, () => {
            chromeDepth--;
          })
        )
          chromeDepth--;
      },
    })
    .on(HEADINGS, {
      element(el) {
        const tag = el.tagName.toLowerCase();
        if (NOT_HEADING_TAGS.has(tag)) return;
        const level = /^h[1-6]$/.test(tag) ? Number(tag[1]) : null;
        const h = { text: "" };
        const ok = onEnd(el, () => {
          const i = openHeadings.lastIndexOf(h);
          if (i >= 0) openHeadings.splice(i, 1);
          onHeadingEnd(h.text, level);
        });
        if (ok) openHeadings.push(h);
      },
    })
    .on("ol, ul, dl, table", {
      element(el) {
        if (itemDepth > 0) {
          innerLists++;
          if (
            !onEnd(el, () => {
              innerLists = Math.max(0, innerLists - 1);
            })
          )
            innerLists--;
          return;
        }
        if (listOpen || chromeDepth > 0) return;
        const shape = `${el.tagName.toLowerCase()}.${el.getAttribute("class") ?? ""}`;
        // 1件ずつ別の一覧（<dl class="ing"> が並ぶ）：止めた直後に同じ形の一覧が来たら再開する
        if (mode === "other" && paused && paused.list === shape) {
          mode = paused.mode;
          modeLevel = paused.level;
        }
        if (mode === "other") return;
        const listMode = mode;
        if (
          !onEnd(el, () => {
            listOpen = false;
            // 閉じタグを省いた最後の項目が残っていれば、ここで確定させる
            if (item) {
              onItemEnd(item.tag, item.text);
              item = null;
              itemDepth = 0;
            }
            if (mode === listMode) {
              paused = { mode, level: modeLevel, list: shape };
              mode = "other";
            }
          })
        )
          return;
        listOpen = true;
      },
    })
    .on("li, dt, dd, th, td", {
      element(el) {
        if (mode === "other" || chromeDepth > 0 || full()) return;
        const tag = el.tagName.toLowerCase();
        // 閉じタグを省いた <li>a<li>b / <dt>名<dd>量：前の項目がまだ開いていれば、ここで確定させる
        if (item && innerLists === 0 && sameRow(item.tag, tag)) {
          onItemEnd(item.tag, item.text);
          item = null;
          itemDepth = 0;
        }
        itemDepth++;
        // 入れ子の li は外側の1つとして読む
        if (itemDepth === 1) item = { tag, text: "" };
        if (
          !onEnd(el, () => {
            itemDepth = Math.max(0, itemDepth - 1);
            if (itemDepth === 0 && item) {
              onItemEnd(item.tag, item.text);
              item = null;
            }
          })
        )
          itemDepth--;
      },
    })
    .on("tr", {
      element(el) {
        if (mode !== "ingredients" || chromeDepth > 0) return;
        rowCells = [];
        onEnd(el, () => {
          // th だけの行（「材料」「分量」の見出し行）は飛ばす
          if (
            rowCells.some((c) => c.tag === "td") &&
            rowCells[0]?.text &&
            ingredients.length < MAX_INGREDIENTS
          )
            ingredients.push({
              name: rowCells[0].text,
              amount: rowCells[1]?.text ?? "",
            });
          rowCells = [];
        });
      },
    })
    .onDocument({
      text(t) {
        if (!item && openHeadings.length === 0) return;
        for (const h of openHeadings)
          if (h.text.length < MAX_HEADING_CHARS) h.text += t.text;
        if (item && item.text.length < MAX_ITEM_CHARS) item.text += t.text;
      },
    });

  const reader = rewriter.transform(res).body?.getReader();
  let total = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value?.byteLength ?? 0;
      if (foundRecipe || total > maxBytes) {
        await reader.cancel();
        break;
      }
    }
  }
  return {
    jsonLd,
    title: (ogTitle || title).trim().slice(0, 100),
    sections: { ingredients, steps },
    url: finalUrl,
  };
}

/**
 * YouTube Data API v3（videos.list?part=snippet）で題名と概要欄を取る。
 * 鍵（YOUTUBE_API_KEY）はここでだけ使う。鍵が無い・失敗したら null（呼ぶ側は oEmbed の題名だけにする）
 */
export async function youtubeSnippet(
  env: { YOUTUBE_API_KEY?: string },
  videoId: string,
): Promise<{ title: string; description: string; channelId: string } | null> {
  const key = env.YOUTUBE_API_KEY;
  if (!key) return null;
  const u = new URL("https://www.googleapis.com/youtube/v3/videos");
  u.searchParams.set("part", "snippet");
  u.searchParams.set("id", videoId);
  try {
    // 鍵は URL に載せない（ログ・トレースに URL が残っても鍵が出ないように）
    const res = await fetchWithTimeout(
      u.toString(),
      { headers: { "x-goog-api-key": key } },
      4000,
    );
    if (!res.ok) {
      await res.body?.cancel();
      return null;
    }
    const j = (await res.json()) as {
      items?: {
        snippet?: {
          title?: unknown;
          description?: unknown;
          channelId?: unknown;
        };
      }[];
    };
    const sn = j.items?.[0]?.snippet;
    if (!sn) return null;
    return {
      title: typeof sn.title === "string" ? sn.title.slice(0, 100) : "",
      description:
        typeof sn.description === "string" ? sn.description.slice(0, 5000) : "",
      channelId: typeof sn.channelId === "string" ? sn.channelId : "",
    };
  } catch {
    return null;
  }
}

const COMMENTS_FETCHED = 20;
const OWNER_COMMENTS = 3;
const OTHER_COMMENTS = 5;
/** 1件あたりの文字数（読む件数と合わせて、CPU 10ms に収まる量にする） */
const MAX_COMMENT_CHARS = 3000;

/**
 * YouTube Data API v3（commentThreads.list、関連度順）でコメントを取る。
 * 固定コメントは API で見分けられないので、投稿者本人（動画のチャンネル）のコメントを上位3件まで先に、
 * 次に他の人のコメントを上位5件まで返す。鍵が無い・コメントが止められている・失敗したら空
 */
export async function youtubeComments(
  env: { YOUTUBE_API_KEY?: string },
  videoId: string,
  ownerChannelId: string,
): Promise<{ text: string; byOwner: boolean }[]> {
  const key = env.YOUTUBE_API_KEY;
  if (!key) return [];
  const u = new URL("https://www.googleapis.com/youtube/v3/commentThreads");
  u.searchParams.set("part", "snippet");
  u.searchParams.set("videoId", videoId);
  u.searchParams.set("order", "relevance");
  u.searchParams.set("textFormat", "plainText");
  u.searchParams.set("maxResults", String(COMMENTS_FETCHED));
  try {
    const res = await fetchWithTimeout(
      u.toString(),
      { headers: { "x-goog-api-key": key } },
      4000,
    );
    if (!res.ok) {
      await res.body?.cancel();
      return [];
    }
    const j = (await res.json()) as {
      items?: {
        snippet?: {
          topLevelComment?: {
            snippet?: {
              textDisplay?: unknown;
              authorChannelId?: { value?: unknown };
            };
          };
        };
      }[];
    };
    const all = (Array.isArray(j.items) ? j.items : []).flatMap((it) => {
      const sn = it?.snippet?.topLevelComment?.snippet;
      if (typeof sn?.textDisplay !== "string" || !sn.textDisplay.trim())
        return [];
      return [
        {
          text: sn.textDisplay.slice(0, MAX_COMMENT_CHARS),
          byOwner:
            !!ownerChannelId && sn.authorChannelId?.value === ownerChannelId,
        },
      ];
    });
    return [
      ...all.filter((c) => c.byOwner).slice(0, OWNER_COMMENTS),
      ...all.filter((c) => !c.byOwner).slice(0, OTHER_COMMENTS),
    ];
  } catch {
    return [];
  }
}

/** YouTube の題名を oEmbed で取る（鍵は要らない）。取れなければ空 */
export async function youtubeTitle(watchUrl: string): Promise<string> {
  try {
    const res = await fetchWithTimeout(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl)}`,
      {},
      4000,
    );
    if (!res.ok) return "";
    const j = (await res.json()) as { title?: unknown };
    return typeof j.title === "string" ? j.title.slice(0, 100) : "";
  } catch {
    return "";
  }
}
