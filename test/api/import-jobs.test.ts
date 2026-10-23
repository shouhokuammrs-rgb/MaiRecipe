import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppBindings } from "../../src/api/app-env";
import { forGroup, openDb } from "../../src/api/data";
import {
  runImportJob,
  type ImportJobParams,
} from "../../src/api/routes/import-jobs";
import { api, signUp } from "./helpers";

// 裏で進める取り込み（DEC-022）。Workflow は差し替え、読み取りは runImportJob を直接呼んで確かめる
type Create = NonNullable<AppBindings["IMPORT_WORKFLOW"]>["create"];
const E = env as unknown as AppBindings & { AI?: unknown };
let create: ReturnType<typeof vi.fn<Create>>;
/** Workflow と同じく、渡されたグループの repo で読み取る */
const run = (p: ImportJobParams, step?: Parameters<typeof runImportJob>[3]) =>
  runImportJob(E, p, forGroup(openDb(E.DB), p.groupId), step);
beforeEach(() => {
  create = vi.fn<Create>(async () => ({}));
  E.IMPORT_WORKFLOW = { create };
  // 規則だけで読む（AI は呼ばない）
  delete E.AI;
});
afterEach(() => {
  delete E.IMPORT_WORKFLOW;
  vi.restoreAllMocks();
});

const LD_PAGE = `<html><head><title>ダミー</title><script type="application/ld+json">${JSON.stringify(
  {
    "@type": "Recipe",
    name: "ダミーの煮物",
    recipeIngredient: ["大根 1/2本"],
    recipeInstructions: ["切る", "煮る"],
  },
)}</script></head><body></body></html>`;

type Job = {
  id: string;
  url: string;
  status: "running" | "done" | "failed";
  result: { found: boolean; draft: { title: string; steps: string[] } } | null;
  error: string | null;
};
const jobsOf = async (me: string) =>
  ((await (await api(me, "/import/jobs")).json()) as { jobs: Job[] }).jobs;

async function start(me: string, url = "https://example.com/r/1") {
  const res = await api(me, "/import/jobs", { method: "POST", body: { url } });
  expect(res.status).toBe(202);
  return ((await res.json()) as { id: string }).id;
}

describe("POST /api/import/jobs（裏で読み取る）", () => {
  it("すぐ返し、Workflow に渡す。グループはセッションから決める", async () => {
    const me = await signUp();
    const id = await start(me);
    expect(create).toHaveBeenCalledTimes(1);
    const arg = create.mock.calls[0]![0];
    expect(arg.id).toBe(id);
    expect(arg.params.url).toBe("https://example.com/r/1");
    expect(arg.params.groupId).toBeTruthy();
    const jobs = await jobsOf(me);
    expect(jobs).toMatchObject([{ id, status: "running", result: null }]);
  });

  it("読み終えたら結果（下書き）が見られ、消せる", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(LD_PAGE, { headers: { "content-type": "text/html" } }),
    );
    const me = await signUp();
    const id = await start(me);
    await run(create.mock.calls[0]![0].params);
    const [job] = await jobsOf(me);
    expect(job!.status).toBe("done");
    expect(job!.result!.found).toBe(true);
    expect(job!.result!.draft.steps).toEqual(["切る", "煮る"]);
    expect(
      (await api(me, `/import/jobs/${id}`, { method: "DELETE" })).status,
    ).toBe(204);
    expect(await jobsOf(me)).toEqual([]);
  });

  it("読み取りで例外が出たら「読めなかった」として残す", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("network down");
    });
    const me = await signUp();
    await start(me);
    await run(create.mock.calls[0]![0].params, async (_n, fn) => {
      // Workflow の手順として呼ばれる（読み取り → 保存）
      return fn();
    });
    const [job] = await jobsOf(me);
    expect(job!.status).toBe("failed");
  });

  it("長く止まったままの読み取りは「読めなかった」として返す", async () => {
    const me = await signUp();
    const id = await start(me);
    await E.DB.prepare("UPDATE import_jobs SET updated_at = ? WHERE id = ?")
      .bind(Date.now() - 16 * 60_000, id)
      .run();
    const [job] = await jobsOf(me);
    expect(job!.status).toBe("failed");
    expect(job!.error).toContain("時間がかかりすぎた");
  });

  it("同時に読み取れるのは5件まで", async () => {
    const me = await signUp();
    for (let i = 0; i < 5; i++) await start(me, `https://example.com/r/${i}`);
    const res = await api(me, "/import/jobs", {
      method: "POST",
      body: { url: "https://example.com/r/9" },
    });
    expect(res.status).toBe(429);
  });

  it("URL が無ければ 400、ログインしていなければ 401", async () => {
    const me = await signUp();
    expect(
      (await api(me, "/import/jobs", { method: "POST", body: {} })).status,
    ).toBe(400);
    expect((await api(null, "/import/jobs")).status).toBe(401);
  });
});

describe("止まった読み取り・始められなかった読み取り", () => {
  it("止まったまま残ったものは、5件の上限に数えない", async () => {
    const me = await signUp();
    for (let i = 0; i < 5; i++) {
      const id = await start(me, `https://example.com/s/${i}`);
      await E.DB.prepare("UPDATE import_jobs SET updated_at = ? WHERE id = ?")
        .bind(Date.now() - 16 * 60_000, id)
        .run();
    }
    await start(me, "https://example.com/s/new");
  });

  it("Workflow を始められなければ 503 で、読み取り中のまま残さない", async () => {
    create.mockImplementationOnce(async () => {
      throw new Error("workflow down");
    });
    const me = await signUp();
    const res = await api(me, "/import/jobs", {
      method: "POST",
      body: { url: "https://example.com/r/1" },
    });
    expect(res.status).toBe(503);
    const [job] = await jobsOf(me);
    expect(job!.status).toBe("failed");
  });
});

describe("グループをまたいだ漏れがないこと（裏の取り込み）", () => {
  it("他人の読み取りは見えない・消せない・他のグループの id では結果を入れられない", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(LD_PAGE, { headers: { "content-type": "text/html" } }),
    );
    const owner = await signUp();
    const id = await start(owner);
    const ownerParams = create.mock.calls[0]![0].params;
    const other = await signUp();
    await start(other, "https://example.com/other");
    const otherParams = create.mock.calls[1]![0].params;

    expect((await jobsOf(other)).map((j) => j.id)).not.toContain(id);
    await api(other, `/import/jobs/${id}`, { method: "DELETE" });
    expect((await jobsOf(owner)).map((j) => j.id)).toContain(id);

    // 他のグループの id で結果を入れようとしても、持ち主の読み取りは変わらない
    await run({ ...ownerParams, groupId: otherParams.groupId });
    expect((await jobsOf(owner))[0]!.status).toBe("running");
  });
});

describe("動画の取り込みで Google 側が混んでいるとき", () => {
  const WATCH = "https://www.youtube.com/watch?v=abcDEF12345";
  const G = E as unknown as { GEMINI_API_KEY?: string };
  const RECIPE = JSON.stringify({
    title: "ダミー",
    ingredients: [{ name: "卵", amount: "2個" }],
    steps: [
      { text: "割る", at: "0:05" },
      { text: "焼く", at: "0:40" },
    ],
  });
  afterEach(() => {
    delete G.GEMINI_API_KEY;
  });
  /** Gemini の返事を順に返す（最後のものを繰り返す） */
  function mockGemini(replies: (() => Response)[]) {
    let n = 0;
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const u = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      if (u.hostname === "generativelanguage.googleapis.com") {
        calls.push("gemini");
        return replies[Math.min(n++, replies.length - 1)]!();
      }
      return new Response("not found", { status: 404 });
    });
    return calls;
  }
  const busy = () => new Response("busy", { status: 503 });
  const ok = () =>
    new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: RECIPE }] } }],
      }),
    );

  it("少し待ってやり直し、読めたら動画の結果を入れる", async () => {
    G.GEMINI_API_KEY = "k";
    // 1回目の読み取り：中のやり直しも含めて2回とも混雑 → 待って2回目で読める
    const calls = mockGemini([busy, busy, ok]);
    const sleeps: number[] = [];
    const me = await signUp();
    await start(me, WATCH);
    const p = create.mock.calls[0]![0].params;
    await runImportJob(
      E,
      p,
      forGroup(openDb(E.DB), p.groupId),
      undefined,
      async (_n, ms) => {
        sleeps.push(ms);
      },
    );
    expect(sleeps).toEqual([60_000]);
    expect(calls).toHaveLength(3);
    const [job] = await jobsOf(me);
    expect(job!.status).toBe("done");
    expect(job!.result!.draft.steps).toEqual(["割る", "焼く"]);
  }, 30_000);

  it("何回やっても駄目なら、最後はいつもどおり規則の結果にして終える（止まったままにしない）", async () => {
    G.GEMINI_API_KEY = "k";
    mockGemini([busy]);
    const sleeps: number[] = [];
    const me = await signUp();
    await start(me, WATCH);
    const p = create.mock.calls[0]![0].params;
    await runImportJob(
      E,
      p,
      forGroup(openDb(E.DB), p.groupId),
      undefined,
      async (_n, ms) => {
        sleeps.push(ms);
      },
    );
    expect(sleeps).toEqual([60_000, 180_000]);
    const [job] = await jobsOf(me);
    expect(job!.status).toBe("done");
  }, 60_000);
});
