// AI の窓口（1つだけ）。画面や API の他の部分は「作業名」で頼み、どの AI を使うかはここの表で決める。
// 費用の見積もり → 上限の判定 → 呼び出し → 使用量の記録、の順をここで通す（DEC-012 / #36）。
// 今は無料枠だけ（Workers AI と Gemini API の無料枠）。上限はそれぞれの会社の側が止める
// （無料のまま枠を超えるとエラーになり、請求は起きない）。
// 使用量の記録と「9割で止める」見張りは、利用が増えたら D1 に記録して足す（#36 の残り）。
import {
  buildAssistPrompt,
  parseAssistReply,
  type AssistReply,
} from "../../shared/assist";
import {
  buildReadPrompt,
  buildVideoPrompt,
  parseAiRecipe,
  type AiRecipe,
} from "../../shared/ai-read";
import {
  hasGemini,
  runGeminiText,
  runGeminiVideo,
  type GeminiEnv,
} from "../platform/gemini";
import { runWorkersAi, type WorkersAiBinding } from "../platform/workers-ai";

export { AiQuotaExceeded, AiUnavailable } from "../platform/workers-ai";

/** 作業名 → 使う AI。入れ替えはここの1行で済む */
const TASKS = {
  read_recipe: {
    provider: "workers-ai",
    model: "@cf/openai/gpt-oss-120b",
    maxTokens: 2000,
  },
  cook_assist: {
    provider: "gemini",
    model: "gemini-3.8-flash",
    maxTokens: 1024,
    /** Gemini が使えないときの予備 */
    fallback: "@cf/openai/gpt-oss-120b",
  },
  watch_video: {
    provider: "gemini",
    model: "gemini-3.8-flash",
    maxTokens: 8192,
  },
} as const;

export class AiBadOutput extends Error {}

export type AiEnv = { AI?: WorkersAiBinding } & GeminiEnv;

/** 動画を見て読む AI が使えるか（鍵が登録されているか） */
export const canWatchVideo = (env: AiEnv) => hasGemini(env);

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

/** YouTube の動画を見て材料と手順を読む（概要欄は手がかりとして添える）。読めなければ AiBadOutput */
export async function watchVideoWithAi(
  env: AiEnv,
  videoUrl: string,
  title: string,
  description: string,
): Promise<AiRecipe> {
  const task = TASKS.watch_video;
  const raw = await runGeminiVideo(
    env,
    task.model,
    buildVideoPrompt(title, description),
    videoUrl,
    task.maxTokens,
  );
  const recipe = parseAiRecipe(raw);
  if (!recipe) throw new AiBadOutput("動画からレシピを読み取れませんでした");
  return recipe;
}

/** 料理中の相談に答える。Gemini が使えなければ Workers AI。読めなければ AiBadOutput */
export async function assistCooking(
  env: AiEnv,
  input: Parameters<typeof buildAssistPrompt>[0],
): Promise<AssistReply> {
  const task = TASKS.cook_assist;
  const { system, user } = buildAssistPrompt(input);
  let raw: string;
  if (hasGemini(env)) {
    try {
      raw = await runGeminiText(env, task.model, system, user, task.maxTokens);
    } catch (e) {
      if (!env.AI) throw e;
      raw = await runWorkersAi(env.AI, task.fallback, system, user, 1500);
    }
  } else {
    raw = await runWorkersAi(env.AI, task.fallback, system, user, 1500);
  }
  const reply = parseAssistReply(raw);
  if (!reply) throw new AiBadOutput("答えを作れませんでした");
  return reply;
}
