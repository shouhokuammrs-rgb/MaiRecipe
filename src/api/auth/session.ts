// ログイン必須のミドルウェア。セッションからユーザーとグループを決め、
// そのグループに閉じた repo（forGroup）だけをルートに渡す。
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../app-env";
import { getSessionUser } from "./index";
import { forGroup, openDb, resolveGroupId } from "../data";

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const user = await getSessionUser(c.env, c.req.raw.headers);
  if (!user) return c.json({ error: "ログインしてください" }, 401);
  const db = openDb(c.env.DB);
  const groupId = await resolveGroupId(db, user.id, user.name);
  c.set("userId", user.id);
  c.set("user", {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified === true,
  });
  c.set("repo", forGroup(db, groupId));
  await next();
});
