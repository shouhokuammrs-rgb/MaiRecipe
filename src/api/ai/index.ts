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
  buildIdeaPrompt,
  parseIdeas,
  type RecipeIdea,
} from "../../shared/ai-idea";
import {
  buildPlanPrompt,
  parsePlanSuggestion,
  type PlanInput,
  type PlanSuggestion,
} from "../../shared/ai-plan";
import {
  buildMemoPrompt,
  parseMemoChanges,
  type MemoChange,
  type MemoRecipe,
} from "../../shared/memo-apply";
import {
  buildReadPrompt,
  buildPhotoPrompt,
  buildVideoPrompt,
  parseAiRecipe,
  type AiRecipe,
} from "../../shared/ai-read";
import {
  GeminiTemporary,
  PhotoUnreadable,
  hasGemini,
  runGeminiText,
  runGeminiImage,
  runGeminiVideo,
  type GeminiEnv,
} from "../platform/gemini";
import { runWorkersAi, type WorkersAiBinding } from "../platform/workers-ai";
import { aiMeter } from "../data/usage";
import type { UsageKey } from "../../shared/ai-usage";
import { AiQuotaExceeded, AiUnavailable } from "../platform/workers-ai";

export { AiQuotaExceeded, AiUnavailable } from "../platform/workers-ai";
export {
  GeminiRateLimited,
  GeminiTemporary,
  PhotoInvalid,
} from "../platform/gemini";

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
  memo_apply: {
    provider: "gemini",
    model: "gemini-3.6-flash",
    thinkingLevel: "low",
    maxTokens: 4096,
    timeoutMs: 30_000,
    fallback: "@cf/openai/gpt-oss-120b",
  },
  plan_suggest: {
    provider: "gemini",
    model: "gemini-3.6-flash",
    thinkingLevel: "low",
    maxTokens: 4096,
    timeoutMs: 30_000,
    fallback: "@cf/openai/gpt-oss-120b",
  },
  recipe_idea: {
    provider: "gemini",
    model: "gemini-3.6-flash",
    thinkingLevel: "low",
    // 3つの案（材料・手順つき）を書き切れるように
    maxTokens: 8192,
    timeoutMs: 30_000,
    fallback: "@cf/openai/gpt-oss-120b",
  },
  read_photo: {
    provider: "gemini",
    model: "gemini-3.6-flash",
    maxTokens: 8192,
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
  return aiMeter(env).take(key);
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
  if (!env.AI) throw new AiUnavailable("Workers AI がつながっていません");
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
  /** 呼ぶ側（裏の読み取り）が待ってやり直すとき true。ここでのすぐのやり直しはしない */
  noQuickRetry = false,
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
      noQuickRetry ||
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
  if (!env.AI) {
    if (geminiError) throw geminiError;
    throw new AiUnavailable("Workers AI がつながっていません");
  }
  if (!(await take(env, "workers-ai:cook_assist")))
    // Gemini が自分の側で失敗していたら、その理由を優先して伝える
    throw (
      geminiError ??
      new AiDailyStop(
        "今日の AI の無料分の9割を使ったので、止めています。明日また使えます",
      )
    );
  reply = parseAssistReply(
    await runWorkersAi(env.AI, task.fallback, system, user, 1500),
  );
  if (!reply) throw new AiBadOutput("答えを作れませんでした");
  // どちらが答えたかを返す（遅い・答えが変なときに見分けるため）
  return { ...reply, via: "workers-ai" };
}

/**
 * メモから、レシピの変更案を出す（#23 / DEC-027）。Gemini が使えなければ Workers AI。
 * 返事は変更案の一覧（確かめ済み）。読めなければ AiBadOutput
 */
export async function suggestMemoChanges(
  env: AiEnv,
  recipe: MemoRecipe,
  memo: string,
): Promise<MemoChange[]> {
  const task = TASKS.memo_apply;
  const { system, user } = buildMemoPrompt(recipe, memo);
  let geminiError: unknown = null;
  if (hasGemini(env) && (await take(env, "gemini:memo_apply"))) {
    try {
      const raw = await runGeminiText(
        env,
        task.model,
        system,
        user,
        task.maxTokens,
        task.thinkingLevel,
        task.timeoutMs,
      );
      const changes = parseMemoChanges(raw, recipe, memo);
      if (changes) return changes;
      // 読めない返事は、予備の AI に回す
      geminiError = new AiBadOutput("変更案を作れませんでした");
    } catch (e) {
      geminiError = e;
    }
  }
  if (!env.AI) {
    if (geminiError) throw geminiError;
    throw new AiUnavailable("AI がつながっていません");
  }
  if (!(await take(env, "workers-ai:memo_apply")))
    throw (
      geminiError ??
      new AiDailyStop(
        "今日の AI の無料分の9割を使ったので、止めています。明日また使えます",
      )
    );
  const changes = parseMemoChanges(
    await runWorkersAi(env.AI, task.fallback, system, user, 2000),
    recipe,
    memo,
  );
  if (!changes) throw new AiBadOutput("変更案を作れませんでした");
  return changes;
}

/** 保存しているレシピから、献立を考えてもらう（#15 / DEC-028）。Gemini がだめなら Workers AI */
export async function suggestPlan(
  env: AiEnv,
  input: PlanInput,
): Promise<PlanSuggestion[]> {
  const task = TASKS.plan_suggest;
  const { system, user } = buildPlanPrompt(input);
  let geminiError: unknown = null;
  if (hasGemini(env) && (await take(env, "gemini:plan_suggest"))) {
    try {
      const out = parsePlanSuggestion(
        await runGeminiText(
          env,
          task.model,
          system,
          user,
          task.maxTokens,
          task.thinkingLevel,
          task.timeoutMs,
        ),
        input,
      );
      if (out) return out;
      geminiError = new AiBadOutput("献立を作れませんでした");
    } catch (e) {
      geminiError = e;
    }
  }
  if (!env.AI) {
    if (geminiError) throw geminiError;
    throw new AiUnavailable("AI がつながっていません");
  }
  if (!(await take(env, "workers-ai:plan_suggest")))
    throw (
      geminiError ??
      new AiDailyStop(
        "今日の AI の無料分の9割を使ったので、止めています。明日また使えます",
      )
    );
  const out = parsePlanSuggestion(
    await runWorkersAi(env.AI, task.fallback, system, user, 2000),
    input,
  );
  if (!out) throw new AiBadOutput("献立を作れませんでした");
  return out;
}

/** 料理本の写真から材料と手順を読む（#15）。写真は保存しない。読めなければ AiBadOutput */
export async function readPhotoWithAi(
  env: AiEnv,
  photo: { body: ReadableStream<Uint8Array>; length: number },
): Promise<AiRecipe> {
  if (!hasGemini(env))
    throw new AiUnavailable("写真を読む AI の鍵がありません");
  const task = TASKS.read_photo;
  await takeOrThrow(env, "gemini:read_photo");
  let raw: string;
  try {
    raw = await runGeminiImage(
      env,
      task.model,
      buildPhotoPrompt(),
      photo,
      task.maxTokens,
    );
  } catch (e) {
    if (e instanceof PhotoUnreadable) throw new AiBadOutput(e.message);
    throw e;
  }
  const recipe = parseAiRecipe(raw);
  if (!recipe) throw new AiBadOutput("写真からレシピを読み取れませんでした");
  return recipe;
}

/** 冷蔵庫の食材から、新しいレシピの案を考えてもらう（#15 / DEC-029）。保存はしない。Gemini がだめなら Workers AI */
export async function suggestRecipeIdeas(
  env: AiEnv,
  input: { use: string[]; others: string[]; wish: string },
): Promise<RecipeIdea[]> {
  const task = TASKS.recipe_idea;
  const { system, user } = buildIdeaPrompt(input);
  let geminiError: unknown = null;
  if (hasGemini(env) && (await take(env, "gemini:recipe_idea"))) {
    try {
      const out = parseIdeas(
        await runGeminiText(
          env,
          task.model,
          system,
          user,
          task.maxTokens,
          task.thinkingLevel,
          task.timeoutMs,
        ),
      );
      if (out?.length) return out;
      geminiError = new AiBadOutput("レシピの案を作れませんでした");
    } catch (e) {
      geminiError = e;
    }
  }
  if (!env.AI) {
    if (geminiError) throw geminiError;
    throw new AiUnavailable("AI がつながっていません");
  }
  if (!(await take(env, "workers-ai:recipe_idea")))
    throw (
      geminiError ??
      new AiDailyStop(
        "今日の AI の無料分の9割を使ったので、止めています。明日また使えます",
      )
    );
  const out = parseIdeas(
    await runWorkersAi(env.AI, task.fallback, system, user, 4000),
  );
  if (!out?.length) throw new AiBadOutput("レシピの案を作れませんでした");
  return out;
}
