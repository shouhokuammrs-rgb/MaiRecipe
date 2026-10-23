// 裏で進める取り込み（DEC-022）。長い動画は読み取りに数分かかるので、
// URL を受け取ったらすぐ返し、読み取りは Workflow（src/api/platform/import-workflow.ts）が進める。
// 画面は GET で様子を見て、読めたら下書きを確かめて保存する。
// グループはセッションからだけ決める（c.var.groupId）。DB は forGroup 経由だけ
import { Hono } from "hono";
import { importSchema } from "../../shared/recipe";
import type { AppBindings, AppEnv } from "../app-env";
import type { GroupRepo } from "../data";
import { badRequest } from "../errors";
import { ImportRetryLater, importFromUrl } from "./importer";

export type ImportJobParams = { jobId: string; groupId: string; url: string };

/** 1つの手順を実行する口（Workflow なら step.do、無いときはその場で実行） */
export type RunStep = <T>(name: string, fn: () => Promise<T>) => Promise<T>;
/** 待つ口（Workflow なら step.sleep。待っている間は CPU も数えない） */
export type SleepStep = (name: string, ms: number) => Promise<void>;
const inline: RunStep = (_name, fn) => fn();

/**
 * 動画を見る AI が Google 側の混雑などで一時的に失敗したときの、やり直すまでの待ち時間。
 * 1回の読み取りは最悪で約3分（ページ・概要欄の取得 約30秒＋動画を見る 150秒。すぐのやり直しはしない）。
 * 3回＋待ち2分で約11分（読み取り中が15分を超えると止まった扱いになるので、それより短く）
 */
export const RETRY_WAITS_MS = [30_000, 90_000];

type ReadOutcome = { result: unknown } | { retry: string };

/**
 * 読み取りの本体。Workflow からも、Workflow が無いときのその場の実行からも使う。
 * 結果は渡された repo（そのグループに閉じたもの）にだけ入れる。
 * sleep を渡されたとき（Workflow）だけ、一時的な失敗を待ってやり直す
 */
export async function runImportJob(
  env: AppBindings,
  p: ImportJobParams,
  repo: Pick<GroupRepo, "finishImportJob">,
  step: RunStep = inline,
  sleep?: SleepStep,
): Promise<void> {
  let outcome: { result: unknown } | { error: string } | null = null;
  try {
    for (let attempt = 0; outcome === null; attempt++) {
      const canRetry = Boolean(sleep) && attempt < RETRY_WAITS_MS.length;
      const r = await step<ReadOutcome>(
        attempt === 0 ? "read" : `read-${attempt + 1}`,
        async () => {
          try {
            return {
              result: await importFromUrl(env, p.url, {
                retryLater: canRetry,
              }),
            };
          } catch (e) {
            if (e instanceof ImportRetryLater) return { retry: e.message };
            throw e;
          }
        },
      );
      if ("retry" in r)
        await sleep!(`wait-${attempt + 1}`, RETRY_WAITS_MS[attempt]!);
      else outcome = r;
    }
  } catch {
    outcome = { error: "読み取れませんでした。もう一度試してください。" };
  }
  const done = outcome;
  await step("save", async () => {
    await repo.finishImportJob(p.jobId, done);
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
    try {
      await c.env.IMPORT_WORKFLOW.create({ id: jobId, params });
    } catch {
      // 始められなかったら「読み取り中」のまま残さない
      await c.var.repo.finishImportJob(jobId, {
        error: "読み取りを始められませんでした。もう一度試してください。",
      });
      return c.json(
        { error: "読み取りを始められませんでした。もう一度試してください。" },
        503,
      );
    }
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
