// 裏で進める取り込み（DEC-022）。長い動画は読み取りに数分かかるので、
// URL を受け取ったらすぐ返し、読み取りは Workflow（src/api/platform/import-workflow.ts）が進める。
// 画面は GET で様子を見て、読めたら下書きを確かめて保存する。
// グループはセッションからだけ決める（c.var.groupId）。DB は forGroup 経由だけ
import { Hono } from "hono";
import { importSchema } from "../../shared/recipe";
import type { AppBindings, AppEnv } from "../app-env";
import type { GroupRepo } from "../data";
import { badRequest } from "../errors";
import { importFromUrl } from "./importer";

export type ImportJobParams = { jobId: string; groupId: string; url: string };

/** 1つの手順を実行する口（Workflow なら step.do、無いときはその場で実行） */
export type RunStep = <T>(name: string, fn: () => Promise<T>) => Promise<T>;
const inline: RunStep = (_name, fn) => fn();

/**
 * 読み取りの本体。Workflow からも、Workflow が無いときのその場の実行からも使う。
 * 結果は渡された repo（そのグループに閉じたもの）にだけ入れる
 */
export async function runImportJob(
  env: AppBindings,
  p: ImportJobParams,
  repo: Pick<GroupRepo, "finishImportJob">,
  step: RunStep = inline,
): Promise<void> {
  let outcome: { result: unknown } | { error: string };
  try {
    const result = await step("read", () => importFromUrl(env, p.url));
    outcome = { result };
  } catch {
    outcome = { error: "読み取れませんでした。もう一度試してください。" };
  }
  await step("save", async () => {
    await repo.finishImportJob(p.jobId, outcome);
    return true;
  });
}

export const importJobs = new Hono<AppEnv>();

importJobs.post("/", async (c) => {
  const parsed = importSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(c, parsed.error);
  const url = parsed.data.url;
  const jobId = await c.var.repo.createImportJob(url, c.var.userId);
  if (!jobId)
    return c.json(
      {
        error:
          "読み取り中のものが多すぎます。終わってからもう一度入れてください。",
      },
      429,
    );
  const params: ImportJobParams = { jobId, groupId: c.var.groupId, url };
  if (c.env.IMPORT_WORKFLOW) {
    await c.env.IMPORT_WORKFLOW.create({ id: jobId, params });
  } else {
    // Workflow が無い環境（テスト・一部のローカル）では、返したあとに続けて読む
    c.executionCtx.waitUntil(runImportJob(c.env, params, c.var.repo));
  }
  return c.json({ id: jobId }, 202);
});

importJobs.get("/", async (c) =>
  c.json({ jobs: await c.var.repo.listImportJobs() }),
);

importJobs.delete("/:id", async (c) => {
  await c.var.repo.deleteImportJob(c.req.param("id"));
  return c.body(null, 204);
});
