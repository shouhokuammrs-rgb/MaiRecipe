import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, signUp } from "./helpers";

// 構造化データの材料に (A) の印が無いサイト（クラシルの形のダミー）。ページの材料一覧から印を足す
const LD = {
  "@context": "https://schema.org",
  "@type": "Recipe",
  name: "ダミーのキーマカレー",
  recipeIngredient: [
    "ひき肉 300g",
    "カレー粉 大さじ2",
    "バター 25g",
    "サラダ油 大さじ1",
    "パセリ 適量",
  ],
  recipeInstructions: [
    { "@type": "HowToStep", text: "フライパンに(A)を入れて熱する。" },
    { "@type": "HowToStep", text: "ひき肉を炒める。" },
  ],
};
const PAGE = `<!doctype html><html><head><title>ダミー</title></head><body><article>
  <script type="application/ld+json">${JSON.stringify(LD)}</script>
  <h2>材料（2人前）</h2>
  <ul>
    <li class="it">ひき肉300g</li>
    <li class="it">カレー粉大さじ2</li>
    <li class="it head"><div>(A)</div></li>
    <li class="it sub">バター25g</li>
    <li class="it sub">サラダ油大さじ1</li>
    <li class="it">パセリ適量</li>
  </ul>
  <h2>手順</h2><ol><li>フライパンに(A)を入れて熱する。</li><li>ひき肉を炒める。</li></ol>
</article></body></html>`;

beforeEach(() => {
  delete (env as unknown as { AI?: unknown }).AI;
});
afterEach(() => vi.restoreAllMocks());

describe("ページの材料一覧から (A) を足す", () => {
  it("構造化データの材料に【A】を付ける（(A) の中の行だけ）", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(PAGE, { headers: { "content-type": "text/html" } }),
    );
    const me = await signUp();
    const j = (await (
      await api(me, "/import", {
        method: "POST",
        body: { url: "https://example.com/keema" },
      })
    ).json()) as {
      message: string;
      draft: { ingredients: { name: string }[] };
    };
    expect(j.message).toContain("構造化データ");
    expect(j.draft.ingredients.map((i) => i.name)).toEqual([
      "ひき肉",
      "カレー粉",
      "【A】バター",
      "【A】サラダ油",
      "パセリ",
    ]);
  });
});
