// 取り込み用にページを取りに行く（Cloudflare の fetch と HTMLRewriter を使う部品）。
// 無料プランの CPU 10ms を守るため、HTMLRewriter で流し読みし、JSON-LD の Recipe が見つかったら
// そこで読むのをやめる。予備として「材料」「作り方」の見出しの後の dt/dd・li・th/td の文字も拾う
// （件数と文字数に上限あり。見出しの判定と整形は src/shared/importer.ts）。
import {
  classifyHeading,
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

/** リダイレクトは自分でたどり、行き先ごとに assertPublicHttpUrl を通す */
async function fetchPublic(
  url: string,
): Promise<{ res: Response; url: string }> {
  let current = assertPublicHttpUrl(url);
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
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
        TIMEOUT_MS,
      );
    } catch {
      throw new FetchPageError("ページを取得できませんでした");
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await res.body?.cancel();
      if (!loc) throw new FetchPageError("ページを取得できませんでした");
      current = assertPublicHttpUrl(new URL(loc, current).toString());
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

export async function scanPage(url: string): Promise<PageScan> {
  const { res, url: finalUrl } = await fetchPublic(url);
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
  if (len > MAX_BYTES) {
    await res.body?.cancel();
    throw new FetchPageError("ページが大きすぎます");
  }

  const jsonLd: string[] = [];
  let jsonChars = 0;
  let current: string | null = null;
  let foundRecipe = false;
  let title = "";
  let ogTitle = "";
  let inTitle = false;

  // 予備の読み取り。開いている見出しごとに文字をためて、閉じたときに材料・手順・その他を決める
  const ingredients: RawIngredient[] = [];
  const steps: string[] = [];
  let mode: HeadingKind = "other";
  const openHeadings: { text: string }[] = [];
  let item: { tag: string; text: string } | null = null;
  let itemDepth = 0;
  let pendingName: string | null = null;
  let rowCells: string[] = [];
  const full = () =>
    ingredients.length >= MAX_INGREDIENTS && steps.length >= MAX_STEPS;

  const onItemEnd = (tag: string, raw: string) => {
    const t = raw.trim();
    if (mode === "ingredients" && ingredients.length < MAX_INGREDIENTS) {
      if (tag === "dt") pendingName = t;
      else if (tag === "dd") {
        ingredients.push(
          pendingName !== null
            ? { name: pendingName, amount: t }
            : { name: t, amount: "" },
        );
        pendingName = null;
      } else if (tag === "li") ingredients.push({ name: t, amount: "" });
      else rowCells.push(t);
    } else if (mode === "steps" && steps.length < MAX_STEPS) {
      if (tag === "li" || tag === "dd" || tag === "td") steps.push(t);
    }
  };

  const rewriter = new HTMLRewriter()
    .on('script[type="application/ld+json"]', {
      element(el) {
        current = "";
        el.onEndTag(() => {
          if (current !== null) {
            jsonLd.push(current);
            if (/"Recipe"/.test(current)) foundRecipe = true;
          }
          current = null;
        });
      },
      text(t) {
        if (current === null) return;
        if (jsonChars + t.text.length > MAX_JSONLD_CHARS) return;
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
        el.onEndTag(() => {
          inTitle = false;
        });
      },
      text(t) {
        if (inTitle && title.length < 200) title += t.text;
      },
    })
    .on(HEADINGS, {
      element(el) {
        if (NOT_HEADING_TAGS.has(el.tagName.toLowerCase())) return;
        const h = { text: "" };
        openHeadings.push(h);
        el.onEndTag(() => {
          openHeadings.splice(openHeadings.lastIndexOf(h), 1);
          const kind = classifyHeading(h.text);
          if (kind === "ignore") return;
          mode = kind;
          pendingName = null;
        });
      },
    })
    .on("li, dt, dd, th, td", {
      element(el) {
        if (mode === "other" || full()) return;
        itemDepth++;
        const tag = el.tagName.toLowerCase();
        // 入れ子の li は外側の1つとして読む
        if (itemDepth === 1) item = { tag, text: "" };
        el.onEndTag(() => {
          itemDepth--;
          if (itemDepth === 0 && item) {
            onItemEnd(item.tag, item.text);
            item = null;
          }
        });
      },
    })
    .on("tr", {
      element(el) {
        if (mode !== "ingredients") return;
        rowCells = [];
        el.onEndTag(() => {
          const [name, amount] = rowCells;
          if (name && ingredients.length < MAX_INGREDIENTS)
            ingredients.push({ name, amount: amount ?? "" });
          rowCells = [];
        });
      },
    })
    .onDocument({
      text(t) {
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
      if (foundRecipe || total > MAX_BYTES) {
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
): Promise<{ title: string; description: string } | null> {
  const key = env.YOUTUBE_API_KEY;
  if (!key) return null;
  const u = new URL("https://www.googleapis.com/youtube/v3/videos");
  u.searchParams.set("part", "snippet");
  u.searchParams.set("id", videoId);
  u.searchParams.set("key", key);
  try {
    const res = await fetchWithTimeout(u.toString(), {}, 4000);
    if (!res.ok) {
      await res.body?.cancel();
      return null;
    }
    const j = (await res.json()) as {
      items?: { snippet?: { title?: unknown; description?: unknown } }[];
    };
    const sn = j.items?.[0]?.snippet;
    if (!sn) return null;
    return {
      title: typeof sn.title === "string" ? sn.title.slice(0, 100) : "",
      description:
        typeof sn.description === "string" ? sn.description.slice(0, 5000) : "",
    };
  } catch {
    return null;
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
