import { Hono } from "hono";
import { MEALS, type Meal } from "../../shared/constants";
import { addDays, isDate, todayJst } from "../../shared/dates";
import {
  mealPlanSchema,
  planMoveSchema,
  shoppingMarkSchema,
} from "../../shared/recipe";
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
  const [sources, marks] = await Promise.all([
    c.var.repo.shoppingSources(from, to),
    c.var.repo.shoppingMarks(),
  ]);
  const home = new Map<string, boolean>();
  const bought = new Map<string, boolean>();
  for (const m of marks)
    (m.kind === "home" ? home : bought).set(m.key, m.value);
  const items = aggregateShopping(sources).map((i) => ({
    ...i,
    // 調味料は最初から「家にある」扱い。印を付け直せばそちらが優先
    home: home.has(i.key) ? home.get(i.key)! : i.section === "調味料",
    bought: bought.get(i.key) ?? false,
  }));
  return c.json({ from, to, recipeCount: sources.length, items });
});

shopping.put("/marks", async (c) => {
  const parsed = shoppingMarkSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) return badRequest(c, parsed.error);
  await c.var.repo.setShoppingMark(
    parsed.data.key,
    parsed.data.kind,
    parsed.data.value,
  );
  return c.body(null, 204);
});

shopping.delete("/bought", async (c) => {
  await c.var.repo.clearBought();
  return c.body(null, 204);
});
