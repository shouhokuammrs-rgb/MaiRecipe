import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkersAiBinding } from "../../src/api/platform/workers-ai";
import { api, sampleRecipe, signUp } from "./helpers";

// メモから変更案（#23 / DEC-027）。本物の AI は呼ばない
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

async function recipeWithMemo(me: string, text = "砂糖は半分でいい") {
  const { id } = (await (
    await api(me, "/recipes", { method: "POST", body: sampleRecipe })
  ).json()) as { id: string };
  const { id: memoId } = (await (
    await api(me, `/recipes/${id}/memos`, { method: "POST", body: { text } })
  ).json()) as { id: string };
  return { id, memoId };
}

const REPLY = JSON.stringify({
  changes: [
    {
      kind: "ingredient",
      action: "update",
      index: 4,
      name: "砂糖",
      amount: "大さじ1",
      reason: "甘さ控えめ",
      quote: "砂糖は半分",
    },
  ],
});

describe("POST /api/recipes/:id/memos/:memoId/suggest", () => {
  it("今の版とメモを AI に渡し、確かめた変更案を返す（保存はしない）", async () => {
    E.GEMINI_API_KEY = "k";
    const bodies: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      bodies.push(String(init?.body));
      return geminiReply(REPLY);
    });
    const me = await signUp();
    const { id, memoId } = await recipeWithMemo(me);
    const res = await api(me, `/recipes/${id}/memos/${memoId}/suggest`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      changes: { kind: string; grounded: boolean; amount: string }[];
    };
    expect(j.changes).toMatchObject([
      { kind: "ingredient", amount: "大さじ1", grounded: true },
    ]);
    expect(bodies[0]).toContain("砂糖は半分でいい");
    expect(bodies[0]).toContain("4. 砂糖 大さじ2");
    // 版は増えていない
    const r = (
      (await (await api(me, `/recipes/${id}`)).json()) as {
        recipe: { versions: unknown[] };
      }
    ).recipe;
    expect(r.versions).toHaveLength(1);
  });

  it("Gemini が駄目なら Workers AI に回す", async () => {
    E.GEMINI_API_KEY = "k";
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("busy", { status: 503 }),
    );
    const run = vi.fn(async () => ({ response: REPLY }));
    E.AI = { run };
    const me = await signUp();
    const { id, memoId } = await recipeWithMemo(me);
    const res = await api(me, `/recipes/${id}/memos/${memoId}/suggest`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("AI が使えない設定なら 503", async () => {
    const me = await signUp();
    const { id, memoId } = await recipeWithMemo(me);
    const res = await api(me, `/recipes/${id}/memos/${memoId}/suggest`, {
      method: "POST",
    });
    expect(res.status).toBe(503);
  });

  it("グループをまたいだ漏れがない：他人のレシピ・メモでは頼めない", async () => {
    E.GEMINI_API_KEY = "k";
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => geminiReply(REPLY));
    const owner = await signUp();
    const { id, memoId } = await recipeWithMemo(owner);
    const other = await signUp();
    const res = await api(other, `/recipes/${id}/memos/${memoId}/suggest`, {
      method: "POST",
    });
    expect(res.status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
    // 自分のレシピに、他人のメモの id を付けても読めない
    const mine = await recipeWithMemo(other, "自分のメモ");
    const res2 = await api(
      other,
      `/recipes/${mine.id}/memos/${memoId}/suggest`,
      { method: "POST" },
    );
    expect(res2.status).toBe(404);
  });
});
