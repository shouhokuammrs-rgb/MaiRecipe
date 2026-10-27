// 作った記録（DEC-030）：自分の評価を付ける・記録を消す
import { Hono } from "hono";
import { ratingSchema } from "../../shared/cooked";
import { addDays, isDate, todayJst } from "../../shared/dates";
import { mealAddSchema } from "../../shared/meals";
import {
  AiBadOutput,
  AiDailyStop,
  AiQuotaExceeded,
  AiUnavailable,
  canWatchVideo,
  PhotoInvalid,
  readMealPhotoWithAi,
} from "../ai";
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

/** 外食・買ったものを入れる。過ぎた日はよいが、未来と 62 日より前は入れない */
meals.post("/", async (c) => {
  const parsed = mealAddSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(c, parsed.error);
  const today = todayJst();
  const { date } = parsed.data;
  if (!isDate(date) || date > today || date < addDays(today, -62))
    return c.json({ error: "日付を確認してください" }, 400);
  const id = await c.var.me.addMeal(parsed.data);
  return c.json({ id }, 201);
});

meals.delete("/:id", async (c) => {
  await c.var.me.deleteMeal(c.req.param("id"));
  return c.body(null, 204);
});

/** 1枚の写真（縮めた JPEG の base64）の上限。約 1MB */
const PHOTO_BASE64_MAX = 1_400_000;

/**
 * 食事の写真から料理名と概算カロリーを読む（押した時だけ。DEC-030）。
 * 写真は保存しない。返すのは案だけで、入れるのは人が確かめてから POST /meals
 */
meals.post("/photo", async (c) => {
  const length = Number(c.req.header("content-length"));
  if (!Number.isInteger(length) || length < 4)
    return c.json({ error: "写真を受け取れませんでした" }, 411);
  if (length > PHOTO_BASE64_MAX)
    return c.json({ error: "写真が大きすぎます。撮り直してください" }, 413);
  const body = c.req.raw.body;
  if (!body) return c.json({ error: "写真を受け取れませんでした" }, 411);
  if (!canWatchVideo(c.env))
    return c.json({ error: "今は写真を読む AI を使えない設定です。" }, 503);
  try {
    return c.json(await readMealPhotoWithAi(c.env, { body, length }));
  } catch (e) {
    if (e instanceof PhotoInvalid)
      return c.json({ error: "JPEG の写真だけ読めます" }, 400);
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
        { error: "写真から料理を読み取れませんでした。手で入れてください。" },
        422,
      );
    throw e;
  }
});
