import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DESCRIPTION_WITH_LINKS,
  DESCRIPTION_WITH_RECIPE,
  NIPPN_LIKE_HTML,
} from "../shared/fixtures/import-fixtures";
import { api, signUp } from "./helpers";

// 外に取りに行く fetch を差し替えて、ダミーのページ・YouTube の返事を返す
type Route = (url: URL) => Response | undefined;
const calls: string[] = [];
function mockFetch(route: Route) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    calls.push(raw);
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
    // Data API v3 videos.list?part=snippet を、テスト用の鍵と動画 ID で呼んでいる
    const apiCall = new URL(
      calls.find((c) => c.includes("googleapis.com")) ?? "",
    );
    expect(apiCall.pathname).toBe("/youtube/v3/videos");
    expect(apiCall.searchParams.get("part")).toBe("snippet");
    expect(apiCall.searchParams.get("id")).toBe("abcDEF12345");
    expect(apiCall.searchParams.get("key")).toBe("test-youtube-key");
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
