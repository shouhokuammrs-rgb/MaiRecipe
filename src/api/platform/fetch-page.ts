// 取り込み用にページを取りに行く（Cloudflare の fetch と HTMLRewriter を使う部品）。
// 無料プランの CPU 10ms を守るため、HTMLRewriter で JSON-LD と題名だけを流し読みで拾い、
// Recipe が見つかったらそこで読むのをやめる。

const MAX_BYTES = 1_500_000;
const MAX_JSONLD_CHARS = 300_000;
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 5;

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
async function fetchPublic(url: string): Promise<Response> {
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
    return res;
  }
  throw new FetchPageError("転送が多すぎて取得できませんでした");
}

export type PageScan = { jsonLd: string[]; title: string };

export async function scanPage(url: string): Promise<PageScan> {
  const res = await fetchPublic(url);
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
  return { jsonLd, title: (ogTitle || title).trim().slice(0, 100) };
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
