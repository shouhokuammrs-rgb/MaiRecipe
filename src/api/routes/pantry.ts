import { Hono } from "hono";
import { todayJst } from "../../shared/dates";
import { pantryAddSchema, pantryPatchSchema } from "../../shared/pantry";
import type { AppEnv } from "../app-env";
import { badRequest } from "../errors";

export const pantry = new Hono<AppEnv>();

pantry.get("/", async (c) => {
  return c.json({ items: await c.var.repo.listPantry(), today: todayJst() });
});

pantry.post("/", async (c) => {
  const parsed = pantryAddSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) return badRequest(c, parsed.error);
  return c.json(await c.var.repo.addPantry(parsed.data.names, todayJst()));
});

pantry.patch("/:id", async (c) => {
  const parsed = pantryPatchSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) return badRequest(c, parsed.error);
  await c.var.repo.updatePantry(c.req.param("id"), parsed.data);
  return c.body(null, 204);
});

pantry.delete("/:id", async (c) => {
  await c.var.repo.deletePantry(c.req.param("id"));
  return c.body(null, 204);
});
