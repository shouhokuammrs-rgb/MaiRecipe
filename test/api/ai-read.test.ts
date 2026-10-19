import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AiBadOutput,
  AiQuotaExceeded,
  readRecipeWithAi,
} from "../../src/api/ai";
import type { WorkersAiBinding } from "../../src/api/platform/workers-ai";
import { api, signUp } from "./helpers";

// 本物の Workers AI は呼ばない（費用・時間・結果のぶれを避ける）。返事をダミーにする
const RECIPE_JSON =
  '{"title":"小松菜のふわふわ卵炒め","ingredients":[{"name":"小松菜","amount":"1束"},{"name":"卵","amount":"3個"},{"name":"鶏もも肉","amount":"100g"}],"steps":["小松菜を切る","卵を炒めて取り出す","小松菜を炒めて卵を戻す"],"time":"10分"}';
const SOURCE =
  "ダミーの料理動画です。\n【材料（2人分）】\n・小松菜：1束\n・卵：3個\n・しょうゆ：小さじ2";

function stubAi(run: WorkersAiBinding["run"]) {
  const ai = { run: vi.fn(run) };
  (env as unknown as { AI?: WorkersAiBinding }).AI = ai;
  return ai;
}

afterEach(() => {
  delete (env as unknown as { AI?: WorkersAiBinding }).AI;
  vi.restoreAllMocks();
});

describe("AI の窓口（read_recipe）", () => {
  it("chat 形式の返事から材料と手順を読む", async () => {
    const ai = {
      run: vi.fn(async () => ({
        choices: [{ message: { content: RECIPE_JSON } }],
      })),
    };
    const r = await readRecipeWithAi({ AI: ai }, SOURCE, "");
    expect(r.ingredients).toHaveLength(3);
    expect(r.steps).toHaveLength(3);
    // 呼ぶモデルと、出力の上限を十分に取っていること（既定の 256 では切れる）
    const [model, input] = ai.run.mock.calls[0] as unknown as [
      string,
      { max_tokens: number },
    ];
    expect(model).toBe("@cf/openai/gpt-oss-120b");
    expect(input.max_tokens).toBeGreaterThanOrEqual(1500);
  });

  it("無料枠を使い切ったときは AiQuotaExceeded", async () => {
    const ai = {
      run: vi.fn(async () => {
        throw new Error(
          "4006: you have used up your daily free allocation of 10,000 neurons",
        );
      }),
    };
    await expect(
      readRecipeWithAi({ AI: ai }, SOURCE, ""),
    ).rejects.toBeInstanceOf(AiQuotaExceeded);
  });

  it("JSON が返ってこなければ AiBadOutput", async () => {
    const ai = { run: vi.fn(async () => ({ response: "分かりませんでした" })) };
    await expect(
      readRecipeWithAi({ AI: ai }, SOURCE, ""),
    ).rejects.toBeInstanceOf(AiBadOutput);
  });
});

describe("POST /api/import/ai", () => {
  it("ログインしていなければ 401", async () => {
    const res = await api(null, "/import/ai", {
      method: "POST",
      body: { text: SOURCE, url: "https://example.com/r/1" },
    });
    expect(res.status).toBe(401);
  });

  it("貼った文章を AI で読み、元の文に無い材料を知らせる（保存はしない）", async () => {
    const ai = stubAi(async () => ({ response: RECIPE_JSON }));
    const me = await signUp();
    const res = await api(me, "/import/ai", {
      method: "POST",
      body: { text: SOURCE, url: "https://example.com/r/1" },
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      found: boolean;
      draft: { ingredients: unknown[]; sourceUrl: string; title: string };
      notice: string | null;
      message: string;
    };
    expect(j.found).toBe(true);
    expect(j.draft.ingredients).toHaveLength(3);
    expect(j.draft.sourceUrl).toBe("https://example.com/r/1");
    expect(j.notice).toContain("鶏もも肉");
    expect(j.notice).not.toContain("小松菜");
    expect(j.message).toContain("AI");
    expect(ai.run).toHaveBeenCalledTimes(1);
    // 保存はしていない
    const list = (await (await api(me, "/recipes")).json()) as {
      recipes: unknown[];
    };
    expect(list.recipes).toEqual([]);
  });

  it("無料枠切れは 429、AI が使えないときは 503 で、日本語で理由を返す", async () => {
    const me = await signUp();
    stubAi(async () => {
      throw new Error("daily neurons limit exceeded");
    });
    const quota = await api(me, "/import/ai", {
      method: "POST",
      body: { text: SOURCE, url: "https://example.com/r/1" },
    });
    expect(quota.status).toBe(429);
    expect(((await quota.json()) as { error: string }).error).toContain(
      "無料分",
    );

    stubAi(async () => {
      throw new Error("network down");
    });
    const down = await api(me, "/import/ai", {
      method: "POST",
      body: { text: SOURCE, url: "https://example.com/r/1" },
    });
    expect(down.status).toBe(503);
  });

  it("URL も文章も無ければ 400、短すぎる文章は 422（AI を呼ばない）", async () => {
    const ai = stubAi(async () => ({ response: RECIPE_JSON }));
    const me = await signUp();
    expect(
      (await api(me, "/import/ai", { method: "POST", body: {} })).status,
    ).toBe(400);
    expect(
      (
        await api(me, "/import/ai", {
          method: "POST",
          body: { text: "短い", url: "https://example.com/r/1" },
        })
      ).status,
    ).toBe(422);
    expect(ai.run).not.toHaveBeenCalled();
  });
});

describe("URL から AI で読み取る", () => {
  it("ページの本文だけを AI に渡す（script・メニューは渡さない）", async () => {
    const html = `<!doctype html><html><head><title>ダミーの煮物</title>
      <script>var secret = "SCRIPT_TEXT";</script></head><body>
      <nav>メニュー MENU_TEXT</nav>
      <article><p>今日はダミーの煮物です。</p>
      <p>大根 1/2本、しょうゆ 大さじ2 を用意します。</p>
      <p>大根を切って、しょうゆで煮ます。</p></article>
      <footer>FOOTER_TEXT</footer></body></html>`;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(html, { headers: { "content-type": "text/html" } }),
    );
    const ai = stubAi(async () => ({
      response:
        '{"title":"煮物","ingredients":[{"name":"大根","amount":"1/2本"}],"steps":["大根を切る","しょうゆで煮る"]}',
    }));
    const me = await signUp();
    const res = await api(me, "/import/ai", {
      method: "POST",
      body: { url: "https://example.com/nimono" },
    });
    expect(res.status).toBe(200);
    const [, input] = ai.run.mock.calls[0] as unknown as [
      string,
      { messages: { content: string }[] },
    ];
    const user = input.messages[1]!.content;
    expect(user).toContain("大根 1/2本");
    expect(user).not.toContain("SCRIPT_TEXT");
    expect(user).not.toContain("MENU_TEXT");
    const j = (await res.json()) as { draft: { sourceUrl: string } };
    expect(j.draft.sourceUrl).toBe("https://example.com/nimono");
  });
});
