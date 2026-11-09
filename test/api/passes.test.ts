import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { openDb } from "../../src/api/data";
import { canSignUp } from "../../src/api/data/membership";
import { api, sampleRecipe, signUp, signUpAs } from "./helpers";

// 別々に使う人の招待（DEC-031）：グループには入れず、アカウントを作れるようにするだけ
const db = () => openDb((env as unknown as { DB: D1Database }).DB);

describe("別々に使う人の招待", () => {
  it("招待したメールはアカウントを作れる。グループの招待には出ない", async () => {
    const owner = await signUp();
    expect(await canSignUp(db(), "mom@example.test")).toBe(false);
    const res = await api(owner, "/passes", {
      method: "POST",
      body: { email: " Mom@Example.test " },
    });
    expect(res.status).toBe(201);
    expect(await canSignUp(db(), "mom@example.test")).toBe(true);
    const g = await (await api(owner, "/group")).json<{ invites: unknown[] }>();
    expect(g.invites).toHaveLength(0);
  });

  it("自分が招待した人だけ一覧に出る。使い始めたかが分かる", async () => {
    const a = await signUp();
    const b = await signUp();
    await api(a, "/passes", {
      method: "POST",
      body: { email: "x@example.test" },
    });
    await api(b, "/passes", {
      method: "POST",
      body: { email: "y@example.test" },
    });
    const list = await (
      await api(a, "/passes")
    ).json<{
      passes: { email: string; joined: boolean }[];
    }>();
    expect(list.passes).toEqual([{ email: "x@example.test", joined: false }]);
    await signUpAs("母", "x@example.test");
    const after = await (
      await api(a, "/passes")
    ).json<{
      passes: { email: string; joined: boolean }[];
    }>();
    expect(after.passes).toEqual([{ email: "x@example.test", joined: true }]);
  });

  it("招待した人は、相手のグループのデータを見られない（別々のまま）", async () => {
    const owner = await signUp();
    await api(owner, "/passes", {
      method: "POST",
      body: { email: "m2@example.test" },
    });
    const mom = (await signUpAs("母", "m2@example.test")).cookie;
    await api(mom, "/recipes", {
      method: "POST",
      body: { ...sampleRecipe, title: "母の煮物" },
    });
    const mine = await (
      await api(owner, "/recipes")
    ).json<{
      recipes: { title: string }[];
    }>();
    expect(mine.recipes.some((r) => r.title === "母の煮物")).toBe(false);
  });

  it("取り消すと作れなくなる。他人の招待は取り消せない", async () => {
    const a = await signUp();
    const b = await signUp();
    await api(a, "/passes", {
      method: "POST",
      body: { email: "z@example.test" },
    });
    const other = await api(b, "/passes/z%40example.test", {
      method: "DELETE",
    });
    expect(other.status).toBe(404);
    expect(await canSignUp(db(), "z@example.test")).toBe(true);
    const mine = await api(a, "/passes/z%40example.test", { method: "DELETE" });
    expect(mine.status).toBe(204);
    expect(await canSignUp(db(), "z@example.test")).toBe(false);
  });

  it("1人が招待できるのは5人まで。同じメールは2回入れても1件", async () => {
    const a = await signUp();
    for (let i = 0; i < 5; i++) {
      const r = await api(a, "/passes", {
        method: "POST",
        body: { email: `p${i}@example.test` },
      });
      expect(r.status).toBe(201);
    }
    const dup = await api(a, "/passes", {
      method: "POST",
      body: { email: "p0@example.test" },
    });
    expect(dup.status).toBe(201);
    const over = await api(a, "/passes", {
      method: "POST",
      body: { email: "p9@example.test" },
    });
    expect(over.status).toBe(409);
  });

  it("おかしなメールは弾く", async () => {
    const a = await signUp();
    const r = await api(a, "/passes", {
      method: "POST",
      body: { email: "nope" },
    });
    expect(r.status).toBe(400);
  });
});
