import { Hono } from "hono";
import { MEALS, type Meal } from "../../shared/constants";
import { addDays, isDate, todayJst } from "../../shared/dates";
import { mealPlanSchema, planMoveSchema } from "../../shared/recipe";
import { canonicalName } from "../../shared/ingredients";
import { isSeasoning, shoppingHaveSchema } from "../../shared/pantry";
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

export const shopping = new Hono<AppEnv>();

/**
 * 期間の献立から買い物リストを作る。過ぎた日は入れない（from は今日より前にならない）。
 */
shopping.get("/", async (c) => {
  const today = todayJst();
  const days = Math.min(Math.max(Number(c.req.query("days") ?? 7) || 7, 1), 14);
  const from = today;
  const to = addDays(today, days - 1);
  const [sources, pantry, out] = await Promise.all([
    c.var.repo.shoppingSources(from, to),
    c.var.repo.pantryNames(),
    c.var.repo.seasoningsOut(),
  ]);
  const items = aggregateShopping(sources).map((i) => ({
    ...i,
    // 調味料はいつも家にある扱い（「家にない」印が付いたときだけ買う）。ほかは冷蔵庫にあるか
    have: i.section === "調味料" ? !out.has(i.name) : pantry.has(i.name),
  }));
  return c.json({ from, to, recipeCount: sources.length, items });
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
