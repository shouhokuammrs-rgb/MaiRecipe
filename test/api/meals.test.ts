import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { todayJst } from "../../src/shared/dates";
import { api, signUp } from "./helpers";

// 食べた記録（DEC-030）：本人だけのもの。外食は文字か写真（AI）で入れる
const E = env as unknown as { GEMINI_API_KEY?: string; AI?: unknown };
beforeEach(() => {
  delete E.AI;
});
afterEach(() => {
  delete E.GEMINI_API_KEY;
  vi.restoreAllMocks();
});

type Meal = {
  id: string;
  date: string;
  meal: string | null;
  kind: string;
  title: string;
  portion: number;
  kcal: number | null;
};
const list = async (c: string, from = todayJst(), to = todayJst()) =>
  (
    (await (await api(c, `/meals?from=${from}&to=${to}`)).json()) as {
      meals: Meal[];
    }
  ).meals;

describe("食べた記録", () => {
  it("外食を文字で入れ、本人だけに見え、本人だけが消せる", async () => {
    const me = await signUp();
    const other = await signUp();
    const res = await api(me, "/meals", {
      method: "POST",
      body: { date: todayJst(), meal: "lunch", title: "牛丼 並", kcal: 650 },
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(await list(me)).toEqual([
      expect.objectContaining({
        id,
        meal: "lunch",
        kind: "outside",
        title: "牛丼 並",
        portion: 1,
        kcal: 650,
      }),
    ]);
    expect(await list(other)).toEqual([]);
    expect(
      (await api(other, `/meals/${id}`, { method: "DELETE" })).status,
    ).toBe(404);
    expect((await api(me, `/meals/${id}`, { method: "DELETE" })).status).toBe(
      204,
    );
    expect(await list(me)).toEqual([]);
  });

  it("過ぎた日にも入れられるが、未来と 62 日より前には入れられない", async () => {
    const me = await signUp();
    const post = (date: string) =>
      api(me, "/meals", { method: "POST", body: { date, title: "x" } });
    expect((await post("2026-01-01")).status).toBe(400);
    expect((await post("2099-01-01")).status).toBe(400);
    expect((await post("2026-13-01")).status).toBe(400);
  });

  it("写真から料理名と概算カロリーを読む（保存はしない。写真も残さない）", async () => {
    E.GEMINI_API_KEY = "k";
    const me = await signUp();
    let sent = "";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      sent = await new Response(init?.body as BodyInit).text();
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: '{"title":"牛丼 並","kcal":650,"items":["牛丼","味噌汁"]}',
                  },
                ],
              },
              finishReason: "STOP",
            },
          ],
        }),
      );
    });
    const res = await api(me, "/meals/photo", {
      method: "POST",
      raw: "/9j/AAAAAAAA",
      headers: { "content-type": "text/plain" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      title: "牛丼 並",
      kcal: 650,
      items: ["牛丼", "味噌汁"],
    });
    expect(sent).toContain("inline_data");
    expect(await list(me)).toEqual([]);
  });

  it("AI の鍵が無ければ 503", async () => {
    const me = await signUp();
    const res = await api(me, "/meals/photo", {
      method: "POST",
      raw: "/9j/AAAAAAAA",
      headers: { "content-type": "text/plain" },
    });
    expect(res.status).toBe(503);
  });
});
