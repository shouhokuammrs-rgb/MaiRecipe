import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, sampleRecipe, signUp } from "./helpers";

// コツ・ポイント（DEC-024）：手順とは別に持ち、版に残す
const PAGE = `<html><head><title>ダミー</title><script type="application/ld+json">${JSON.stringify(
  {
    "@type": "Recipe",
    name: "ダミーの照り焼き",
    recipeIngredient: ["鶏もも肉 1枚"],
    recipeInstructions: ["切る", "焼く", "煮からめる"],
  },
)}</script></head><body>
  <h2>材料</h2><ul><li>鶏もも肉 1枚</li></ul>
  <h2>コツ・ポイント</h2>
  <p>・手順2では皮目から焼くとパリッとします。</p>
  <p>・タレは焦げやすいので弱火で。</p>
  <h2>関連レシピ</h2><p>宣伝の文</p>
  <script>var x = "スクリプトの文";</script>
</body></html>`;

beforeEach(() => {
  delete (env as unknown as { AI?: unknown }).AI;
});
afterEach(() => vi.restoreAllMocks());

type Tip = { step: number | null; text: string };

describe("コツ・ポイント", () => {
  it("構造化データのあとの「コツ・ポイント」欄を、手順に付けて読む。次の見出しの後は読まない", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(PAGE, { headers: { "content-type": "text/html" } }),
    );
    const me = await signUp();
    const j = (await (
      await api(me, "/import", {
        method: "POST",
        body: { url: "https://example.com/r/1" },
      })
    ).json()) as { draft: { tips: Tip[]; steps: string[] } };
    expect(j.draft.steps).toEqual(["切る", "焼く", "煮からめる"]);
    expect(j.draft.tips).toEqual([
      { step: 2, text: "手順2では皮目から焼くとパリッとします。" },
      { step: null, text: "タレは焦げやすいので弱火で。" },
    ]);
  });

  it("保存したコツは版に残り、渡さなければ前の版のまま。変えるとあゆみに書く", async () => {
    const me = await signUp();
    const tips = [{ step: 1, text: "よく冷やす" }];
    const { id } = (await (
      await api(me, "/recipes", {
        method: "POST",
        body: { ...sampleRecipe, tips },
      })
    ).json()) as { id: string };
    const { videoUrl: _v, sourceUrl: _s, origin: _o, ...fields } = sampleRecipe;
    await api(me, `/recipes/${id}/versions`, {
      method: "POST",
      body: { ...fields, title: "名前を変えた" },
    });
    await api(me, `/recipes/${id}/versions`, {
      method: "POST",
      body: { ...fields, title: "名前を変えた", tips: [] },
    });
    const r = (
      (await (await api(me, `/recipes/${id}`)).json()) as {
        recipe: { versions: { tips: Tip[]; changes: string[] }[] };
      }
    ).recipe;
    expect(r.versions.map((v) => v.tips)).toEqual([tips, tips, []]);
    expect(r.versions[2]!.changes).toContain("コツを直した");
  });

  it("長すぎる・多すぎるコツは受け付けない", async () => {
    const me = await signUp();
    const res = await api(me, "/recipes", {
      method: "POST",
      body: { ...sampleRecipe, tips: [{ step: null, text: "あ".repeat(151) }] },
    });
    expect(res.status).toBe(400);
  });
});
