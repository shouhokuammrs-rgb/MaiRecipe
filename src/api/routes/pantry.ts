import { Hono } from "hono";
import { todayJst } from "../../shared/dates";
import {
  fridgeSettingsSchema,
  moveIdsSchema,
  pantryAddSchema,
  pantryOrderSchema,
  pantryPatchSchema,
  zoneUndoSchema,
} from "../../shared/pantry";
import type { AppEnv } from "../app-env";
import { badRequest } from "../errors";

export const pantry = new Hono<AppEnv>();

pantry.get("/", async (c) => {
  const [items, settings] = await Promise.all([
    c.var.repo.listPantry(),
    c.var.repo.fridgeSettings(),
  ]);
  return c.json({ items, today: todayJst(), ...settings });
});

const body = async (c: { req: { json: () => Promise<unknown> } }) =>
  c.req.json().catch(() => null);

// まとめて移動（DEC-034）。移す前の状態（undo）を返す
pantry.post("/move", async (c) => {
  const parsed = moveIdsSchema.safeParse(await body(c));
  if (!parsed.success) return badRequest(c, parsed.error);
  return c.json(await c.var.repo.moveZones(parsed.data.ids, parsed.data.zone));
});

// 元に戻す：/move が返した undo をそのまま送る
pantry.post("/restore", async (c) => {
  const parsed = zoneUndoSchema.safeParse(await body(c));
  if (!parsed.success) return badRequest(c, parsed.error);
  await c.var.repo.restoreZones(parsed.data);
  return c.body(null, 204);
});

// 手で並べた順（全部の品の id を上から）
pantry.put("/order", async (c) => {
  const parsed = pantryOrderSchema.safeParse(await body(c));
  if (!parsed.success) return badRequest(c, parsed.error);
  await c.var.repo.setPantryOrder(parsed.data.ids);
  return c.body(null, 204);
});

// 並べ方・室の順番（家で1つ）
pantry.put("/settings", async (c) => {
  const parsed = fridgeSettingsSchema.safeParse(await body(c));
  if (!parsed.success) return badRequest(c, parsed.error);
  return c.json(await c.var.repo.setFridgeSettings(parsed.data));
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
