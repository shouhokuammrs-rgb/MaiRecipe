import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkersAiBinding } from "../../src/api/platform/workers-ai";
import { api, sampleRecipe, signUp } from "./helpers";

// 本物の AI は呼ばない。Gemini は fetch を、Workers AI はバインディングを差し替える
const E = env as unknown as { GEMINI_API_KEY?: string; AI?: WorkersAiBinding };
afterEach(() => {
  delete E.GEMINI_API_KEY;
  delete E.AI;
  vi.restoreAllMocks();
});

const geminiReply = (text: string) =>
  new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
    { headers: { "content-type": "application/json" } },
  );

async function recipeOf(me: string) {
  const res = await api(me, "/recipes", { method: "POST", body: sampleRecipe });
  return ((await res.json()) as { id: string }).id;
}

describe("POST /api/assist（お料理アシスタント）", () => {
  it("今のレシピと手順を踏まえて答え、頼まれた動き（タイマー）も返す", async () => {
    E.GEMINI_API_KEY = "test-gemini-key";
    const bodies: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      bodies.push(String(init?.body));
      return geminiReply(
        '{"answer":"3分のタイマーをかけます。","action":{"type":"timer","seconds":180,"label":"3分"}}',
      );
    });
    const me = await signUp();
    const id = await recipeOf(me);
    const res = await api(me, "/assist", {
      method: "POST",
      body: {
        recipeId: id,
        stepIndex: 1,
        question: "3分のタイマーお願い",
        history: [{ role: "user", text: "前の質問" }],
      },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      answer: "3分のタイマーをかけます。",
      action: { type: "timer", seconds: 180, label: "3分" },
    });
    // レシピはサーバーが読んだものを渡している（材料・今の手順）
    expect(bodies[0]).toContain("鶏むね肉 300g");
    expect(bodies[0]).toContain("今の手順：2. 焼く");
    expect(bodies[0]).toContain("前の質問");
  });

  it("Gemini が上限なら Workers AI で答える", async () => {
    E.GEMINI_API_KEY = "test-gemini-key";
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("{}", { status: 429 }),
    );
    E.AI = {
      run: vi.fn(async () => ({
        response: '{"answer":"アルミホイルで代わりになります。","action":null}',
      })),
    };
    const me = await signUp();
    const id = await recipeOf(me);
    const res = await api(me, "/assist", {
      method: "POST",
      body: { recipeId: id, stepIndex: 0, question: "落とし蓋がない" },
    });
    expect(await res.json()).toEqual({
      answer: "アルミホイルで代わりになります。",
      action: null,
    });
  });

  it("どちらも上限なら 429 で日本語の理由", async () => {
    E.GEMINI_API_KEY = "test-gemini-key";
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("{}", { status: 429 }),
    );
    E.AI = {
      run: vi.fn(async () => {
        throw new Error("daily neurons limit exceeded");
      }),
    };
    const me = await signUp();
    const id = await recipeOf(me);
    const res = await api(me, "/assist", {
      method: "POST",
      body: { recipeId: id, stepIndex: 0, question: "落とし蓋がない" },
    });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toContain("無料分");
  });

  it("ログインしていなければ 401、質問が長すぎれば 400", async () => {
    expect(
      (
        await api(null, "/assist", {
          method: "POST",
          body: { recipeId: "x", stepIndex: 0, question: "a" },
        })
      ).status,
    ).toBe(401);
    const me = await signUp();
    expect(
      (
        await api(me, "/assist", {
          method: "POST",
          body: { recipeId: "x", stepIndex: 0, question: "あ".repeat(301) },
        })
      ).status,
    ).toBe(400);
  });

  it("グループをまたいだ漏れがない：他人のレシピでは聞けず、AI も呼ばない", async () => {
    E.GEMINI_API_KEY = "test-gemini-key";
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => geminiReply('{"answer":"x"}'));
    const owner = await signUp();
    const id = await recipeOf(owner);
    const other = await signUp();
    const res = await api(other, "/assist", {
      method: "POST",
      body: { recipeId: id, stepIndex: 0, question: "これ何人分？" },
    });
    expect(res.status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
  });
});
