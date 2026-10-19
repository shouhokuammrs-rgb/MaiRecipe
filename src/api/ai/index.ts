// AI の窓口（1つだけ）。画面や API の他の部分は「作業名」で頼み、どの AI を使うかはここの表で決める。
// 費用の見積もり → 上限の判定 → 呼び出し → 使用量の記録、の順をここで通す（DEC-012 / #36）。
// 今は Workers AI の無料枠だけ。上限は Cloudflare 側が止める（無料プランは枠を超えるとエラーになり、請求は起きない）。
// 使用量の記録と「9割で止める」見張りは、利用が増えたら D1 に記録して足す（#36 の残り）。
import {
  buildReadPrompt,
  parseAiRecipe,
  type AiRecipe,
} from "../../shared/ai-read";
import { runWorkersAi, type WorkersAiBinding } from "../platform/workers-ai";

export { AiQuotaExceeded, AiUnavailable } from "../platform/workers-ai";

type Provider = "workers-ai";

/** 作業名 → 使う AI。入れ替えはここの1行で済む */
const TASKS = {
  read_recipe: {
    provider: "workers-ai" as Provider,
    model: "@cf/openai/gpt-oss-120b",
    maxTokens: 2000,
  },
} as const;

export class AiBadOutput extends Error {}

export type AiEnv = { AI?: WorkersAiBinding };

/** レシピの文章から材料と手順を読む。読めなければ AiBadOutput */
export async function readRecipeWithAi(
  env: AiEnv,
  source: string,
  title: string,
): Promise<AiRecipe> {
  const task = TASKS.read_recipe;
  const { system, user } = buildReadPrompt(source, title);
  const raw = await runWorkersAi(
    env.AI,
    task.model,
    system,
    user,
    task.maxTokens,
  );
  const recipe = parseAiRecipe(raw);
  if (!recipe) throw new AiBadOutput("レシピを読み取れませんでした");
  return recipe;
}
