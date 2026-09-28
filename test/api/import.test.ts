import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DESCRIPTION_WITH_LINKS,
  DESCRIPTION_WITH_RECIPE,
  NIPPN_LIKE_HTML,
  PRODUCT_HTML,
  TABLE_HTML,
  TRICKY_HTML,
} from "../shared/fixtures/import-fixtures";
import { youtubeSnippet } from "../../src/api/platform/fetch-page";
import { api, signUp } from "./helpers";

// 外に取りに行く fetch を差し替えて、ダミーのページ・YouTube の返事を返す
type Route = (url: URL) => Response | undefined;
const calls: string[] = [];
const keyHeaders: string[] = [];
function mockFetch(route: Route) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    calls.push(raw);
    const key = new Headers(init?.headers).get("x-goog-api-key");
    if (key) keyHeaders.push(key);
    return route(new URL(raw)) ?? new Response("not found", { status: 404 });
  });
}
const html = (body: string) =>
  new Response(body, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const snippet = (description: string) =>
  json({
    items: [{ snippet: { title: "ダミー動画のレシピ", description } }],
  });

let cookie: string;
beforeAll(async () => {
  cookie = await signUp();
});
afterEach(() => {
  vi.restoreAllMocks();
  calls.length = 0;
  keyHeaders.length = 0;
});

describe("POST /api/import（JSON-LD が無いページ）", () => {
  it("「材料」の後の dt/dd と「作り方」の後の li を読む。説明文や他の li は拾わない", async () => {
    mockFetch((u) =>
      u.hostname === "shop.example.com" ? html(NIPPN_LIKE_HTML) : undefined,
    );
    const res = await api(cookie, "/import", {
      method: "POST",
      body: { url: "https://shop.example.com/recipe/1.html" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      found: boolean;
      draft: Record<string, unknown>;
    };
    expect(body.found).toBe(true);
    expect(body.draft).toMatchObject({
      title: "ダミーきのこのスパゲッティ",
      ingredients: [
        { name: "スパゲッティ", amount: "200g" },
        { name: "しめじ", amount: "1パック" },
        { name: "塩・こしょう", amount: "少々" },
      ],
      steps: [
        "しめじをほぐす。",
        "スパゲッティを&ゆでる。",
        "①と②を炒め合わせ、塩・こしょうで味を調える。",
      ],
      sourceUrl: "https://shop.example.com/recipe/1.html",
      videoUrl: null,
    });
    expect(JSON.stringify(body)).not.toContain("出典の説明文");
    expect(JSON.stringify(body)).not.toContain("会社情報");
  });

  it("見出しも JSON-LD も無ければ found: false で題名だけ", async () => {
    mockFetch(() =>
      html(
        "<html><head><title>ただの記事</title></head><body><p>本文</p></body></html>",
      ),
    );
    const res = await api(cookie, "/import", {
      method: "POST",
      body: { url: "https://blog.example.com/a" },
    });
    const body = (await res.json()) as {
      found: boolean;
      draft: { title: string; ingredients: unknown[] };
    };
    expect(body.found).toBe(false);
    expect(body.draft.title).toBe("ただの記事");
    expect(body.draft.ingredients).toEqual([]);
  });
});

describe("POST /api/import（YouTube）", () => {
  const video = "https://youtu.be/abcDEF12345";
  const watch = "https://www.youtube.com/watch?v=abcDEF12345";

  it("概要欄に【材料】【作り方】があれば、そこから読む。出典は動画", async () => {
    mockFetch((u) =>
      u.hostname === "www.googleapis.com"
        ? snippet(DESCRIPTION_WITH_RECIPE)
        : undefined,
    );
    const res = await api(cookie, "/import", {
      method: "POST",
      body: { url: video },
    });
    const text = await res.text();
    const body = JSON.parse(text) as {
      found: boolean;
      draft: Record<string, unknown>;
    };
    expect(body.found).toBe(true);
    expect(body.draft).toMatchObject({
      title: "ダミー動画のレシピ",
      ingredients: [
        { name: "鶏もも肉", amount: "1枚（300g）" },
        { name: "片栗粉", amount: "大さじ1" },
        { name: "しょうゆ", amount: "大さじ2" },
        { name: "みりん", amount: "大さじ2" },
      ],
      sourceUrl: watch,
      videoUrl: watch,
    });
    // Data API v3 videos.list?part=snippet を、動画 ID と（URL ではなくヘッダーの）鍵で呼んでいる
    const apiCall = new URL(
      calls.find((c) => c.includes("googleapis.com")) ?? "",
    );
    expect(apiCall.pathname).toBe("/youtube/v3/videos");
    expect(apiCall.searchParams.get("part")).toBe("snippet");
    expect(apiCall.searchParams.get("id")).toBe("abcDEF12345");
    expect(apiCall.searchParams.has("key")).toBe(false);
    expect(keyHeaders).toEqual(["test-youtube-key"]);
    // 鍵は返事に出さない
    expect(text).not.toContain("test-youtube-key");
  });

  it("概要欄に材料が無ければ、貼ってある URL を順に読み、取れたページを出典にする", async () => {
    mockFetch((u) => {
      if (u.hostname === "www.googleapis.com")
        return snippet(DESCRIPTION_WITH_LINKS);
      if (u.hostname === "other.example.org") return html(NIPPN_LIKE_HTML);
      return undefined; // recipe.example.com は 404
    });
    const res = await api(cookie, "/import", {
      method: "POST",
      body: { url: video },
    });
    const body = (await res.json()) as {
      found: boolean;
      draft: Record<string, unknown>;
    };
    expect(body.found).toBe(true);
    expect(body.draft).toMatchObject({
      title: "ダミーきのこのスパゲッティ",
      sourceUrl: "https://other.example.org/r/9",
      videoUrl: watch,
    });
    // 取れた時点でやめる（3件目は読まない）。SNS・動画の URL は読まない
    expect(calls.some((c) => c.includes("third.example.net"))).toBe(false);
    expect(calls.some((c) => c.includes("instagram.com"))).toBe(false);
  });

  it("YouTube API が失敗したら、今まで通り題名だけ", async () => {
    mockFetch((u) => {
      if (u.hostname === "www.googleapis.com")
        return json({ error: { code: 403 } }, 403);
      if (u.pathname === "/oembed") return json({ title: "oEmbed の題名" });
      return undefined;
    });
    const res = await api(cookie, "/import", {
      method: "POST",
      body: { url: video },
    });
    const body = (await res.json()) as {
      found: boolean;
      draft: Record<string, unknown>;
    };
    expect(body.found).toBe(false);
    expect(body.draft).toMatchObject({
      title: "oEmbed の題名",
      ingredients: [],
      sourceUrl: watch,
      videoUrl: watch,
    });
  });
});

async function importDraft(url: string) {
  const res = await api(cookie, "/import", { method: "POST", body: { url } });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    found: boolean;
    draft: {
      title: string;
      ingredients: { name: string; amount: string }[];
      steps: string[];
      sourceUrl: string;
      videoUrl: string | null;
    };
  };
}

describe("POST /api/import（見出しの誤判定・読みすぎ）", () => {
  it("メニューの「材料から探す」、li の中の番号、材料の小見出し、見出しの無いコツ欄・フッター", async () => {
    mockFetch(() => html(TRICKY_HTML));
    const body = await importDraft("https://tricky.example.com/r/1");
    expect(body.found).toBe(true);
    expect(body.draft.title).toBe("ダミーの照り焼き");
    expect(body.draft.ingredients).toEqual([
      { name: "鶏もも肉", amount: "1枚" },
      { name: "片栗粉", amount: "大さじ1" },
      { name: "しょうゆ", amount: "大さじ2" },
    ]);
    expect(body.draft.steps).toEqual(["鶏肉に粉をまぶす。", "2、3分焼く。"]);
  });

  it("表の材料（見出し行は飛ばす）と、閉じタグを省いた li", async () => {
    mockFetch(() => html(TABLE_HTML));
    const body = await importDraft("https://table.example.com/r/1");
    expect(body.draft.ingredients).toEqual([
      { name: "大根", amount: "1/2本" },
      { name: "だし", amount: "400ml" },
    ]);
    expect(body.draft.steps).toEqual(["大根を切る。", "だしで煮る。"]);
  });

  it("手順の中の入れ子の一覧は、外側の手順の一部として読む", async () => {
    mockFetch(() =>
      html(
        "<h1>ダミー</h1><h2>作り方</h2><ol><li>焼く<ul><li>弱火で</li></ul></li><li>盛る</li></ol>",
      ),
    );
    const body = await importDraft("https://nested.example.com/r/1");
    expect(body.draft.steps).toEqual(["焼く弱火で", "盛る"]);
  });

  it("原材料名だけの商品ページは読み取れない扱い", async () => {
    mockFetch(() => html(PRODUCT_HTML));
    const body = await importDraft("https://shop.example.com/item/1");
    expect(body.found).toBe(false);
  });
});

describe("POST /api/import（YouTube の概要欄の URL）", () => {
  const video = "https://youtu.be/abcDEF12345";

  it("社内向けのアドレスや、転送先が YouTube・SNS のリンクは読まない", async () => {
    mockFetch((u) => {
      if (u.hostname === "www.googleapis.com")
        return snippet(
          "http://127.0.0.1/r\nhttp://foo.localhost/r\nhttps://short.example.com/abc",
        );
      if (u.hostname === "short.example.com")
        return new Response(null, {
          status: 302,
          headers: { location: "https://www.youtube.com/watch?v=zzzzzzzzzzz" },
        });
      if (u.pathname === "/oembed") return json({ title: "題名" });
      return undefined;
    });
    const body = await importDraft(video);
    expect(body.found).toBe(false);
    expect(calls.some((c) => c.includes("127.0.0.1"))).toBe(false);
    expect(calls.some((c) => c.includes("localhost"))).toBe(false);
    expect(calls.some((c) => c.includes("youtube.com/watch"))).toBe(false);
  });

  it("リンク先が商品ページ（原材料名）なら採用しない", async () => {
    mockFetch((u) => {
      if (u.hostname === "www.googleapis.com")
        return snippet("https://shop.example.com/item/1");
      if (u.hostname === "shop.example.com") return html(PRODUCT_HTML);
      if (u.pathname === "/oembed") return json({ title: "題名" });
      return undefined;
    });
    const body = await importDraft(video);
    expect(body.found).toBe(false);
  });

  it("出典は utm_* を外した URL", async () => {
    mockFetch((u) => {
      if (u.hostname === "www.googleapis.com")
        return snippet("https://nippn.example.com/r/1?utm_source=youtube&id=2");
      if (u.hostname === "nippn.example.com") return html(NIPPN_LIKE_HTML);
      return undefined;
    });
    const body = await importDraft(video);
    expect(body.draft.sourceUrl).toBe("https://nippn.example.com/r/1?id=2");
  });

  it("鍵が無ければ YouTube API を呼ばない", async () => {
    mockFetch(() => undefined);
    expect(await youtubeSnippet({}, "abcDEF12345")).toBeNull();
    expect(calls).toEqual([]);
  });
});
