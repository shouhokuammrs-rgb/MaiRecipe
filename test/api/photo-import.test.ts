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
      // 写真は流し込みで送るので、本文は読んでから確かめる
      bodies.push(await new Response(init?.body).text());
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
    const sent = JSON.parse(bodies[0]!) as {
      contents: {
        parts: { inline_data?: { mime_type: string; data: string } }[];
      }[];
    };
    expect(sent.contents[0]!.parts[0]!.inline_data).toEqual({
      mime_type: "image/jpeg",
      data: JPEG,
    });
    const usage = (await (await api(me, "/ai/usage")).json()) as {
      items: { key: string; used: number }[];
    };
    expect(usage.items.find((i) => i.key === "gemini:read_photo")!.used).toBe(
      1,
    );
    const list = (await (await api(me, "/recipes")).json()) as {
      recipes: unknown[];
    };
    expect(list.recipes).toEqual([]);
  });

  it("JPEG の base64 でない写真は、AI の返事を待たずに 400", async () => {
    E.GEMINI_API_KEY = "k";
    // 流し込みを読み切ろうとして、止められる
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      await new Response(init?.body).text();
      return new Response("{}");
    });
    const me = await signUp();
    expect((await post(me, "hello")).status).toBe(400);
    // JSON に別の値を差し込もうとする文字
    expect((await post(me, '/9j/AAA"},"x":"y')).status).toBe(400);
  });

  it("大きすぎる写真は、読む前に 413", async () => {
    E.GEMINI_API_KEY = "k";
    const spy = vi.spyOn(globalThis, "fetch");
    const me = await signUp();
    const res = await api(me, "/import/photo", {
      method: "POST",
      raw: JPEG,
      headers: { "content-type": "text/plain", "content-length": "1500000" },
    });
    expect(res.status).toBe(413);
    expect(spy).not.toHaveBeenCalled();
  });

  it("Gemini が書き写しすぎ（RECITATION）で止めたら、撮り直しを勧める 422", async () => {
    E.GEMINI_API_KEY = "k";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      await new Response(init?.body).text();
      return new Response(
        JSON.stringify({ candidates: [{ finishReason: "RECITATION" }] }),
      );
    });
    const me = await signUp();
    const res = await post(me, JPEG);
    expect(res.status).toBe(422);
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
