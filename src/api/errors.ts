import type { Context } from "hono";
import type { ZodError } from "zod";
import { Forbidden, NotFound } from "./data";
import { FetchPageError } from "./platform/fetch-page";

export function handleError(err: Error, c: Context) {
  if (err instanceof NotFound) return c.json({ error: "見つかりません" }, 404);
  if (err instanceof Forbidden) return c.json({ error: err.message }, 403);
  if (err instanceof FetchPageError) return c.json({ error: err.message }, 422);
  console.error(err);
  return c.json({ error: "サーバーでエラーが起きました" }, 500);
}

export function badRequest(c: Context, e: ZodError) {
  return c.json(
    {
      error: "入力を確認してください",
      issues: e.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    },
    400,
  );
}
