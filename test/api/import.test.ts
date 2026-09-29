import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DESCRIPTION_LOOSE,
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

  it("見出しの無い概要欄（罫線の区間・名前...分量）も読み、全体と内訳の重なりを知らせる", async () => {
    mockFetch((u) =>
      u.hostname === "www.googleapis.com"
        ? snippet(DESCRIPTION_LOOSE)
        : undefined,
    );
    const res = await api(cookie, "/import", {
      method: "POST",
      body: { url: video },
    });
    const body = (await res.json()) as {
      found: boolean;
      notice: string;
      draft: { ingredients: { name: string }[]; steps: string[] };
    };
    expect(body.found).toBe(true);
    expect(body.draft.ingredients[0]).toEqual({
      name: "ダミー魚",
      amount: "4尾（500g）",
    });
    expect(body.draft.steps).toHaveLength(3);
    expect(body.notice).toContain("「ダミー魚」は全体の量と内訳の両方");
    // 概要欄から読めたので、例の本のリンクは読みに行かない
    expect(calls.some((c) => c.includes("example.com/book"))).toBe(false);
  });

  it("概要欄が商品の並び（手順なし）とリンクだけなら、ゆるい読み取りをせずリンク先を読む", async () => {
    mockFetch((u) => {
      if (u.hostname === "www.googleapis.com")
        return snippet(
          "▼使った調味料\n・ダミー醤油 1本\n・ダミー味噌 1個\n・ダミーみりん 1本\n\nレシピはこちら\nhttps://other.example.org/r/9",
        );
      if (u.hostname === "other.example.org") return html(NIPPN_LIKE_HTML);
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
    expect(body.found).toBe(true);
    expect(body.draft.sourceUrl).toBe("https://other.example.org/r/9");
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

  it.each([
    [
      "手順の後の h3 ポイントの一覧は拾わない",
      "<h1>ダミー</h1><h2>材料</h2><ul><li>卵 2個</li></ul><h2>作り方</h2><ol><li>焼く</li></ol><h3>ポイント</h3><ul><li>焦げやすいので注意</li></ul>",
      [{ name: "卵", amount: "2個" }],
      ["焼く"],
    ],
    [
      "1件ずつ別の dl に入った材料・手順を全部読む",
      '<h2>材料</h2><dl class="ing"><dt>鶏</dt><dd>1枚</dd></dl><dl class="ing"><dt>塩</dt><dd>少々</dd></dl><ul class="tips"><li>メモ</li></ul><h2>作り方</h2><dl class="step"><dd>切る</dd></dl><dl class="step"><dd>焼く</dd></dl>',
      [
        { name: "鶏", amount: "1枚" },
        { name: "塩", amount: "少々" },
      ],
      ["切る", "焼く"],
    ],
    [
      "class 付きの枠で包んだ見出しでも、小見出し（タレ）の後を読む",
      '<div class="c-heading"><h2>材料</h2></div><ul><li>鶏 1枚</li></ul><h4>タレ</h4><ul><li>しょうゆ 大さじ1</li></ul><h2>作り方</h2><ol><li>焼く</li></ol>',
      [
        { name: "鶏", amount: "1枚" },
        { name: "しょうゆ", amount: "大さじ1" },
      ],
      ["焼く"],
    ],
    [
      "section の中の header・aside の見出しは読む",
      '<section><header><h2>材料</h2></header><ul><li>卵 1個</li></ul></section><aside class="recipe-steps"><h2>作り方</h2><ol><li>焼く</li></ol></aside><footer><ul><li>会社情報</li></ul></footer>',
      [{ name: "卵", amount: "1個" }],
      ["焼く"],
    ],
  ])("%s", async (_name, page, ingredients, steps) => {
    mockFetch(() => html(page));
    const body = await importDraft("https://layout.example.com/r/1");
    expect(body.draft.ingredients).toEqual(ingredients);
    expect(body.draft.steps).toEqual(steps);
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

describe("POST /api/import（YouTube のコメント）", () => {
  const video = "https://youtu.be/abcDEF12345";
  const watch = "https://www.youtube.com/watch?v=abcDEF12345";
  const OWNER = "UCowner0000000000000000";
  const video_ = (description: string) =>
    json({
      items: [
        {
          snippet: {
            title: "ダミー動画のレシピ",
            description,
            channelId: OWNER,
          },
        },
      ],
    });
  const comment = (text: string, author = "UCviewer") => ({
    snippet: {
      topLevelComment: {
        snippet: { textDisplay: text, authorChannelId: { value: author } },
      },
    },
  });
  // 返事は呼ばれたときに作る（Workers では別のリクエストで作った本文を読めない）
  const threads = (items: unknown[]) => () => json({ items });
  const OTHER_RECIPE =
    "【材料】\n・ダミー豆腐 1丁\n【作り方】\n1. 豆腐を切る。\n2. 煮る。";
  const route =
    (comments: () => Response, extra?: Route): Route =>
    (u) => {
      if (u.pathname === "/youtube/v3/videos") return video_("今日のレシピ！");
      if (u.pathname === "/youtube/v3/commentThreads") return comments();
      if (u.pathname === "/oembed") return json({ title: "oEmbed の題名" });
      return extra?.(u);
    };

  it("概要欄で読めなければ、投稿者本人のコメントを先に読む。出典は動画", async () => {
    mockFetch(
      route(
        threads([
          comment(OTHER_RECIPE),
          comment("おいしそう！"),
          comment(DESCRIPTION_WITH_RECIPE, OWNER),
        ]),
      ),
    );
    const res = await api(cookie, "/import", {
      method: "POST",
      body: { url: video },
    });
    const text = await res.text();
    const body = JSON.parse(text) as {
      found: boolean;
      message: string;
      draft: { ingredients: { name: string }[]; sourceUrl: string };
    };
    expect(body.found).toBe(true);
    expect(body.message).toContain("動画のコメントから読み取りました");
    expect(body.message).toContain("投稿者本人");
    expect(body.draft.ingredients[0]?.name).toBe("鶏もも肉");
    expect(body.draft.sourceUrl).toBe(watch);
    // commentThreads を関連度順・テキストで、鍵はヘッダーで呼んでいる
    const c = new URL(calls.find((x) => x.includes("commentThreads")) ?? "");
    expect(c.searchParams.get("videoId")).toBe("abcDEF12345");
    expect(c.searchParams.get("order")).toBe("relevance");
    expect(c.searchParams.get("textFormat")).toBe("plainText");
    expect(c.searchParams.has("key")).toBe(false);
    expect(keyHeaders.every((k) => k === "test-youtube-key")).toBe(true);
    expect(text).not.toContain("test-youtube-key");
  });

  it("本人のコメントに無ければ、上位5件の他の人のコメントから読む（6件目以降は読まない）", async () => {
    const five = Array.from({ length: 5 }, (_, i) => comment(`感想${i}`));
    mockFetch(route(threads([...five, comment(OTHER_RECIPE)])));
    const body = await importDraft(video);
    expect(body.found).toBe(false);

    vi.restoreAllMocks();
    mockFetch(route(threads([comment("感想"), comment(OTHER_RECIPE)])));
    const res = await api(cookie, "/import", {
      method: "POST",
      body: { url: video },
    });
    const viewer = (await res.json()) as {
      found: boolean;
      message: string;
      draft: { ingredients: { name: string }[] };
    };
    expect(viewer.found).toBe(true);
    expect(viewer.draft.ingredients[0]?.name).toBe("ダミー豆腐");
    // 他の人のコメントからのときは、確かめるよう知らせる
    expect(viewer.message).toContain("投稿者以外");
    expect(viewer.message).toContain("確かめて");
  });

  it("本人のコメントも上位3件まで（4件目以降は読まない）", async () => {
    const three = Array.from({ length: 3 }, (_, i) =>
      comment(`ご覧いただきありがとうございます${i}`, OWNER),
    );
    mockFetch(route(threads([...three, comment(OTHER_RECIPE, OWNER)])));
    const body = await importDraft(video);
    expect(body.found).toBe(false);
  });

  it("動画のチャンネルが分からなければ、誰のコメントも本人扱いにしない（リンクも読まない）", async () => {
    mockFetch((u) => {
      if (u.pathname === "/youtube/v3/videos") return snippet("今日のレシピ！");
      if (u.pathname === "/youtube/v3/commentThreads")
        return json({
          items: [comment("詳しくは https://other.example.org/r/9", "")],
        });
      if (u.hostname === "other.example.org") return html(NIPPN_LIKE_HTML);
      if (u.pathname === "/oembed") return json({ title: "題名" });
      return undefined;
    });
    const body = await importDraft(video);
    expect(body.found).toBe(false);
    expect(calls.some((c) => c.includes("other.example.org"))).toBe(false);
  });

  it("概要欄のリンクで読めたらコメントは取りに行かない", async () => {
    mockFetch((u) => {
      if (u.pathname === "/youtube/v3/videos")
        return video_("https://other.example.org/r/9");
      if (u.hostname === "other.example.org") return html(NIPPN_LIKE_HTML);
      return undefined;
    });
    const body = await importDraft(video);
    expect(body.found).toBe(true);
    expect(calls.some((c) => c.includes("commentThreads"))).toBe(false);
  });

  it("コメントの返事が壊れていたら、今まで通り題名だけ", async () => {
    mockFetch(route(() => new Response("{broken", { status: 200 })));
    const body = await importDraft(video);
    expect(body.found).toBe(false);
    expect(body.draft.title).toBe("ダミー動画のレシピ");
  });

  it("コメントのリンクは本人のものだけ読む", async () => {
    const extra: Route = (u) =>
      u.hostname === "other.example.org" || u.hostname === "spam.example.com"
        ? html(NIPPN_LIKE_HTML)
        : undefined;
    mockFetch(
      route(
        threads([
          comment("レシピはこちら https://spam.example.com/r/1"),
          comment("詳しくは https://other.example.org/r/9", OWNER),
        ]),
        extra,
      ),
    );
    const body = await importDraft(video);
    expect(body.found).toBe(true);
    expect(body.draft.sourceUrl).toBe("https://other.example.org/r/9");
    expect(calls.some((c) => c.includes("spam.example.com"))).toBe(false);

    vi.restoreAllMocks();
    calls.length = 0;
    mockFetch(
      route(
        threads([comment("レシピはこちら https://spam.example.com/r/1")]),
        extra,
      ),
    );
    const viewerOnly = await importDraft(video);
    expect(viewerOnly.found).toBe(false);
    expect(calls.some((c) => c.includes("spam.example.com"))).toBe(false);
  });

  it("コメントが止められている（403）なら、今まで通り題名だけ", async () => {
    mockFetch(
      route(() =>
        json(
          { error: { code: 403, errors: [{ reason: "commentsDisabled" }] } },
          403,
        ),
      ),
    );
    const body = await importDraft(video);
    expect(body.found).toBe(false);
    expect(body.draft.title).toBe("ダミー動画のレシピ");
    expect(body.draft.sourceUrl).toBe(watch);
  });

  it("概要欄で読めたらコメントは取りに行かない", async () => {
    mockFetch((u) =>
      u.pathname === "/youtube/v3/videos"
        ? video_(DESCRIPTION_WITH_RECIPE)
        : undefined,
    );
    const body = await importDraft(video);
    expect(body.found).toBe(true);
    expect(calls.some((c) => c.includes("commentThreads"))).toBe(false);
  });
});

describe("読めなかった URL の報告", () => {
  it("URL だけを保存し、同じ URL は1件にまとめて一覧できる", async () => {
    const me = await signUp("報告");
    for (const url of [
      "https://example.com/a",
      "https://example.com/b",
      "https://example.com/a",
    ]) {
      const r = await api(me, "/import/reports", {
        method: "POST",
        body: { url },
      });
      expect(r.status).toBe(201);
    }
    const list = (await (await api(me, "/import/reports")).json()) as {
      reports: { url: string; createdAt: number }[];
    };
    expect(list.reports.map((r) => r.url).sort()).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });

  it("1グループ200件まで。超えたら 429", async () => {
    const me = await signUp("上限");
    for (let k = 0; k < 200; k++) {
      const r = await api(me, "/import/reports", {
        method: "POST",
        body: { url: `https://example.com/r/${k}` },
      });
      expect(r.status).toBe(201);
    }
    const over = await api(me, "/import/reports", {
      method: "POST",
      body: { url: "https://example.com/r/over" },
    });
    expect(over.status).toBe(429);
    // 報告済みの URL を送り直すのは、上限でもエラーにしない
    const again = await api(me, "/import/reports", {
      method: "POST",
      body: { url: "https://example.com/r/0" },
    });
    expect(again.status).toBe(201);
    // 200件を1件ずつ入れるので、全体を並列で流すと既定の5秒を超えることがある
  }, 20_000);

  it("URL でなければ 400、ログインしていなければ 401", async () => {
    expect(
      (
        await api(cookie, "/import/reports", {
          method: "POST",
          body: { url: "javascript:alert(1)" },
        })
      ).status,
    ).toBe(400);
    expect((await api(null, "/import/reports")).status).toBe(401);
  });
});
