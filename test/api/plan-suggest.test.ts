import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, todayJst } from "../../src/shared/dates";
import { api, sampleRecipe, signUp } from "./helpers";

// AI に献立を考えてもらう（#15 / DEC-028）。本物の AI は呼ばない
const E = env as unknown as { GEMINI_API_KEY?: string; AI?: unknown };
beforeEach(() => {
  delete E.AI;
});
afterEach(() => {
  delete E.GEMINI_API_KEY;
  vi.restoreAllMocks();
});

const gemini = (text: string) =>
  new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
  );

async function recipe(me: string, title: string, category = "主菜") {
  return (
    (await (
      await api(me, "/recipes", {
        method: "POST",
        body: { ...sampleRecipe, title, category },
      })
    ).json()) as { id: string }
  ).id;
}

const suggest = (me: string, body: unknown) =>
  api(me, "/plans/suggest", { method: "POST", body });

describe("POST /api/plans/suggest", () => {
  it("保存しているレシピの番号で返った案を、レシピに戻して返す（保存はしない）", async () => {
    E.GEMINI_API_KEY = "k";
    const me = await signUp();
    const karaage = await recipe(me, "ダミーの唐揚げ");
    const tonjiru = await recipe(me, "ダミーの豚汁", "汁物");
    const today = todayJst();
    const bodies: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      bodies.push(String(init?.body));
      return gemini(
        JSON.stringify({
          plan: [
            {
              date: today,
              meal: "dinner",
              items: [2, 1],
              reason: "揚げ物と汁物",
            },
            { date: addDays(today, 30), meal: "dinner", items: [1] },
          ],
        }),
      );
    });
    const res = await suggest(me, { days: 2, meals: ["dinner"], wish: "" });
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      suggestions: {
        date: string;
        meal: string;
        reason: string;
        recipes: { id: string; title: string }[];
      }[];
    };
    expect(j.suggestions).toHaveLength(1);
    const sug = j.suggestions[0]!;
    expect(sug).toMatchObject({
      date: today,
      meal: "dinner",
      reason: "揚げ物と汁物",
    });
    // 番号 1・2 は保存しているレシピ（どちらが1かは並び順しだい）
    expect(sug.recipes.map((r) => r.id).sort()).toEqual(
      [karaage, tonjiru].sort(),
    );
    expect(sug.recipes.map((r) => r.title).sort()).toEqual(
      ["ダミーの唐揚げ", "ダミーの豚汁"].sort(),
    );
    // AI には番号で渡し、id は渡さない
    expect(bodies[0]).toContain("ダミーの唐揚げ");
    expect(bodies[0]).not.toContain(karaage);
    const plans = (await (
      await api(me, `/plans?from=${today}&to=${today}`)
    ).json()) as { plans: unknown[] };
    expect(plans.plans).toEqual([]);
  });

  it("レシピが無ければ 422、AI が使えない設定なら 503、日数は 1〜7", async () => {
    const me = await signUp();
    expect((await suggest(me, { days: 3, meals: ["dinner"] })).status).toBe(
      503,
    );
    E.GEMINI_API_KEY = "k";
    expect((await suggest(me, { days: 3, meals: ["dinner"] })).status).toBe(
      422,
    );
    expect((await suggest(me, { days: 8, meals: ["dinner"] })).status).toBe(
      400,
    );
  });

  it("グループをまたいだ漏れがない：他人のレシピは AI に渡さない", async () => {
    E.GEMINI_API_KEY = "k";
    const owner = await signUp();
    await recipe(owner, "ひみつの煮込み");
    const other = await signUp();
    await recipe(other, "自分のカレー");
    const bodies: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      bodies.push(String(init?.body));
      return gemini('{"plan":[]}');
    });
    const res = await suggest(other, { days: 1, meals: ["dinner"] });
    expect(res.status).toBe(200);
    expect(bodies[0]).toContain("自分のカレー");
    expect(bodies[0]).not.toContain("ひみつの煮込み");
  });
});
