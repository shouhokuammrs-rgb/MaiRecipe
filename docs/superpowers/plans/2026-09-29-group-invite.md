# パートナーの招待（#14）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設定画面で Google のメールアドレスを入れて招待し、確認済みの本人がログインして参加すると、相手のデータを共有グループへ移して同じレシピ・献立・買い物リストを使えるようにする。

**Architecture:** 招待は `group_invites` テーブル。グループ内の操作（一覧・招待・取り消し）は既存の `forGroup` に足す。グループをまたぐ「自分宛ての招待を読む」「参加する」だけを `src/api/data/membership.ts` に閉じ込め、参加は D1 の batch（1トランザクション）の UPDATE/DELETE で行う。ルートは DB を直接触らない（ESLint）ので、membership も `requireUser` で `c.var.membership` に載せて渡す。

**Tech Stack:** Cloudflare Workers + Hono、D1 + Drizzle、Better Auth、React 19 + TanStack Query + Tailwind v4、Vitest（workers pool）、Playwright

**Spec:** `docs/superpowers/specs/2026-09-29-group-invite-design.md`

## Global Constraints

- グループの判定はセッションからだけ。クライアントから group_id を受け取らない
- DB に触れるのは `src/api/data/` だけ。グループをまたぐのは `membership.ts` だけ（例外として spec.md §6 と CLAUDE.md に明記）
- 招待の照合は `emailVerified === true` のユーザーのメールだけ。メールは `trim().toLowerCase()` で比較
- 上限: メンバー数 + 招待中の数 ≤ 5（自分以外4人）
- 献立の枠・買い物の印・報告がぶつかったら招待した側を残す。献立は keptPlans として返し画面に出す
- Worker の CPU 10ms: 行を Worker で回さず、SQL の UPDATE/DELETE で書き換える
- SQL は普通の書き方（SQLite 独自関数を条件・集計に使わない）。`sql.raw` に値を埋め込まない
- UI: 日本語、375px、タップ 44px 以上、ローディング/エラー/空状態、取り消し・参加は2回押し（confirm を使わない）、色はトークン
- 他人宛ての招待・存在しない招待・未確認メールはすべて 404（招待の有無を教えない）

## Review Focus

1. 大文字・前後空白のメールで招待 → 確認済み本人なら照合できる（Task 1・3 のテスト）
2. 未確認メール（DEV_LOGIN）のユーザーは同じアドレスでも招待が見えない・参加できない（Task 3）
3. 参加前は A⇔B で何も見えない、参加後も無関係な C からは何も見えない（Task 3）
4. 取り消し後・同じ招待の二度目の参加は 404、既に同じグループなら 409（Task 2・3）
5. 参加後、B の元の1人グループは消え、以後のアクセスで新しい1人グループが作られない（Task 3：参加後の `/group` が2人を返す）

---

## File Structure

| ファイル | 役割 |
|---|---|
| `src/shared/group.ts`（新） | `normalizeEmail`・`inviteSchema`・`GROUP_MAX_MEMBERS`・`planSlotLabel` |
| `src/api/data/schema.ts` | `groupInvites` |
| `drizzle/0002_*.sql` | マイグレーション（生成） |
| `src/api/data/index.ts` | `BadInput`・`Conflict`、forGroup に `groupInfo`・`addInvite`・`cancelInvite` |
| `src/api/data/membership.ts`（新） | `membershipFor(db, user)` → `{ invites(), accept(id) }` |
| `src/api/errors.ts` | BadInput → 400、Conflict → 409 |
| `src/api/app-env.ts`・`src/api/auth/session.ts` | `c.var.user`・`c.var.membership` |
| `src/api/routes/group.ts`（新）・`src/api/index.ts` | `/api/group`・`/api/invites` |
| `src/web/api/client.ts` | 型と呼び出し |
| `src/web/pages/Settings.tsx` | 「いっしょに使う人」 |
| `src/web/components/InviteBanner.tsx`（新）・`src/web/pages/Recipes.tsx` | 招待の帯 |
| `src/web/pages/JoinGroup.tsx`（新）・`src/web/main.tsx` | `/invites/:id` |
| `test/shared/group.test.ts`・`test/api/group.test.ts`（新）・`test/api/helpers.ts`・`test/api/recipes.test.ts` | テスト |
| `e2e/invite.spec.ts`（新） | 2人の E2E |
| `docs/spec.md`・`CLAUDE.md` | membership.ts の例外を1行ずつ |

---

### Task 1: 共有の小物（メールの正規化・入力検証・枠の表記）

**Files:** Create `src/shared/group.ts` / Test `test/shared/group.test.ts`

**Interfaces:**
- Produces: `normalizeEmail(raw: string): string`、`inviteSchema`（`{ email }` を正規化してから `email().max(254)`）、`GROUP_MAX_MEMBERS = 5`、`planSlotLabel(date: string, meal: "breakfast"|"lunch"|"dinner"): string`

- [ ] **Step 1: 失敗するテスト**

```ts
import { describe, expect, it } from "vitest";
import {
  GROUP_MAX_MEMBERS,
  inviteSchema,
  normalizeEmail,
  planSlotLabel,
} from "../../src/shared/group";

describe("normalizeEmail", () => {
  it("前後の空白を除いて小文字にする", () => {
    expect(normalizeEmail("  Hanako@Example.COM ")).toBe("hanako@example.com");
  });
});

describe("inviteSchema", () => {
  it("正規化してから検証する", () => {
    expect(inviteSchema.parse({ email: " A@B.jp " })).toEqual({ email: "a@b.jp" });
  });
  it("メールでなければ失敗", () => {
    expect(inviteSchema.safeParse({ email: "abc" }).success).toBe(false);
    expect(inviteSchema.safeParse({}).success).toBe(false);
  });
});

describe("planSlotLabel", () => {
  it("日付と食事を日本語にする", () => {
    expect(planSlotLabel("2026-10-03", "dinner")).toBe("10月3日の夜");
    expect(planSlotLabel("2026-01-15", "breakfast")).toBe("1月15日の朝");
    expect(planSlotLabel("2026-12-01", "lunch")).toBe("12月1日の昼");
  });
});

it("上限は自分を含めて5人", () => {
  expect(GROUP_MAX_MEMBERS).toBe(5);
});
```

- [ ] **Step 2: 失敗を確認** — `npx vitest run test/shared/group.test.ts` → FAIL（モジュールが無い）
- [ ] **Step 3: 実装**

```ts
// グループ（いっしょに使う人）の招待で、画面と API が共有するもの。
import { z } from "zod";

/** 自分を含めたメンバー数 + 招待中の数の上限（自分以外4人。M5 の課金まではこの値で固定） */
export const GROUP_MAX_MEMBERS = 5;

/** 招待・照合のときのメールアドレスの形（前後の空白を除いて小文字） */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export const inviteSchema = z.object({
  email: z.string().transform(normalizeEmail).pipe(z.string().email().max(254)),
});

const MEAL_LABEL = { breakfast: "朝", lunch: "昼", dinner: "夜" } as const;

/** "2026-10-03" + dinner → "10月3日の夜" */
export function planSlotLabel(date: string, meal: keyof typeof MEAL_LABEL): string {
  const [, m, d] = date.split("-").map(Number);
  return `${m}月${d}日の${MEAL_LABEL[meal]}`;
}
```

- [ ] **Step 4: 通ることを確認** — 同じコマンド → PASS
- [ ] **Step 5: Commit** — `git add src/shared/group.ts test/shared/group.test.ts && git commit -m "feat: 招待のメール正規化と入力検証"`

---

### Task 2: 招待テーブルとグループ内の操作（一覧・招待・取り消し）

**Files:**
- Modify `src/api/data/schema.ts`、生成 `drizzle/0002_*.sql`
- Modify `src/api/data/index.ts`、`src/api/errors.ts`、`src/api/app-env.ts`、`src/api/auth/session.ts`
- Create `src/api/routes/group.ts`、Modify `src/api/index.ts`
- Modify `test/api/helpers.ts`、Test `test/api/group.test.ts`

**Interfaces:**
- Consumes: Task 1
- Produces:
  - `export class BadInput extends Error {}`・`export class Conflict extends Error {}`（data/index.ts）
  - `SessionUser = { id: string; name: string; email: string; emailVerified: boolean }`、`AppEnv.Variables.user`
  - forGroup: `groupInfo(userId: string)` → `{ name: string; members: { name: string; isMe: boolean; role: "owner"|"member" }[]; invites: { id: string; email: string }[] }`、`addInvite(email: string, me: SessionUser): Promise<void>`、`cancelInvite(id: string): Promise<void>`
  - テスト用: `signUpAs(name?, email?)` → `{ cookie, email }`、`verifyEmail(email)`

- [ ] **Step 1: テーブル**（schema.ts の末尾）

```ts
// ---- 招待（相手の Google のメールアドレス宛て。参加・取り消しで行を消す）
export const groupInvites = sqliteTable(
  "group_invites",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    /** 小文字・前後の空白なしにそろえたアドレス */
    email: text("email").notNull(),
    invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("group_invites_email_uq").on(t.groupId, t.email),
    index("group_invites_email_idx").on(t.email),
  ],
);
```

Run: `npm run db:generate`

- [ ] **Step 2: テスト用ヘルパー**（helpers.ts。既存の `signUp` はこれを使う形に）

```ts
import { env } from "cloudflare:test";

/** 名前とメールを指定して登録する（メールは省略可）。Cookie と小文字のメールを返す */
export async function signUpAs(name = "テスト", email?: string) {
  n += 1;
  const addr = email ?? `user${Date.now()}-${n}@example.test`;
  const res = await exports.default.fetch(`${ORIGIN}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ email: addr, password: "password-1234", name }),
  });
  if (res.status !== 200)
    throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
  const cookies = res.headers.getSetCookie().map((c) => c.split(";")[0]);
  return { cookie: cookies.join("; "), email: addr.toLowerCase() };
}

export async function signUp(name = "テスト"): Promise<string> {
  return (await signUpAs(name)).cookie;
}

/** テストだけで使う：Google で確認済みの状態にする（本番のコードには抜け道を作らない） */
export async function verifyEmail(email: string): Promise<void> {
  await env.DB.prepare("update user set email_verified = 1 where email = ?").bind(email).run();
}
```

- [ ] **Step 3: 失敗するテスト**（`test/api/group.test.ts`）

```ts
import { describe, expect, it } from "vitest";
import { api, signUpAs, verifyEmail } from "./helpers";

type GroupInfo = {
  name: string;
  members: { name: string; isMe: boolean; role: string }[];
  invites: { id: string; email: string }[];
};
const info = async (cookie: string) => (await (await api(cookie, "/group")).json()) as GroupInfo;
const invite = (cookie: string, email: string) =>
  api(cookie, "/group/invites", { method: "POST", body: { email } });

describe("/api/group（グループ内の操作）", () => {
  it("最初は自分だけ。招待すると正規化したアドレスで招待中に出る。二度目は1件のまま", async () => {
    const a = await signUpAs("A");
    expect((await info(a.cookie)).members).toEqual([{ name: "A", isMe: true, role: "owner" }]);
    expect((await invite(a.cookie, "  Partner@Example.test ")).status).toBe(201);
    expect((await invite(a.cookie, "partner@example.test")).status).toBe(201);
    expect((await info(a.cookie)).invites.map((i) => i.email)).toEqual(["partner@example.test"]);
  });

  it("自分は招待できない（400）。メールでなければ 400", async () => {
    const a = await signUpAs("A");
    expect((await invite(a.cookie, ` ${a.email.toUpperCase()} `)).status).toBe(400);
    expect((await invite(a.cookie, "not-mail")).status).toBe(400);
  });

  it("自分以外4人まで。5人目の招待は 409", async () => {
    const a = await signUpAs("A");
    for (let k = 0; k < 4; k++)
      expect((await invite(a.cookie, `p${k}-${Date.now()}@example.test`)).status).toBe(201);
    expect((await invite(a.cookie, `p5-${Date.now()}@example.test`)).status).toBe(409);
  });

  it("取り消せる。他のグループの招待は取り消せない（404）", async () => {
    const a = await signUpAs("A");
    const c = await signUpAs("C");
    await invite(a.cookie, "x@example.test");
    const id = (await info(a.cookie)).invites[0]!.id;
    expect((await api(c.cookie, `/group/invites/${id}`, { method: "DELETE" })).status).toBe(404);
    expect((await info(a.cookie)).invites).toHaveLength(1);
    expect((await api(a.cookie, `/group/invites/${id}`, { method: "DELETE" })).status).toBe(204);
    expect((await info(a.cookie)).invites).toEqual([]);
  });
});
```

- [ ] **Step 4: 失敗を確認** — `npx vitest run test/api/group.test.ts` → FAIL
- [ ] **Step 5: セッションのユーザー**

`app-env.ts` に `SessionUser` を足し、`Variables: { userId: string; user: SessionUser; repo: GroupRepo }`。
`session.ts` の requireUser に:
```ts
  c.set("user", {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified === true,
  });
```

- [ ] **Step 6: forGroup に3メソッド**（index.ts。`BadInput`・`Conflict` を `NotFound` の隣に export。errors.ts で BadInput→400、Conflict→409、どちらも `{ error: err.message }`）

```ts
    // ---- いっしょに使う人（グループのメンバーと招待）
    async groupInfo(userId: string) {
      const [g, members, invites] = await Promise.all([
        db.select({ name: s.groups.name }).from(s.groups).where(eq(s.groups.id, groupId)).limit(1),
        db
          .select({ id: s.user.id, name: s.user.name, role: s.groupMembers.role })
          .from(s.groupMembers)
          .innerJoin(s.user, eq(s.user.id, s.groupMembers.userId))
          .where(eq(s.groupMembers.groupId, groupId))
          .orderBy(asc(s.groupMembers.createdAt)),
        db
          .select({ id: s.groupInvites.id, email: s.groupInvites.email })
          .from(s.groupInvites)
          .where(eq(s.groupInvites.groupId, groupId))
          .orderBy(asc(s.groupInvites.createdAt)),
      ]);
      return {
        name: g[0]?.name ?? "",
        members: members.map((m) => ({ name: m.name, isMe: m.id === userId, role: m.role })),
        invites,
      };
    },

    /** email は正規化済み。同じ相手への招待は何もしない */
    async addInvite(email: string, me: SessionUser) {
      if (email === normalizeEmail(me.email)) throw new BadInput("自分は招待できません");
      const [members, invites] = await Promise.all([
        db
          .select({ email: s.user.email })
          .from(s.groupMembers)
          .innerJoin(s.user, eq(s.user.id, s.groupMembers.userId))
          .where(eq(s.groupMembers.groupId, groupId)),
        db.select({ email: s.groupInvites.email }).from(s.groupInvites).where(eq(s.groupInvites.groupId, groupId)),
      ]);
      if (members.some((m) => normalizeEmail(m.email) === email))
        throw new Conflict("この人はもうメンバーです");
      if (invites.some((i) => i.email === email)) return;
      if (members.length + invites.length >= GROUP_MAX_MEMBERS)
        throw new Conflict(`いっしょに使えるのは自分以外${GROUP_MAX_MEMBERS - 1}人までです`);
      await db
        .insert(s.groupInvites)
        .values({ id: newId(), groupId, email, invitedBy: me.id })
        .onConflictDoNothing();
    },

    async cancelInvite(id: string) {
      const r = await db
        .delete(s.groupInvites)
        .where(and(eq(s.groupInvites.id, id), eq(s.groupInvites.groupId, groupId)))
        .returning({ id: s.groupInvites.id });
      if (!r.length) throw new NotFound("invite");
    },
```

- [ ] **Step 7: ルート**（`src/api/routes/group.ts`、index.ts に `api.route("/group", group)`）

```ts
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
```

- [ ] **Step 8: 通ることを確認** — `npm run test` → PASS
- [ ] **Step 9: Commit** — `git add -A src/api drizzle test/api && git commit -m "feat: 招待テーブルとグループ内の招待・取り消し"`

---

### Task 3: 自分宛ての招待と参加（membership.ts）＋漏れテスト

**Files:**
- Create `src/api/data/membership.ts`
- Modify `src/api/app-env.ts`・`src/api/auth/session.ts`（`c.var.membership`）、`src/api/routes/group.ts`（`invites` ルーター）、`src/api/index.ts`（`api.route("/invites", invites)`）
- Test `test/api/group.test.ts`（追記）、`test/api/recipes.test.ts`（漏れテストに追記）

**Interfaces:**
- Consumes: Task 1・2
- Produces:
  - `membershipFor(db: Db, user: SessionUser)` → `{ invites(): Promise<{ id: string; groupName: string; invitedBy: string }[]>; accept(inviteId: string): Promise<{ movedRecipes: number; keptPlans: { date: string; meal: "breakfast"|"lunch"|"dinner" }[] }> }`
  - `AppEnv.Variables.membership: ReturnType<typeof membershipFor>`
  - HTTP: `GET /api/invites` → `{ invites }`、`POST /api/invites/:id/accept` → 上の accept の結果

- [ ] **Step 1: 失敗するテスト**（group.test.ts に追記）

```ts
const invitesOf = async (cookie: string) =>
  ((await (await api(cookie, "/invites")).json()) as {
    invites: { id: string; groupName: string; invitedBy: string }[];
  }).invites;
const accept = (cookie: string, id: string) => api(cookie, `/invites/${id}/accept`, { method: "POST" });
const recipe = (title: string) => ({
  title, category: "主菜", genre: "和食", ingredients: [{ name: "卵", amount: "1個" }], steps: ["焼く"],
});
const create = async (cookie: string, title: string) =>
  ((await (await api(cookie, "/recipes", { method: "POST", body: recipe(title) })).json()) as { id: string }).id;
const titles = async (cookie: string) =>
  ((await (await api(cookie, "/recipes")).json()) as { recipes: { title: string }[] }).recipes
    .map((r) => r.title)
    .sort();
const plan = (cookie: string, date: string, recipeId: string) =>
  api(cookie, "/plans", { method: "PUT", body: { date, meal: "dinner", recipeId } });

describe("招待への参加", () => {
  it("確認済みの本人だけに招待が見え、参加すると相手のデータを持って同じグループになる", async () => {
    const a = await signUpAs("A");
    const b = await signUpAs("B");
    const c = await signUpAs("C");
    const aRecipe = await create(a.cookie, "Aの煮物");
    const bRecipe = await create(b.cookie, "Bのサラダ");
    await plan(a.cookie, "2030-10-03", aRecipe);
    await plan(b.cookie, "2030-10-03", bRecipe); // ぶつかる枠
    await plan(b.cookie, "2030-10-04", bRecipe); // ぶつからない枠
    await invite(a.cookie, ` ${b.email.toUpperCase()} `);
    const inviteId = (await info(a.cookie)).invites[0]!.id;

    // 未確認のメールでは招待が見えず、参加もできない
    expect(await invitesOf(b.cookie)).toEqual([]);
    expect((await accept(b.cookie, inviteId)).status).toBe(404);

    await verifyEmail(b.email);
    expect(await invitesOf(b.cookie)).toEqual([
      { id: inviteId, groupName: expect.any(String), invitedBy: "A" },
    ]);

    // 参加前：お互いに見えない
    expect(await titles(b.cookie)).toEqual(["Bのサラダ"]);
    expect(await titles(a.cookie)).toEqual(["Aの煮物"]);

    // 招待されていない C は、確認済みでも参加できない
    await verifyEmail(c.email);
    expect(await invitesOf(c.cookie)).toEqual([]);
    expect((await accept(c.cookie, inviteId)).status).toBe(404);

    const res = await accept(b.cookie, inviteId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      movedRecipes: 1,
      keptPlans: [{ date: "2030-10-03", meal: "dinner" }],
    });

    // 参加後：同じものが見える。ぶつかった枠は A の献立、ぶつからない B の献立は移る
    expect(await titles(a.cookie)).toEqual(["Aの煮物", "Bのサラダ"]);
    expect(await titles(b.cookie)).toEqual(["Aの煮物", "Bのサラダ"]);
    const plans = ((await (await api(a.cookie, "/plans?from=2030-10-01&to=2030-10-31")).json()) as {
      plans: { date: string; title: string }[];
    }).plans;
    expect(plans.map((p) => `${p.date}:${p.title}`)).toEqual(["2030-10-03:Aの煮物", "2030-10-04:Bのサラダ"]);
    // B が持ってきたレシピを A が編集できる
    expect(
      (await api(a.cookie, `/recipes/${bRecipe}/versions`, { method: "POST", body: recipe("Bのサラダ改") })).status,
    ).toBe(201);
    // メンバーは2人（B の1人グループは作り直されない）、招待は消えた
    const g = await info(b.cookie);
    expect(g.members.map((m) => [m.name, m.isMe])).toEqual([["A", false], ["B", true]]);
    expect(g.invites).toEqual([]);
    // 同じ招待でもう一度は 404
    expect((await accept(b.cookie, inviteId)).status).toBe(404);
    // C からは何も見えない
    expect(await titles(c.cookie)).toEqual([]);
    expect((await api(c.cookie, `/recipes/${bRecipe}`)).status).toBe(404);
  });

  it("自分のグループにメンバーがいる人は参加できない（409）", async () => {
    const a = await signUpAs("A");
    const b = await signUpAs("B");
    const d = await signUpAs("D");
    await verifyEmail(b.email);
    await verifyEmail(d.email);
    await invite(b.cookie, d.email);
    expect((await accept(d.cookie, (await invitesOf(d.cookie))[0]!.id)).status).toBe(200);
    await invite(a.cookie, b.email);
    expect((await accept(b.cookie, (await invitesOf(b.cookie))[0]!.id)).status).toBe(409);
  });

  it("既にメンバーの人は招待できない（409）", async () => {
    const a = await signUpAs("A");
    const b = await signUpAs("B");
    await verifyEmail(b.email);
    await invite(a.cookie, b.email);
    await accept(b.cookie, (await invitesOf(b.cookie))[0]!.id);
    expect((await invite(a.cookie, b.email)).status).toBe(409);
  });
});
```

recipes.test.ts の「グループをまたいだ漏れがないこと」の `// alice からは変わらず見える` の前に:
```ts
    // グループの中身（メンバー・招待）も、他のグループからは見えない
    await api(alice, "/group/invites", { method: "POST", body: { email: "secret@example.test" } });
    const g = (await (await api(bob, "/group")).json()) as { invites: unknown[]; members: unknown[] };
    expect(g.invites).toEqual([]);
    expect(g.members).toHaveLength(1);
```

- [ ] **Step 2: 失敗を確認** — `npx vitest run test/api/group.test.ts` → FAIL
- [ ] **Step 3: 実装**（`src/api/data/membership.ts`）

```ts
// グループをまたぐ操作はここだけ（自分宛ての招待を読む・参加する）。
// 宛先はセッションのユーザーの「確認済み」のメールだけで決める。クライアントから group_id は受け取らない。
import { and, count, eq, sql } from "drizzle-orm";
import { GROUP_MAX_MEMBERS, normalizeEmail } from "../../shared/group";
import type { SessionUser } from "../app-env";
import { Conflict, NotFound, type Db } from "./index";
import * as s from "./schema";

type Meal = "breakfast" | "lunch" | "dinner";

export function membershipFor(db: Db, user: SessionUser) {
  const email = user.emailVerified ? normalizeEmail(user.email) : null;

  async function countOf(table: typeof s.groupMembers | typeof s.recipes, groupId: string) {
    const [r] = await db.select({ n: count() }).from(table).where(eq(table.groupId, groupId));
    return r?.n ?? 0;
  }

  return {
    async invites() {
      if (!email) return [];
      return db
        .select({
          id: s.groupInvites.id,
          groupName: s.groups.name,
          invitedBy: sql<string>`coalesce(${s.user.name}, '')`,
        })
        .from(s.groupInvites)
        .innerJoin(s.groups, eq(s.groups.id, s.groupInvites.groupId))
        .leftJoin(s.user, eq(s.user.id, s.groupInvites.invitedBy))
        .where(eq(s.groupInvites.email, email));
    },

    async accept(inviteId: string) {
      const inv = email
        ? (
            await db
              .select()
              .from(s.groupInvites)
              .where(and(eq(s.groupInvites.id, inviteId), eq(s.groupInvites.email, email)))
              .limit(1)
          )[0]
        : undefined;
      if (!inv) throw new NotFound("invite");
      const host = inv.groupId;

      const myRows = await db
        .select({ groupId: s.groupMembers.groupId })
        .from(s.groupMembers)
        .where(eq(s.groupMembers.userId, user.id));
      if (myRows.some((r) => r.groupId === host)) throw new Conflict("もうこのグループのメンバーです");
      const mine = myRows[0]?.groupId;
      if (!mine || myRows.length !== 1 || (await countOf(s.groupMembers, mine)) > 1)
        throw new Conflict("今のグループにほかのメンバーがいるので参加できません");
      if ((await countOf(s.groupMembers, host)) >= GROUP_MAX_MEMBERS)
        throw new Conflict("このグループは人数がいっぱいです");

      const movedRecipes = await countOf(s.recipes, mine);
      const keptPlans = await db.all<{ date: string; meal: Meal }>(sql`
        select m.date as date, m.meal as meal from meal_plans m
        where m.group_id = ${mine}
          and exists (select 1 from meal_plans h
                      where h.group_id = ${host} and h.date = m.date and h.meal = m.meal)
        order by m.date, m.meal`);

      // 1つのトランザクションで：ぶつかる行は招待した側を残す → 残りを付け替える → 1人グループを消す
      await db.batch([
        db.run(sql`delete from meal_plans where group_id = ${mine} and exists (
          select 1 from meal_plans h where h.group_id = ${host}
            and h.date = meal_plans.date and h.meal = meal_plans.meal)`),
        db.run(sql`delete from shopping_marks where group_id = ${mine} and exists (
          select 1 from shopping_marks h where h.group_id = ${host}
            and h.key = shopping_marks.key and h.kind = shopping_marks.kind)`),
        db.run(sql`delete from import_reports where group_id = ${mine} and exists (
          select 1 from import_reports h where h.group_id = ${host}
            and h.url = import_reports.url)`),
        db.update(s.recipes).set({ groupId: host }).where(eq(s.recipes.groupId, mine)),
        db.update(s.recipeVersions).set({ groupId: host }).where(eq(s.recipeVersions.groupId, mine)),
        db.update(s.recipeMemos).set({ groupId: host }).where(eq(s.recipeMemos.groupId, mine)),
        db.update(s.recipeImages).set({ groupId: host }).where(eq(s.recipeImages.groupId, mine)),
        db.update(s.mealPlans).set({ groupId: host }).where(eq(s.mealPlans.groupId, mine)),
        db.update(s.shoppingMarks).set({ groupId: host }).where(eq(s.shoppingMarks.groupId, mine)),
        db.update(s.importReports).set({ groupId: host }).where(eq(s.importReports.groupId, mine)),
        db.delete(s.groupMembers).where(and(eq(s.groupMembers.groupId, mine), eq(s.groupMembers.userId, user.id))),
        db.insert(s.groupMembers).values({ groupId: host, userId: user.id, role: "member" }),
        db.delete(s.groupInvites).where(eq(s.groupInvites.id, inv.id)),
        db.delete(s.groups).where(eq(s.groups.id, mine)),
      ]);
      return { movedRecipes, keptPlans };
    },
  };
}
```

（`import_reports` は1グループ200件の上限があるが、参加で超えることは許す。）

`session.ts` の requireUser に `c.set("membership", membershipFor(db, sessionUser))`、`app-env.ts` の Variables に `membership: ReturnType<typeof membershipFor>`（型は `import type`）。

ルート（group.ts に追記）:
```ts
export const invites = new Hono<AppEnv>();

invites.get("/", async (c) => c.json({ invites: await c.var.membership.invites() }));

invites.post("/:id/accept", async (c) => c.json(await c.var.membership.accept(c.req.param("id"))));
```

- [ ] **Step 4: 通ることを確認** — `npm run test` → PASS
- [ ] **Step 5: Commit** — `git add -A src/api test/api && git commit -m "feat: 確認済みのメール宛ての招待に参加し、データを共有グループへ移す"`

---

### Task 4: 画面（設定・招待の帯・参加の画面）

**Files:**
- Modify `src/web/api/client.ts`、`src/web/pages/Settings.tsx`、`src/web/pages/Recipes.tsx`、`src/web/main.tsx`
- Create `src/web/components/InviteBanner.tsx`、`src/web/pages/JoinGroup.tsx`

**Interfaces:**
- Consumes: Task 2・3 の HTTP、Task 1 の `planSlotLabel`
- Produces: `apiClient.group()`・`invite(email)`・`cancelInvite(id)`・`myInvites()`・`acceptInvite(id)`

画面の見た目は TDD の例外（CLAUDE.md）。流れは Task 5 の E2E で確かめる。

- [ ] **Step 1: client**

```ts
export type GroupInfo = {
  name: string;
  members: { name: string; isMe: boolean; role: "owner" | "member" }[];
  invites: { id: string; email: string }[];
};
export type MyInvite = { id: string; groupName: string; invitedBy: string };
export type AcceptResult = { movedRecipes: number; keptPlans: { date: string; meal: Meal }[] };

  group: () => call<GroupInfo>("/group"),
  invite: (email: string) => call<{ ok: true }>("/group/invites", { method: "POST", json: { email } }),
  cancelInvite: (id: string) => call<void>(`/group/invites/${encodeURIComponent(id)}`, { method: "DELETE" }),
  myInvites: () => call<{ invites: MyInvite[] }>("/invites"),
  acceptInvite: (id: string) =>
    call<AcceptResult>(`/invites/${encodeURIComponent(id)}/accept`, { method: "POST" }),
```

- [ ] **Step 2: 設定「いっしょに使う人」**（今の「M5 で追加します」の枠を置き換える）
  - `useQuery({ queryKey: ["group"], queryFn: apiClient.group })`。ローディングは `Loading`、エラーは `ErrorState`（retry つき）
  - メンバーの行：名前、本人は「（あなた）」を付ける
  - 招待中の行：メールアドレス＋「取り消す」（h-11）。1回押すと同じボタンが「本当に取り消す？」になり、もう一度で `cancelInvite`。3秒で元に戻す
  - フォーム：`<input id="invite-email" type="email">`＋`PrimaryButton`「招待する」。成功で入力を空にして `["group"]` を読み直す。エラーは `role="alert"`
  - 説明文：「相手の Google のメールアドレスを入れてください。相手がそのアドレスでログインすると招待が届きます（メールは送られないので、相手に伝えてください）。自分以外4人まで。」
  - セクションの先頭に `<InviteBanner />`

- [ ] **Step 3: 招待の帯**（`InviteBanner.tsx`）
  - `useQuery({ queryKey: ["my-invites"], queryFn: apiClient.myInvites })`。0件・ローディング・エラーのときは何も出さない
  - 1件ごとに `<Link to={`/invites/${i.id}`}>`（min-h-11、bg-herb-soft、text-herb、rounded-xl）：「{invitedBy} さんから招待が届いています」＋右に「見る」
  - Recipes.tsx の `PageTitle` の直後に `<div className="px-5"><InviteBanner /></div>`

- [ ] **Step 4: 参加の画面**（`JoinGroup.tsx`、main.tsx に `{ path: "invites/:id", element: <JoinGroup /> }`）
  - `SubHeader title="招待への参加" back="/"`
  - `myInvites` から id の招待を探す。ローディング／エラー／見つからない（「この招待は見つかりませんでした。取り消されたか、別のアカウント宛てです。」）
  - 説明：「参加すると、あなたのレシピ・献立・買い物リストは {invitedBy} さんのグループに移り、同じものを一緒に使います。同じ日・同じ食事の献立がすでにあるときは、{invitedBy} さんの献立を残します。」
  - `PrimaryButton`「参加する」→ 押すと「本当に参加する？」→ `acceptInvite`
  - 成功後：`qc.clear()` してから完了表示。見出し「参加しました」、「レシピを {movedRecipes} 件移しました」、`keptPlans` があれば「{planSlotLabel(date, meal)}は、もとの献立を残しました」を1行ずつ（bg-memo text-memo-ink）。`<Link to="/">レシピを見る</Link>`（h-12）
  - エラーは `role="alert"`

- [ ] **Step 5: 確認** — `npm run typecheck && npx eslint src test e2e && npx prettier --check src test e2e`
- [ ] **Step 6: Commit** — `git add -A src/web && git commit -m "feat: いっしょに使う人の画面・招待の帯・参加の画面"`

---

### Task 5: E2E（2人で招待→参加）

**Files:** Create `e2e/invite.spec.ts`

- [ ] **Step 1: テスト**

```ts
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

// ローカルの仮ログインは本人確認が無いので、招待される側だけローカル D1 で確認済みにしてから進める
function verifyLocal(email: string) {
  execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "mairecipe", "--local", "--command",
      `update user set email_verified = 1 where email = '${email}'`],
    { stdio: "ignore" },
  );
}

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@example.test").fill(email);
  await page.getByPlaceholder("パスワード（8文字以上）").fill("password-1234");
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByRole("heading", { name: /レシピ/ })).toBeVisible();
}

async function makeRecipe(page: Page, title: string) {
  await page.getByRole("button", { name: "レシピを追加" }).click();
  await page.getByRole("button", { name: /ゼロから自分で作る/ }).click();
  await page.locator("#recipe-title").fill(title);
  await page.getByLabel("材料1の名前").fill("卵");
  await page.getByLabel("手順1").fill("焼く");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

test("招待して参加すると、同じレシピが見える", async ({ browser }) => {
  const stamp = Date.now();
  const aMail = `e2e-a-${stamp}@example.test`;
  const bMail = `e2e-b-${stamp}@example.test`;
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();

  await login(a, aMail);
  await makeRecipe(a, "Aの煮物");
  await login(b, bMail);
  await makeRecipe(b, "Bのサラダ");
  verifyLocal(bMail);

  await a.goto("/settings");
  await a.locator("#invite-email").fill(bMail.toUpperCase());
  await a.getByRole("button", { name: "招待する" }).click();
  await expect(a.getByText(bMail)).toBeVisible();

  await b.goto("/");
  await b.getByRole("link", { name: /招待が届いています/ }).click();
  await b.getByRole("button", { name: "参加する" }).click();
  await b.getByRole("button", { name: "本当に参加する？" }).click();
  await expect(b.getByText("参加しました")).toBeVisible();
  await expect(b.getByText("レシピを 1 件移しました")).toBeVisible();
  await b.screenshot({ path: "test-results/04-joined.png", fullPage: true });

  await b.getByRole("link", { name: "レシピを見る" }).click();
  await expect(b.getByText("Aの煮物")).toBeVisible();
  await a.goto("/");
  await expect(a.getByText("Bのサラダ")).toBeVisible();
});
```

- [ ] **Step 2: 実行** — `npm run e2e`（5173 が他のプロジェクトに使われているときは、一時設定で別ポート・`CLOUDFLARE_INCLUDE_PROCESS_ENV=true DEV_LOGIN=1`） → 4 passed
- [ ] **Step 3: Commit** — `git add e2e/invite.spec.ts && git commit -m "test: 招待して参加する E2E"`

---

### Task 6: 決まりごとの追記・仕上げ

**Files:** Modify `docs/spec.md`（§6、機能表の #15 の状態）、`CLAUDE.md`

- [ ] **Step 1: 追記**

`docs/spec.md` §6 の「D1 には RLS が無いので…」の次に:
```md
- 例外は1つだけ：グループをまたぐ「自分宛ての招待を読む・参加する」は `src/api/data/membership.ts` に閉じ込める。宛先は確認済みのメール（emailVerified）だけで決める
```
機能表の 15 行目の状態を「実装済・本番未反映」に。

`CLAUDE.md` の「グループの判定はセッションからだけ」の段落の末尾に:
```md
  例外：招待への参加（グループをまたぐ）は `src/api/data/membership.ts` だけで行う。宛先は確認済みのメールだけで決める
```

- [ ] **Step 2: 全体の確認** — `npx eslint src test e2e && npx prettier --check src test e2e && npm run typecheck && npm run test && npm run e2e`
- [ ] **Step 3: Commit** — `git commit -am "docs: 招待への参加だけ membership.ts を例外にすることを明記"`
- [ ] **Step 4: 仕上げ** — reviewer（opus）→ 指摘を直す → PR（Closes #14）→ マージ後に `npm run db:migrate:remote` → `npm run deploy` → 本番で設定画面の「いっしょに使う人」が開くことを確認
