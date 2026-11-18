import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppBindings } from "../../src/api/app-env";
import { forGroup, openDb } from "../../src/api/data";
import {
  runImportJob,
  type ImportJobParams,
} from "../../src/api/routes/import-jobs";
import { api, sampleRecipe, signUp } from "./helpers";

// まとめて読み直す（DEC-037）。Workflow は差し替え、読み取りは runImportJob を直接呼ぶ
type Create = NonNullable<AppBindings["IMPORT_WORKFLOW"]>["create"];
const E = env as unknown as AppBindings & { AI?: unknown };
let create: ReturnType<typeof vi.fn<Create>>;
const run = (p: ImportJobParams) =>
  runImportJob(E, p, forGroup(openDb(E.DB), p.groupId));
beforeEach(() => {
  create = vi.fn<Create>(async () => ({}));
  E.IMPORT_WORKFLOW = { create };
  delete E.AI;
});
afterEach(() => {
  delete E.IMPORT_WORKFLOW;
  vi.restoreAllMocks();
});

const page = (steps: string[]) =>
  `<html><head><title>ダミー</title><script type="application/ld+json">${JSON.stringify(
    {
      "@type": "Recipe",
      name: "ダミーの煮物",
      recipeIngredient: ["大根 1/2本"],
      recipeInstructions: steps,
    },
  )}</script></head><body></body></html>`;
const serve = (steps: string[]) =>
  vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(
      async () =>
        new Response(page(steps), { headers: { "content-type": "text/html" } }),
    );

type Jobs = {
  jobs: { id: string; status: string; recipeId: string | null }[];
  queued: number;
};
const jobsOf = async (me: string) =>
  (await (await api(me, "/import/jobs")).json()) as Jobs;
async function makeRecipe(me: string, n: number, withSource = true) {
  const res = await api(me, "/recipes", {
    method: "POST",
    body: {
      ...sampleRecipe,
      title: "ダミーの煮物",
      ingredients: [{ name: "大根", amount: "1/2本" }],
      steps: ["切る", "煮る"],
      sourceUrl: withSource ? `https://example.com/r/${n}` : null,
      videoUrl: null,
    },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}
const bulk = (me: string, ids: string[]) =>
  api(me, "/recipes/reread", { method: "POST", body: { ids } });

describe("まとめて読み直す", () => {
  it("候補は出典のあるレシピだけ", async () => {
    const me = await signUp();
    const a = await makeRecipe(me, 1);
    await makeRecipe(me, 2, false);
    const r = (await (await api(me, "/recipes/reread")).json()) as {
      recipes: { id: string; title: string; versions: number }[];
    };
    expect(r.recipes.map((x) => x.id)).toEqual([a]);
    expect(r.recipes[0]!.versions).toBe(1);
  });

  it("選んだ分を待ちに入れ、2件ずつ動かす。終わると次が始まる", async () => {
    serve(["切る", "煮る", "盛る"]);
    const me = await signUp();
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push(await makeRecipe(me, i));
    const res = await bulk(me, ids);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ queued: 4, skipped: 0 });
    expect(create).toHaveBeenCalledTimes(2);
    let j = await jobsOf(me);
    expect(j.queued).toBe(2);
    expect(j.jobs.filter((x) => x.status === "running")).toHaveLength(2);

    // 1件終わると、待ちから1件始まる
    await run(create.mock.calls[0]![0].params);
    expect(create).toHaveBeenCalledTimes(3);
    j = await jobsOf(me);
    expect(j.queued).toBe(1);
    expect(j.jobs.filter((x) => x.status === "done")).toHaveLength(1);
  });

  it("読み直した内容が今までの版と同じなら、確かめる一覧に出さない", async () => {
    serve(["切る", "煮る"]);
    const me = await signUp();
    const id = await makeRecipe(me, 1);
    await bulk(me, [id]);
    await run(create.mock.calls[0]![0].params);
    const j = await jobsOf(me);
    expect(j.jobs).toEqual([]);
    expect(j.queued).toBe(0);
  });

  it("同じレシピを二重に待ちに入れない。出典の無いレシピは飛ばす", async () => {
    const me = await signUp();
    const a = await makeRecipe(me, 1);
    const b = await makeRecipe(me, 2, false);
    expect(await (await bulk(me, [a, b])).json()).toEqual({
      queued: 1,
      skipped: 1,
    });
    expect(await (await bulk(me, [a])).json()).toEqual({
      queued: 0,
      skipped: 1,
    });
  });

  it("待ちを止められる（動いているものはそのまま）", async () => {
    const me = await signUp();
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push(await makeRecipe(me, i));
    await bulk(me, ids);
    const res = await api(me, "/recipes/reread", { method: "DELETE" });
    expect(res.status).toBe(204);
    const j = await jobsOf(me);
    expect(j.queued).toBe(0);
    expect(j.jobs.filter((x) => x.status === "running")).toHaveLength(2);
  });

  it("グループをまたいだ漏れがないこと：ほかの家のレシピは待ちに入らず、ほかの家の待ちは始めない", async () => {
    const a = await signUp();
    const b = await signUp();
    const mine = await makeRecipe(a, 1);
    const res = await bulk(b, [mine]);
    expect(await res.json()).toEqual({ queued: 0, skipped: 1 });
    expect(create).not.toHaveBeenCalled();
    expect((await jobsOf(a)).queued).toBe(0);

    // a の待ちは、b が読み取りを見に行っても始まらない
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push(await makeRecipe(a, 10 + i));
    await bulk(a, ids);
    const before = create.mock.calls.length;
    await jobsOf(b);
    expect(create.mock.calls.length).toBe(before);
    expect((await jobsOf(b)).jobs).toEqual([]);
  });

  it("おかしな入力は弾く", async () => {
    const me = await signUp();
    expect((await bulk(me, [])).status).toBe(400);
    expect((await bulk(me, Array(201).fill("x"))).status).toBe(400);
  });
});
