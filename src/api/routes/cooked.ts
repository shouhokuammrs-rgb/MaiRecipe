// 作った記録（DEC-030）：自分の評価を付ける・記録を消す
import { Hono } from "hono";
import { ratingSchema } from "../../shared/cooked";
import { addDays, isDate } from "../../shared/dates";
import type { AppEnv } from "../app-env";
import { badRequest } from "../errors";

export const cooked = new Hono<AppEnv>();

cooked.put("/:id/rating", async (c) => {
  const parsed = ratingSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(c, parsed.error);
  await c.var.repo.rateCooked(
    c.req.param("id"),
    c.var.userId,
    parsed.data.rating,
  );
  return c.body(null, 204);
});

cooked.delete("/:id", async (c) => {
  await c.var.repo.deleteCooked(c.req.param("id"));
  return c.body(null, 204);
});

/** 食べた記録（本人だけ）。forUser 経由 */
export const meals = new Hono<AppEnv>();

meals.get("/", async (c) => {
  const from = c.req.query("from") ?? "";
  const to = c.req.query("to") ?? "";
  if (!isDate(from) || !isDate(to) || from > to || to > addDays(from, 62))
    return c.json({ error: "期間を確認してください" }, 400);
  return c.json({ meals: await c.var.me.listMeals(from, to) });
});
