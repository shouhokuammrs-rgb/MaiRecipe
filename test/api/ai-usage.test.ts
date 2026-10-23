import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkersAiBinding } from "../../src/api/platform/workers-ai";
import { AI_BUDGETS, STOP_RATIO, usageDay } from "../../src/shared/ai-usage";
import { api, sampleRecipe, signUp } from "./helpers";

// AI の使用量（DEC-025）：日ごとの回数を数え、目安の9割で止める
const E = env as unknown as {
  GEMINI_API_KEY?: string;
  AI?: WorkersAiBinding;
  DB: D1Database;
};
afterEach(async () => {
  delete E.GEMINI_API_KEY;
  delete E.AI;
  vi.restoreAllMocks();
  await E.DB.prepare("DELETE FROM ai_usage").run();
});

const setUsed = (key: keyof typeof AI_BUDGETS, count: number) =>
  E.DB.prepare(
    "INSERT INTO ai_usage (day, key, count) VALUES (?, ?, ?) ON CONFLICT(day, key) DO UPDATE SET count = excluded.count",
  )
    .bind(usageDay(key), key, count)
    .run();
const stopAt = (key: keyof typeof AI_BUDGETS) =>
  Math.floor(AI_BUDGETS[key].perDay * STOP_RATIO);

type Usage = { items: { key: string; used: number; stopAt: number }[] };

describe("AI の使用量", () => {
  it("呼ぶたびに数え、設定画面用に今日の回数を返す", async () => {
    E.GEMINI_API_KEY = "k";
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: '{"answer":"はい","action":null}' }],
                },
              },
            ],
          }),
        ),
    );
    const me = await signUp();
    const { id } = (await (
      await api(me, "/recipes", { method: "POST", body: sampleRecipe })
    ).json()) as { id: string };
    for (let k = 0; k < 2; k++)
      await api(me, "/assist", {
        method: "POST",
        body: { recipeId: id, stepIndex: 0, question: "どう？", history: [] },
      });
    const u = (await (await api(me, "/ai/usage")).json()) as Usage;
    const item = u.items.find((i) => i.key === "gemini:cook_assist")!;
    expect(item.used).toBe(2);
    expect(item.stopAt).toBe(stopAt("gemini:cook_assist"));
  });

  it("Gemini が9割に達したら、アシスタントは Workers AI に回す", async () => {
    E.GEMINI_API_KEY = "k";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const run = vi.fn(async () => ({
      response: '{"answer":"予備で答えます","action":null}',
    }));
    E.AI = { run };
    await setUsed("gemini:cook_assist", stopAt("gemini:cook_assist"));
    const me = await signUp();
    const { id } = (await (
      await api(me, "/recipes", { method: "POST", body: sampleRecipe })
    ).json()) as { id: string };
    const res = await api(me, "/assist", {
      method: "POST",
      body: { recipeId: id, stepIndex: 0, question: "どう？", history: [] },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { via: string }).via).toBe("workers-ai");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("どちらも9割に達していたら、呼ばずに「今日は止めています」と返す", async () => {
    E.GEMINI_API_KEY = "k";
    const run = vi.fn();
    E.AI = { run };
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await setUsed("gemini:cook_assist", stopAt("gemini:cook_assist"));
    await setUsed("workers-ai:cook_assist", stopAt("workers-ai:cook_assist"));
    const me = await signUp();
    const { id } = (await (
      await api(me, "/recipes", { method: "POST", body: sampleRecipe })
    ).json()) as { id: string };
    const res = await api(me, "/assist", {
      method: "POST",
      body: { recipeId: id, stepIndex: 0, question: "どう？", history: [] },
    });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toContain("9割");
    expect(run).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("文章を読む AI も9割で止め、理由を返す", async () => {
    const run = vi.fn();
    E.AI = { run };
    await setUsed("workers-ai:read_recipe", stopAt("workers-ai:read_recipe"));
    const me = await signUp();
    const res = await api(me, "/import/ai", {
      method: "POST",
      body: { text: "材料\n卵 2個\n作り方\n1. 割る\n2. 焼く", title: "卵焼き" },
    });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toContain("9割");
    expect(run).not.toHaveBeenCalled();
  });
});
