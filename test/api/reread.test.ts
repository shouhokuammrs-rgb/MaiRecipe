import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppBindings } from "../../src/api/app-env";
import { api, sampleRecipe, signUp } from "./helpers";

// 保存済みのレシピを出典から読み直す（裏の読み取り。結果は新しい版として保存する）
type Create = NonNullable<AppBindings["IMPORT_WORKFLOW"]>["create"];
const E = env as unknown as AppBindings;
let create: ReturnType<typeof vi.fn<Create>>;
beforeEach(() => {
  create = vi.fn<Create>(async () => ({}));
  E.IMPORT_WORKFLOW = { create };
});
afterEach(() => {
  delete E.IMPORT_WORKFLOW;
  vi.restoreAllMocks();
});

const newRecipe = async (me: string, body: Record<string, unknown> = {}) =>
  (
    (await (
      await api(me, "/recipes", {
        method: "POST",
        body: { ...sampleRecipe, ...body },
      })
    ).json()) as { id: string }
  ).id;

describe("POST /api/recipes/:id/reread", () => {
  it("保存してある出典の URL で読み直しを始め、どのレシピの読み直しかを残す", async () => {
    const me = await signUp();
    const id = await newRecipe(me);
    const res = await api(me, `/recipes/${id}/reread`, { method: "POST" });
    expect(res.status).toBe(202);
    expect(create.mock.calls[0]![0].params.url).toBe(sampleRecipe.sourceUrl);
    const jobs = (
      (await (await api(me, "/import/jobs")).json()) as {
        jobs: { recipeId: string | null; status: string }[];
      }
    ).jobs;
    expect(jobs).toMatchObject([{ recipeId: id, status: "running" }]);
  });

  it("出典の無いレシピは読み直せない", async () => {
    const me = await signUp();
    const id = await newRecipe(me, { sourceUrl: null, videoUrl: null });
    const res = await api(me, `/recipes/${id}/reread`, { method: "POST" });
    expect(res.status).toBe(422);
    expect(create).not.toHaveBeenCalled();
  });

  it("読み直し中でもレシピは消せる（読み直しも一緒に消える）", async () => {
    const me = await signUp();
    const id = await newRecipe(me);
    await api(me, `/recipes/${id}/reread`, { method: "POST" });
    const del = await api(me, `/recipes/${id}`, { method: "DELETE" });
    expect(del.status).toBe(204);
    const jobs = (
      (await (await api(me, "/import/jobs")).json()) as { jobs: unknown[] }
    ).jobs;
    expect(jobs).toEqual([]);
  });

  it("グループをまたいだ漏れがない：他人のレシピは読み直せない", async () => {
    const owner = await signUp();
    const id = await newRecipe(owner);
    const other = await signUp();
    const res = await api(other, `/recipes/${id}/reread`, { method: "POST" });
    expect(res.status).toBe(404);
    expect(create).not.toHaveBeenCalled();
  });
});
