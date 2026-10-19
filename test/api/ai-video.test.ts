import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractGeminiText } from "../../src/api/platform/gemini";
import type { WorkersAiBinding } from "../../src/api/platform/workers-ai";
import { api, signUp } from "./helpers";

// 本物の Gemini・YouTube は呼ばない。fetch を差し替えてダミーの返事を返す（DEC-018）
const E = env as unknown as { GEMINI_API_KEY?: string; AI?: WorkersAiBinding };
const WATCH = "https://www.youtube.com/watch?v=abcDEF12345";
const DESC_INGREDIENTS_ONLY =
  "ダミーの炊飯器レシピです。\n【材料（2人分）】\n・鶏もも肉 1枚\n・にんにく 2かけ\n・米 2合\n・しょうゆ 大さじ1";
const GEMINI_RECIPE = JSON.stringify({
  title: "ダミーの炊き込みご飯",
  ingredients: [
    { name: "鶏もも肉", amount: "350g" },
    { name: "米", amount: "2合" },
  ],
  steps: ["米を洗う", "鶏肉に塩をすり込む", "炊飯器で炊く"],
  time: "60分",
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const geminiReply = (text: string) =>
  json({ candidates: [{ content: { parts: [{ text }] } }] });

type Seen = { url: string; key: string | null; body: unknown };
function mockFetch(
  gemini: () => Response,
  description = DESC_INGREDIENTS_ONLY,
) {
  const seen: Seen[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const u = new URL(raw);
    if (u.hostname === "generativelanguage.googleapis.com") {
      seen.push({
        url: raw,
        key: new Headers(init?.headers).get("x-goog-api-key"),
        body: JSON.parse(String(init?.body)),
      });
      return gemini();
    }
    if (u.hostname === "www.googleapis.com" && u.pathname.endsWith("/videos"))
      return json({
        items: [
          {
            snippet: {
              title: "ダミー動画",
              description,
              channelId: "UCdummy",
            },
          },
        ],
      });
    if (u.hostname === "www.googleapis.com") return json({ items: [] });
    return new Response("not found", { status: 404 });
  });
  return seen;
}

afterEach(() => {
  delete E.GEMINI_API_KEY;
  delete E.AI;
  vi.restoreAllMocks();
});

describe("Gemini の返事を読む", () => {
  it("考えている途中の文は除いて、答えの文字だけを取り出す", () => {
    expect(
      extractGeminiText({
        candidates: [
          {
            content: {
              parts: [{ text: "考え中…", thought: true }, { text: '{"a":1}' }],
            },
          },
        ],
      }),
    ).toBe('{"a":1}');
    expect(extractGeminiText(null)).toBe("");
    expect(extractGeminiText({ candidates: [] })).toBe("");
  });
});

describe("手順が書かれていない動画は、Gemini に動画を見せる（DEC-018）", () => {
  it("材料は概要欄から、手順は Gemini が動画から読んだものを使う", async () => {
    E.GEMINI_API_KEY = "test-gemini-key";
    const workersAi = { run: vi.fn(async () => ({ response: "{}" })) };
    E.AI = workersAi;
    const seen = mockFetch(() => geminiReply(GEMINI_RECIPE));
    const me = await signUp();
    const res = await api(me, "/import", {
      method: "POST",
      body: { url: WATCH },
    });
    const j = (await res.json()) as {
      found: boolean;
      message: string;
      draft: {
        ingredients: { name: string; amount: string }[];
        steps: string[];
        sourceUrl: string;
        videoUrl: string;
      };
    };
    expect(j.found).toBe(true);
    // 材料は投稿者が書いた概要欄のもの（4つ）。Gemini の 2 つではない
    expect(j.draft.ingredients.map((i) => i.name)).toEqual([
      "鶏もも肉",
      "にんにく",
      "米",
      "しょうゆ",
    ]);
    expect(j.draft.steps).toEqual([
      "米を洗う",
      "鶏肉に塩をすり込む",
      "炊飯器で炊く",
    ]);
    expect(j.draft.sourceUrl).toBe(WATCH);
    expect(j.draft.videoUrl).toBe(WATCH);
    expect(j.message).toContain("動画を見て");
    // 文章を読む AI は呼んでいない
    expect(workersAi.run).not.toHaveBeenCalled();

    // 鍵はヘッダーで渡し、URL には入れない。動画の URL と概要欄を渡している
    expect(seen).toHaveLength(1);
    expect(seen[0]!.key).toBe("test-gemini-key");
    expect(seen[0]!.url).not.toContain("test-gemini-key");
    const body = JSON.stringify(seen[0]!.body);
    expect(body).toContain(WATCH);
    expect(body).toContain("鶏もも肉 1枚");
    expect(body).toContain("MEDIA_RESOLUTION_LOW");
  });

  it("鍵が無ければ Gemini は呼ばず、今までどおり文章を読む AI に回す", async () => {
    const workersAi = { run: vi.fn(async () => ({ response: "{}" })) };
    E.AI = workersAi;
    const seen = mockFetch(() => geminiReply(GEMINI_RECIPE));
    const me = await signUp();
    const j = (await (
      await api(me, "/import", { method: "POST", body: { url: WATCH } })
    ).json()) as { draft: { steps: string[] } };
    expect(seen).toHaveLength(0);
    expect(workersAi.run).toHaveBeenCalledTimes(1);
    expect(j.draft.steps).toEqual([]);
  });

  it("Gemini が無料枠切れなら文章を読む AI に回り、それでも駄目なら規則の結果に理由を添える", async () => {
    E.GEMINI_API_KEY = "test-gemini-key";
    const workersAi = {
      run: vi.fn(async () => {
        throw new Error("daily neurons limit exceeded");
      }),
    };
    E.AI = workersAi;
    mockFetch(() => json({ error: { code: 429 } }, 429));
    const me = await signUp();
    const j = (await (
      await api(me, "/import", { method: "POST", body: { url: WATCH } })
    ).json()) as {
      found: boolean;
      message: string;
      draft: { ingredients: unknown[]; steps: unknown[] };
    };
    expect(workersAi.run).toHaveBeenCalledTimes(1);
    expect(j.found).toBe(true);
    expect(j.draft.ingredients).toHaveLength(4);
    expect(j.draft.steps).toEqual([]);
    expect(j.message).toContain("無料分");
  });

  it("Gemini が JSON を返さなければ、文章を読む AI に回す", async () => {
    E.GEMINI_API_KEY = "test-gemini-key";
    const workersAi = {
      run: vi.fn(async () => ({
        response:
          '{"ingredients":[{"name":"米","amount":"2合"}],"steps":["炊く"]}',
      })),
    };
    E.AI = workersAi;
    mockFetch(() => geminiReply("ごめんなさい、分かりませんでした"));
    const me = await signUp();
    const j = (await (
      await api(me, "/import", { method: "POST", body: { url: WATCH } })
    ).json()) as { draft: { steps: string[] } };
    expect(workersAi.run).toHaveBeenCalledTimes(1);
    expect(j.draft.steps).toEqual(["炊く"]);
  });

  it("貼った文章は動画に見せない（文章を読む AI だけ）", async () => {
    E.GEMINI_API_KEY = "test-gemini-key";
    E.AI = {
      run: vi.fn(async () => ({
        response:
          '{"ingredients":[{"name":"米","amount":"2合"}],"steps":["炊く"]}',
      })),
    };
    const seen = mockFetch(() => geminiReply(GEMINI_RECIPE));
    const me = await signUp();
    const res = await api(me, "/import/ai", {
      method: "POST",
      body: {
        url: WATCH,
        text: "米 2合 を炊飯器で炊きます。ダミーの文章です。",
      },
    });
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(0);
  });
});
