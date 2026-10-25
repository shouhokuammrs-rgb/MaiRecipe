import { Hono } from "hono";
import { MEALS, type Meal } from "../../shared/constants";
import { addDays, isDate, todayJst } from "../../shared/dates";
import {
  mealPlanSchema,
  planMoveSchema,
  planServingsSchema,
} from "../../shared/recipe";
import { canonicalName } from "../../shared/ingredients";
import {
  isExpiringSoon,
  isSeasoning,
  shoppingHaveSchema,
} from "../../shared/pantry";
import {
  PLAN_RECIPES_MAX,
  planSuggestSchema,
  type PlanInput,
} from "../../shared/ai-plan";
import {
  AiBadOutput,
  AiDailyStop,
  AiQuotaExceeded,
  AiUnavailable,
  suggestPlan,
} from "../ai";
import { aggregateShopping } from "../../shared/shopping";
import type { AppEnv } from "../app-env";
import { badRequest } from "../errors";

export const plans = new Hono<AppEnv>();

plans.get("/", async (c) => {
  const from = c.req.query("from") ?? "";
  const to = c.req.query("to") ?? "";
  if (!isDate(from) || !isDate(to) || from > to || to > addDays(from, 62)) {
    return c.json({ error: "期間を確認してください" }, 400);
  }
  return c.json({
    plans: await c.var.repo.listPlans(from, to),
    today: todayJst(),
  });
});

/** 枠の最後に1品足す（同じレシピが既にあれば何もしない）。古い画面から呼ばれても品が増えるだけ */
plans.put("/", async (c) => {
  const parsed = mealPlanSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(c, parsed.error);
  const { date, meal, recipeId } = parsed.data;
  if (date < todayJst())
    return c.json({ error: "過ぎた日の献立は変えられません" }, 400);
  await c.var.repo.addPlan(date, meal, recipeId);
  return c.body(null, 204);
});

// ↓ items のルートは "/:date/:meal" より先に登録する（DELETE /items/:id が date="items" にも一致するため）
plans.delete("/items/:id", async (c) => {
  await c.var.repo.deletePlanItem(c.req.param("id"), todayJst());
  return c.body(null, 204);
});

plans.put("/items/:id/servings", async (c) => {
  const parsed = planServingsSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) return badRequest(c, parsed.error);
  await c.var.repo.setPlanServings(
    c.req.param("id"),
    parsed.data.servings,
    todayJst(),
  );
  return c.body(null, 204);
});

plans.post("/items/:id/move", async (c) => {
  const parsed = planMoveSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(c, parsed.error);
  await c.var.repo.movePlanItem(
    c.req.param("id"),
    parsed.data.direction,
    todayJst(),
  );
  return c.body(null, 204);
});

plans.delete("/:date/:meal", async (c) => {
  const date = c.req.param("date");
  const meal = c.req.param("meal") as Meal;
  if (!isDate(date) || !MEALS.includes(meal) || date < todayJst())
    return c.json({ error: "入力を確認してください" }, 400);
  await c.var.repo.deletePlan(date, meal);
  return c.body(null, 204);
});

/**
 * 保存しているレシピから、AI に献立を考えてもらう（#15 / DEC-028）。保存はしない（画面で選んで入れる）。
 * レシピ・冷蔵庫・献立はセッションのグループからだけ読む
 */
plans.post("/suggest", async (c) => {
  const parsed = planSuggestSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) return badRequest(c, parsed.error);
  if (!c.env.AI && !c.env.GEMINI_API_KEY)
    return c.json({ error: "今は AI を使えない設定です。" }, 503);
  const { days, meals, wish } = parsed.data;
  const today = todayJst();
  const dates = Array.from({ length: days }, (_, k) => addDays(today, k));
  const [recipes, pantry, recentPlans, planned] = await Promise.all([
    c.var.repo.recommendRecipes(),
    c.var.repo.listPantry(),
    c.var.repo.listPlans(addDays(today, -7), addDays(today, -1)),
    c.var.repo.listPlans(today, dates[dates.length - 1]!),
  ]);
  if (!recipes.length)
    return c.json(
      {
        error:
          "保存しているレシピがまだありません。先にレシピを取り込んでください。",
      },
      422,
    );
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const input: PlanInput = {
    dates,
    meals,
    wish,
    recipes: [...recipes]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, PLAN_RECIPES_MAX)
      .map((r) => ({
        id: r.id,
        title: r.title,
        category: r.category,
        genre: r.genre ?? "",
        ingredients: r.ingredients
          .slice(0, 12)
          .map((i) => canonicalName(i.name))
          .filter((n) => n && !isSeasoning(n))
          .slice(0, 5),
      })),
    // 長くなりすぎないように、期限が近いものから50個まで
    pantry: [...pantry]
      .sort(
        (a, b) =>
          Number(isExpiringSoon(b.expiresOn, today)) -
          Number(isExpiringSoon(a.expiresOn, today)),
      )
      .slice(0, 50)
      .map((p) => ({
        name: p.name,
        soon: isExpiringSoon(p.expiresOn, today),
      })),
    recent: [...new Set(recentPlans.map((p) => p.title))],
    planned: planned.map((p) => ({
      date: p.date,
      meal: p.meal,
      title: p.title,
    })),
  };
  try {
    const suggestions = await suggestPlan(c.env, input);
    return c.json({
      suggestions: suggestions.map((s) => ({
        ...s,
        recipes: s.recipeIds.flatMap((id) => {
          const r = byId.get(id);
          return r ? [{ id, title: r.title, category: r.category }] : [];
        }),
      })),
    });
  } catch (e) {
    if (e instanceof AiDailyStop)
      return c.json(
        { error: "今日の AI の無料分の9割を使ったので、止めています。" },
        429,
      );
    if (e instanceof AiQuotaExceeded)
      return c.json(
        {
          error:
            "AI の無料分の上限に当たりました。少し待ってから試してください。",
        },
        429,
      );
    if (e instanceof AiUnavailable)
      return c.json(
        { error: "今は AI につながりません。少し待ってから試してください。" },
        503,
      );
    if (e instanceof AiBadOutput)
      return c.json(
        { error: "献立を作れませんでした。もう一度試してください。" },
        422,
      );
    throw e;
  }
});

export const shopping = new Hono<AppEnv>();

/**
 * 期間の献立から買い物リストを作る。過ぎた日は入れない（from は今日より前にならない）。
 */
shopping.get("/", async (c) => {
  const today = todayJst();
  const days = Math.min(Math.max(Number(c.req.query("days") ?? 7) || 7, 1), 14);
  const from = today;
  const to = addDays(today, days - 1);
  const [sources, pantry, out, people] = await Promise.all([
    c.var.repo.shoppingSources(from, to),
    c.var.repo.pantryNames(),
    c.var.repo.seasoningsOut(),
    c.var.repo.householdServings(),
  ]);
  // 人数の分かるレシピは、ふだん作る人数に合わせて換算する
  const items = aggregateShopping(sources, people).map((i) => ({
    ...i,
    // 調味料はいつも家にある扱い（「家にない」印が付いたときだけ買う）。ほかは冷蔵庫にあるか
    have: i.section === "調味料" ? !out.has(i.name) : pantry.has(i.name),
  }));
  // 人数の分からないレシピは換算できないので、元の分量のままと知らせる
  const unscaled = [
    ...new Set(sources.filter((s) => !s.servings).map((s) => s.recipeTitle)),
  ];
  return c.json({
    from,
    to,
    recipeCount: sources.length,
    people,
    unscaled,
    items,
  });
});

/** 買い物のチェック。調味料以外は冷蔵庫に入れる／戻す。調味料は「家にない」印を外す／付ける */
shopping.put("/have", async (c) => {
  const parsed = shoppingHaveSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) return badRequest(c, parsed.error);
  const name = canonicalName(parsed.data.name);
  if (!name) return c.json({ error: "名前を確認してください" }, 400);
  if (isSeasoning(name)) {
    await c.var.repo.setSeasoningOut(name, !parsed.data.value);
  } else if (parsed.data.value) {
    await c.var.repo.addPantry([name], todayJst());
  } else {
    await c.var.repo.removePantryByName(name);
  }
  return c.body(null, 204);
});
