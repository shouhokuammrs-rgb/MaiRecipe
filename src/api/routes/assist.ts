// お料理アシスタント（#26）。料理中の相談に、今のレシピと手順を踏まえて答える。
// レシピはセッションのグループからだけ読む（forGroup。クライアントの送ったレシピ本文は使わない）。
// 保存はしない。計量の換算は画面側で AI なしに答えるので、ここに来るのは AI が要る相談だけ
import { Hono } from "hono";
import { assistInputSchema } from "../../shared/assist";
import {
  AiBadOutput,
  AiQuotaExceeded,
  AiUnavailable,
  assistCooking,
} from "../ai";
import type { AppEnv } from "../app-env";
import { badRequest } from "../errors";

export const assist = new Hono<AppEnv>();

assist.post("/", async (c) => {
  const parsed = assistInputSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) return badRequest(c, parsed.error);
  const input = parsed.data;
  if (!c.env.AI && !c.env.GEMINI_API_KEY)
    return c.json({ error: "今は AI を使えない設定です。" }, 503);

  // 他のグループのレシピなら、ここで「見つからない」になる
  const recipe = await c.var.repo.getRecipe(input.recipeId);
  const v =
    recipe.versions.find((x) => x.id === input.versionId) ??
    recipe.versions[recipe.versions.length - 1]!;

  try {
    const reply = await assistCooking(c.env, {
      title: v.title,
      ingredients: v.ingredients,
      steps: v.steps,
      stepIndex: Math.min(input.stepIndex, Math.max(0, v.steps.length - 1)),
      history: input.history,
      question: input.question,
    });
    return c.json(reply);
  } catch (e) {
    if (e instanceof AiQuotaExceeded)
      return c.json(
        {
          error:
            "AI の無料分の上限に当たりました。少し待ってから聞いてください。",
        },
        429,
      );
    if (e instanceof AiUnavailable)
      return c.json(
        { error: "今は AI につながりません。少し待ってから聞いてください。" },
        503,
      );
    if (e instanceof AiBadOutput)
      return c.json(
        { error: "うまく答えられませんでした。言い方を変えて聞いてください。" },
        422,
      );
    throw e;
  }
});
