import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { openDb } from "../../src/api/data";
import { canSignUp } from "../../src/api/data/membership";
import { api, signUp } from "./helpers";

// 招待制（DEC-026）：新しいアカウントを作れるのは、招待されたメールの人と、最初の1人だけ
const db = () => openDb((env as unknown as { DB: D1Database }).DB);

describe("canSignUp", () => {
  it("まだ誰もいなければ、最初の1人は作れる", async () => {
    expect(await canSignUp(db(), "first@example.test")).toBe(true);
  });

  it("誰かいれば、招待されていない人は作れない。招待されたメールなら作れる（大文字・空白の違いは無視）", async () => {
    const owner = await signUp();
    expect(await canSignUp(db(), "stranger@example.test")).toBe(false);
    const res = await api(owner, "/group/invites", {
      method: "POST",
      body: { email: "partner@example.test" },
    });
    expect(res.status).toBe(201);
    expect(await canSignUp(db(), " Partner@Example.test ")).toBe(true);
    expect(await canSignUp(db(), "stranger@example.test")).toBe(false);
  });
});

describe("アカウントを作るときの見張り（Better Auth）", () => {
  it("本番の設定（DEV_LOGIN なし）では、招待されていない人のアカウントは作られない", async () => {
    const { createAuth } = await import("../../src/api/auth");
    const E = env as unknown as Parameters<typeof createAuth>[0];
    await signUp(); // 誰かがいる状態
    const ctx = await createAuth({ ...E, DEV_LOGIN: undefined }).$context;
    const stranger = await ctx.internalAdapter
      .createUser({
        email: "nobody@example.test",
        name: "x",
        emailVerified: true,
      })
      .catch(() => null);
    expect(stranger).toBeNull();
    const rows = await db().query.user.findMany();
    expect(rows.some((u) => u.email === "nobody@example.test")).toBe(false);
  });
});
