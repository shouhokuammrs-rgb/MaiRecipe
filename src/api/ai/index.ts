// AI の窓口（1つだけ）。画面や API の他の部分は「作業名」で頼み、どの AI を使うかはここの表で決める。
// 費用の見積もり → 上限の判定 → 呼び出し → 使用量の記録、の順をここで通す（DEC-012 / #36）。
// 今は無料枠だけ（Workers AI と Gemini API の無料枠）。上限はそれぞれの会社の側が止める
// （無料のまま枠を超えるとエラーになり、請求は起きない）。
// 使用量は D1 に日ごとの回数で記録し、1日の目安の9割で止める（DEC-025。目安は src/shared/ai-usage.ts）。
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
  GeminiTemporary,
  hasGemini,
  runGeminiText,
  runGeminiVideo,
  type GeminiEnv,
} from "../platform/gemini";
import { runWorkersAi, type WorkersAiBinding } from "../platform/workers-ai";
import { aiMeter } from "../data/usage";
import type { UsageKey } from "../../shared/ai-usage";
import { AiQuotaExceeded } from "../platform/workers-ai";

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
    // 料理中は速さが大事なので、軽いモデルで考える量を最小にする
    model: "gemini-3.6-flash",
    thinkingLevel: "minimal",
    // 考える分も上限に数えられるので、短い答えでも余裕を持たせる
    maxTokens: 4096,
    /** Gemini が使えないときの予備 */
    fallback: "@cf/openai/gpt-oss-120b",
  },
  watch_video: {
    provider: "gemini",
    model: "gemini-3.8-flash",
    // 15分ほどの動画でも手順まで書き切れるように
    maxTokens: 16384,
  },
} as const;

export class AiBadOutput extends Error {}

/** 一時的な失敗のあと、やり直すまで待つ時間 */
const RETRY_WAIT_MS = 3000;
/** これより早く失敗が返ったときだけやり直す（60秒＋3秒＋やり直しの最大150秒で、5分に収まる） */
const RETRY_IF_FAILED_WITHIN_MS = 60_000;

export type AiEnv = { AI?: WorkersAiBinding; DB?: D1Database } & GeminiEnv;

/** 今日の目安の9割に達していたら止めたときのエラー（画面には「上限」として出る） */
export class AiDailyStop extends AiQuotaExceeded {}

/**
 * 目安の9割に達していなければ1回分を数えて true。達していれば false（呼ばない）。
 * 数えるのは呼ぶ前（失敗しても会社側の回数には数えられる）
 */
async function take(env: AiEnv, key: UsageKey): Promise<boolean> {
  const meter = aiMeter(env);
  if (await meter.stopped(key)) return false;
  await meter.record(key);
  return true;
}

async function takeOrThrow(env: AiEnv, key: UsageKey) {
  if (!(await take(env, key)))
    throw new AiDailyStop(
      "今日の AI の無料分の9割を使ったので、止めています。明日また使えます",
    );
}

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
  await takeOrThrow(env, "workers-ai:read_recipe");
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
  const run = async () => {
    await takeOrThrow(env, "gemini:watch_video");
    return runGeminiVideo(
      env,
      task.model,
      buildVideoPrompt(title, description),
      videoUrl,
      task.maxTokens,
    );
  };
  let raw: string;
  const started = Date.now();
  try {
    raw = await run();
  } catch (e) {
    // Gemini 側の一時的な失敗（524 など）は、少し待って1回だけやり直す。
    // 失敗が返るまで長くかかったときはやり直さない（裏の読み取りの1手順は5分まで）
    if (
      !(e instanceof GeminiTemporary) ||
      Date.now() - started > RETRY_IF_FAILED_WITHIN_MS
    )
      throw e;
    await new Promise((r) => setTimeout(r, RETRY_WAIT_MS));
    raw = await run();
  }
  const recipe = parseAiRecipe(raw);
  if (!recipe) throw new AiBadOutput("動画からレシピを読み取れませんでした");
  return recipe;
}

/** 料理中の相談に答える。Gemini が使えなければ Workers AI。読めなければ AiBadOutput */
export async function assistCooking(
  env: AiEnv,
  input: Parameters<typeof buildAssistPrompt>[0],
): Promise<AssistReply & { via: "gemini" | "workers-ai" }> {
  const task = TASKS.cook_assist;
  const { system, user } = buildAssistPrompt(input);
  // Gemini で答えられなければ（上限・不通・読めない返事）、Workers AI に回す
  let reply: AssistReply | null = null;
  let geminiError: unknown = null;
  if (hasGemini(env) && (await take(env, "gemini:cook_assist"))) {
    try {
      reply = parseAssistReply(
        await runGeminiText(
          env,
          task.model,
          system,
          user,
          task.maxTokens,
          task.thinkingLevel,
        ),
      );
    } catch (e) {
      geminiError = e;
    }
  }
  if (reply) return { ...reply, via: "gemini" };
  if (!env.AI && geminiError) throw geminiError;
  await takeOrThrow(env, "workers-ai:cook_assist");
  reply = parseAssistReply(
    await runWorkersAi(env.AI, task.fallback, system, user, 1500),
  );
  if (!reply) throw new AiBadOutput("答えを作れませんでした");
  // どちらが答えたかを返す（遅い・答えが変なときに見分けるため）
  return { ...reply, via: "workers-ai" };
}
