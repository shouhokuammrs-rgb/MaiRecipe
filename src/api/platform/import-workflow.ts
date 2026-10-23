// Cloudflare Workflows で、取り込みを裏で進める（DEC-022）。
// 無料プランでも1つの手順の待ち時間に上限がない（CPU は 10ms まで。待つのは数えない）ので、
// 長い動画を Gemini が数分かけて見ても終わりまで待てる。移行するときはここを差し替える
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import type { AppBindings } from "../app-env";
import { forGroup, openDb } from "../data";
import { runImportJob, type ImportJobParams } from "../routes/import-jobs";

export class ImportWorkflow extends WorkflowEntrypoint<
  AppBindings,
  ImportJobParams
> {
  async run(event: WorkflowEvent<ImportJobParams>, step: WorkflowStep) {
    // グループは、セッションから決めて渡されたもの（クライアントの値ではない）
    const repo = forGroup(openDb(this.env.DB), event.payload.groupId);
    await runImportJob(
      this.env,
      event.payload,
      repo,
      (name, fn) =>
        step.do(
          name,
          // 読み取りは1回だけやり直す（AI の無料枠を何度も使わない）
          { retries: { limit: 1, delay: "10 seconds" }, timeout: "5 minutes" },
          // Workflow の手順の結果は JSON にできる値。取り込みの結果はそのまま渡せる
          fn as () => Promise<never>,
        ),
      // Google 側が混んでいるときは、待ってからやり直す（待つ間は CPU を使わない）
      (name, ms) => step.sleep(name, ms),
    );
  }
}
