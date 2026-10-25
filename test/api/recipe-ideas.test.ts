import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_BUDGETS, STOP_RATIO, usageDay } from "../../src/shared/ai-usage";
import { api, signUp } from "./helpers";

// 冷蔵庫の食材から AI にレシピを考えてもらう（#15 / DEC-029）。本物の AI は呼ばない
const E = env as unknown as {
  GEMINI_API_KEY?: string;
  AI?: unknown;
  DB: D1Database;
};
beforeEach(() => {
  delete E.AI;
});
afterEach(async () => {
  delete E.GEMINI_API_KEY;
  delete E.AI;
  vi.restoreAllMocks();
  await E.DB.prepare("DELETE FROM ai_usage").run();
});

const REPLY = JSON.stringify({
  ideas: [
    {
      title: "大根と豚肉のさっと煮",
      category: "主菜",
      genre: "和食",
      servings: "2人分",
      ingredients: [
        { name: "大根", amount: "1/4本" },
        { name: "豚こま肉", amount: "150g" },
      ],
      steps: ["大根を薄く切る", "豚肉と中火で10分煮る"],
    },
  ],
});
const gemini = (text: string) =>
  new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
  );
const ideas = (me: string, body: unknown) =>
  api(me, "/recipes/ideas", { method: "POST", body });

describe("POST /api/recipes/ideas", () => {
  it("選んだ食材と冷蔵庫のほかの食材を渡し、案を返す（保存はしない）", async () => {
    E.GEMINI_API_KEY = "k";
    const me = await signUp();
    await api(me, "/pantry", {
      method: "POST",
      body: { names: ["大根", "豚こま肉", "卵"] },
    });
    const bodies: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      bodies.push(String(init?.body));
      return gemini(REPLY);
    });
    const res = await ideas(me, { use: ["大根", "豚こま肉"], wish: "" });
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      ideas: { title: string; servings: number; category: string }[];
    };
    expect(j.ideas).toMatchObject([
      { title: "大根と豚肉のさっと煮", servings: 2, category: "主菜" },
    ]);
    expect(bodies[0]).toContain("使いたい食材：大根、豚こま肉");
    expect(bodies[0]).toContain("ほかにある食材：卵");
    const list = (await (await api(me, "/recipes")).json()) as {
      recipes: unknown[];
    };
    expect(list.recipes).toEqual([]);
  });

  it("AI が使えない設定なら 503、食材が無ければ 400、読めない返事は 422", async () => {
    const me = await signUp();
    expect((await ideas(me, { use: ["大根"] })).status).toBe(503);
    E.GEMINI_API_KEY = "k";
    expect((await ideas(me, { use: [] })).status).toBe(400);
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      gemini("むり"),
    );
    expect((await ideas(me, { use: ["大根"] })).status).toBe(422);
  });

  it("Gemini が駄目なら Workers AI、どちらも9割なら呼ばずに 429", async () => {
    E.GEMINI_API_KEY = "k";
    const me = await signUp();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response("busy", { status: 503 }));
    const run = vi.fn(async () => ({ response: REPLY }));
    E.AI = { run };
    expect((await ideas(me, { use: ["大根"] })).status).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
    for (const key of ["gemini:recipe_idea", "workers-ai:recipe_idea"] as const)
      await E.DB.prepare(
        "INSERT INTO ai_usage (day, key, count) VALUES (?, ?, ?) ON CONFLICT(day, key) DO UPDATE SET count = excluded.count",
      )
        .bind(
          usageDay(key),
          key,
          Math.floor(AI_BUDGETS[key].perDay * STOP_RATIO),
        )
        .run();
    fetchSpy.mockClear();
    run.mockClear();
    const res = await ideas(me, { use: ["大根"] });
    expect(res.status).toBe(429);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("グループをまたいだ漏れがない：他人の冷蔵庫は AI に渡さない", async () => {
    E.GEMINI_API_KEY = "k";
    const owner = await signUp();
    await api(owner, "/pantry", {
      method: "POST",
      body: { names: ["ひみつのかぶ"] },
    });
    const other = await signUp();
    const bodies: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      bodies.push(String(init?.body));
      return gemini(REPLY);
    });
    expect((await ideas(other, { use: ["大根"] })).status).toBe(200);
    expect(bodies[0]).not.toContain("ひみつのかぶ");
  });

  it("AI が考えたレシピは origin=ai で保存でき、そう返る", async () => {
    const me = await signUp();
    const res = await api(me, "/recipes", {
      method: "POST",
      body: {
        title: "大根と豚肉のさっと煮",
        category: "主菜",
        genre: "和食",
        origin: "ai",
        sourceUrl: null,
        videoUrl: null,
        ingredients: [{ name: "大根", amount: "1/4本" }],
        steps: ["煮る"],
      },
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const r = (await (await api(me, `/recipes/${id}`)).json()) as {
      recipe: { origin: string };
    };
    expect(r.recipe.origin).toBe("ai");
  });
});
