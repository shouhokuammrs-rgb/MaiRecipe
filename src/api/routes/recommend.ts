import { Hono } from "hono";
import { addDays, todayJst } from "../../shared/dates";
import { rankRecommendations } from "../../shared/recommend";
import type { AppEnv } from "../app-env";

export const recommend = new Hono<AppEnv>();

/** 冷蔵庫の食材と献立（今日の7日前〜6日後）から、分類ごとのおすすめを点数順に返す */
recommend.get("/", async (c) => {
  const today = todayJst();
  const [recipes, pantry, plans] = await Promise.all([
    c.var.repo.recommendRecipes(),
    c.var.repo.listPantry(),
    c.var.repo.listPlans(addDays(today, -7), addDays(today, 6)),
  ]);
  return c.json({
    ...rankRecommendations(recipes, pantry, plans, today),
    today,
  });
});
