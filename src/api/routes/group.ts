// いっしょに使う人（グループのメンバーと招待）。グループはセッションからだけ決める。
import { Hono } from "hono";
import { inviteSchema } from "../../shared/group";
import type { AppEnv } from "../app-env";
import { badRequest } from "../errors";

export const group = new Hono<AppEnv>();

group.get("/", async (c) => c.json(await c.var.repo.groupInfo(c.var.userId)));

group.post("/invites", async (c) => {
  const parsed = inviteSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(c, parsed.error);
  await c.var.repo.addInvite(parsed.data.email, c.var.user);
  return c.json({ ok: true }, 201);
});

group.delete("/invites/:id", async (c) => {
  await c.var.repo.cancelInvite(c.req.param("id"));
  return c.body(null, 204);
});
