import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, signUp } from "./helpers";

// 料理本の写真からレシピ（#15）。写真は保存しない。本物の AI は呼ばない
const E = env as unknown as { GEMINI_API_KEY?: string };
afterEach(() => {
  delete E.GEMINI_API_KEY;
  vi.restoreAllMocks();
});

/** JPEG の base64（頭が /9j/）のダミー */
const JPEG = "/9j/" + "A".repeat(2000);
const REPLY = JSON.stringify({
  title: "ダミーの肉じゃが",
  servings: "2人分",
  ingredients: [
    { name: "じゃがいも", amount: "3個" },
    { name: "牛肉", amount: "150g" },
  ],
  steps: ["じゃがいもを切る", "煮る"],
  tips: [{ step: 2, text: "落とし蓋をする" }],
});

const post = (me: string, body: string) =>
  api(me, "/import/photo", {
    method: "POST",
    raw: body,
    headers: { "content-type": "text/plain" },
  });

describe("POST /api/import/photo", () => {
  it("写真を Gemini に見せ、下書きを返す（保存はしない）", async () => {
    E.GEMINI_API_KEY = "k";
    const bodies: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      bodies.push(String(init?.body));
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: REPLY }] } }],
        }),
      );
    });
    const me = await signUp();
    const res = await post(me, JPEG);
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      kind: string;
      found: boolean;
      draft: Record<string, unknown>;
    };
    expect(j.kind).toBe("photo");
    expect(j.found).toBe(true);
    expect(j.draft).toMatchObject({
      title: "ダミーの肉じゃが",
      servings: 2,
      steps: ["じゃがいもを切る", "煮る"],
      tips: [{ step: 2, text: "落とし蓋をする" }],
      sourceUrl: null,
      videoUrl: null,
    });
    // 写真はそのまま Gemini に渡し、鍵は URL に入れない
    expect(bodies[0]).toContain(JPEG);
    expect(bodies[0]).toContain("image/jpeg");
    const list = (await (await api(me, "/recipes")).json()) as {
      recipes: unknown[];
    };
    expect(list.recipes).toEqual([]);
  });

  it("JPEG でない・大きすぎる写真は受け付けない", async () => {
    E.GEMINI_API_KEY = "k";
    const spy = vi.spyOn(globalThis, "fetch");
    const me = await signUp();
    expect((await post(me, "hello")).status).toBe(400);
    expect((await post(me, "/9j/" + "A".repeat(1_500_000))).status).toBe(413);
    expect(spy).not.toHaveBeenCalled();
  });

  it("AI が使えない設定なら 503", async () => {
    const me = await signUp();
    expect((await post(me, JPEG)).status).toBe(503);
  });

  it("ログインしていなければ使えない", async () => {
    const res = await api("", "/import/photo", {
      method: "POST",
      raw: JPEG,
      headers: { "content-type": "text/plain" },
    });
    expect(res.status).toBe(401);
  });
});
