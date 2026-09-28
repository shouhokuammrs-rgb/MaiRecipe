# 献立：1食に複数の品（#37）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 朝・昼・晩の1つの枠に複数のレシピ（主菜・副菜・汁物など）を並び順つきで入れられるようにし、品ごとに外す・上下に並べ替える・買い物リストで全品を合算する・参加（#14）で枠がぶつかったら両方残す、までをつなげる。

**Architecture:** `meal_plans` に `position` 列を足し、unique を「枠」から「枠 × レシピ」に付け替える（ALTER TABLE ADD COLUMN と索引の作り直しだけ。既存の行は position 0 の1品としてそのまま残る）。足すときの position は INSERT の中のサブクエリで決め、並べ替えは2行の position を1回の `db.batch` で入れ替える。行の id を受け取る操作は `forGroup` の中で必ず自分のグループの行か確かめる（他グループ・無い id は 404、過ぎた日は 400）。参加では「ぶつかる献立を消す」をやめ、参加する側の行の position を招待した側の同じ枠の後ろへずらしてから付け替える。

**Tech Stack:** Cloudflare Workers + Hono、D1 + Drizzle（drizzle-kit 0.31）、React 19 + TanStack Query + Tailwind v4、Vitest（workers pool）、Playwright

**Spec:** `docs/superpowers/specs/2026-09-29-meal-multi-dish-design.md`

## Global Constraints

- グループの判定はセッションからだけ。クライアントから group_id を受け取らない。DB は `forGroup` 経由（参加だけ `membership.ts`）
- 行の id を受け取る操作（DELETE `/api/plans/items/:id`・POST `/api/plans/items/:id/move`）は、自分のグループの行でなければ 404。過ぎた日（`date < todayJst()`）の行は 400
- 同じ枠に同じレシピは1回まで（unique `meal_plans_item_uq`）。2回目の PUT は何もしない（204）
- 足すときの position は「その枠の最大 + 1」を INSERT の中のサブクエリで決める（Worker で数えてから入れない）
- 並べ替えは2行の position を入れ替える UPDATE を1回の `db.batch` で流す
- マイグレーションは `ALTER TABLE meal_plans ADD position integer DEFAULT 0 NOT NULL` と索引の作り直しだけ。テーブルの作り直し（`__new_meal_plans` へのコピー）は使わない。既存の行を消したり作り直したりしない
- `keptPlans`・`planSlotLabel`・完了画面の「もとの献立を残しました」は無くす
- Worker の CPU 10ms：行を Worker で回さない。SQL は普通の書き方（`CASE`・`coalesce`・`max` は可。SQLite 独自関数を条件・集計に使わない）。`sql.raw` に値を埋め込まない
- UI：日本語、375px、タップ 44px 以上（`size-11` / `min-h-11`）、ローディング／エラー／空状態、confirm を使わない、色はトークン
- 作らないもの：品の種類（主菜・副菜）の入力欄、枠ごとの人数、品の上限
- 本番 D1 へのマイグレーションとデプロイはこの計画に含めない（末尾の「本番への反映（Eiichi に渡す手順）」を controller が渡す）
- `apps/`・`supabase/`（未追跡）は絶対に stage しない。`git add` はファイル名を指定する（`-A` を使わない）
- 確認コマンドは `npx eslint src test e2e && npx prettier --check src test e2e && npm run typecheck && npm run test`（リポジトリ全体の `npm run lint` は未追跡の apps/・supabase/ のせいでローカルでだけ落ちる）

## Review Focus

1. 参加する側が1つの枠に2品以上持っていて、招待した側も同じ枠に2品以上ある → 参加後の並びは「招待した側の品（元の順）→ 参加した側の品（元の順）」。1本の UPDATE の中で group_id と position を同時に変えると、相関サブクエリがすでに付け替えた行を拾って順番が崩れうるので、position をずらす UPDATE を group_id の付け替えより**前**に別の文で流す（Task 3 のテスト「両方に2品ずつ」）
2. `DELETE /api/plans/items/:id` が Hono で `DELETE /api/plans/:date/:meal`（date="items"）にも一致する → items のルートを先に登録しないと、他グループの id でも 404 ではなく 400 が返る（Task 2 の漏れテストと「無い id は 404」で確かめる）
3. 移行前の形（position 列が無い頃の1枠1行）のデータ → 移行後も消えず position 0 の1品として読め、同じ枠に2品目を足せる（Task 1 のローカル D1 での確認と、position を指定しない INSERT のテスト）
4. 過ぎた日の品は API から作れないが、以前から残っている → 消す・並べ替えるは 400 で、行は変わらない（Task 2 のテストで生の INSERT を使って作る）
5. 同じレシピを同じ枠に2回足す（ダブルタップ・古い PWA の PUT） → 1品のまま 204。位置もずれない（Task 1 のテスト）

---

## File Structure

| ファイル | 役割 |
|---|---|
| `src/api/data/schema.ts` | `mealPlans` に `position`、索引を `meal_plans_item_uq`・`meal_plans_slot_idx` に |
| `drizzle/0003_*.sql`・`drizzle/meta/0003_snapshot.json`・`drizzle/meta/_journal.json` | マイグレーション（生成。必要なら SQL だけ手で ADD COLUMN の形に直す） |
| `src/shared/recipe.ts` | `planMoveSchema`（`{ direction: "up" \| "down" }`） |
| `src/api/data/index.ts` | `listPlans`（id・position・並び）、`addPlan`（旧 `setPlan`）、`deletePlanItem`、`movePlanItem`。`deletePlan` は残す |
| `src/api/routes/plans.ts` | PUT の意味を「追加」に、`DELETE /items/:id`・`POST /items/:id/move` を足す |
| `src/api/data/membership.ts` | `deleteCollidingPlans` をやめて `shiftMyPlans` を足す。`keptPlans` を返さない |
| `src/shared/group.ts` | `planSlotLabel` を消す |
| `src/web/api/client.ts` | `PlanEntry` に id・position、`addPlan`・`deletePlanItem`・`movePlanItem`、`AcceptResult` から keptPlans を消す |
| `src/web/pages/Plan.tsx` | 1日を1枚のカードにし、枠の中に品を縦に並べる |
| `src/web/pages/JoinGroup.tsx` | 「もとの献立を残しました」を消し、説明文を変える |
| `test/api/helpers.ts` | `insertPlanRaw`（過ぎた日・移行前の形の行をテストで作る） |
| `test/api/plans.test.ts`・`test/api/recipes.test.ts`・`test/api/group.test.ts`・`test/shared/group.test.ts` | テスト |
| `e2e/plan-multi-dish.spec.ts`（新）・`e2e/main-flow.spec.ts` | E2E |
| `docs/spec.md`・`README.md`・`docs/superpowers/specs/2026-09-29-group-invite-design.md` | 決まりごとの更新 |

---

### Task 1: 並び順の列と索引（マイグレーション）＋ 枠の最後に足す ＋ 一覧に id・position

**Files:**
- Modify: `src/api/data/schema.ts`（`mealPlans`、229〜244行）
- Generate: `drizzle/0003_*.sql`、`drizzle/meta/0003_snapshot.json`、`drizzle/meta/_journal.json`
- Modify: `src/api/data/index.ts`（`listPlans`・`setPlan` → `addPlan`、515〜553行）
- Modify: `src/api/routes/plans.ts`（PUT）
- Modify: `test/api/helpers.ts`（`insertPlanRaw` を足す）
- Test: `test/api/plans.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `s.mealPlans.position`（`integer("position").notNull().default(0)`）
  - forGroup: `listPlans(from: string, to: string): Promise<{ id: string; date: string; meal: "breakfast"|"lunch"|"dinner"; position: number; recipeId: string; title: string; category: string }[]>`（並びは date → 朝昼晩 → position → id）
  - forGroup: `addPlan(date: string, meal: "breakfast"|"lunch"|"dinner", recipeId: string): Promise<void>`（`setPlan` は無くなる）
  - HTTP: `GET /api/plans` の各行に `id`・`position`。`PUT /api/plans` は枠の最後に足す（同じレシピは何もしない。204）
  - テスト用: `insertPlanRaw(email: string, p: { date: string; meal: "breakfast"|"lunch"|"dinner"; recipeId: string; position?: number }): Promise<string>`（行の id を返す。position を省くと列を書かない＝移行前の形の INSERT）

- [ ] **Step 1: テスト用ヘルパー**（`test/api/helpers.ts` の `rawShoppingMark` の後ろに足す）

```ts
/**
 * テストだけで使う：そのユーザーのグループに献立の行を直接入れる（API では過ぎた日に入れられないため）。
 * position を省くと列そのものを書かない（position 列が無かった頃と同じ形の INSERT）。行の id を返す。
 */
export async function insertPlanRaw(
  email: string,
  p: {
    date: string;
    meal: "breakfast" | "lunch" | "dinner";
    recipeId: string;
    position?: number;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  const withPosition = p.position !== undefined;
  await env.DB.prepare(
    `insert into meal_plans (id, group_id, date, meal, recipe_id${withPosition ? ", position" : ""})
     select ?, gm.group_id, ?, ?, ?${withPosition ? ", ?" : ""}
     from group_members gm join user u on u.id = gm.user_id
     where u.email = ?`,
  )
    .bind(
      id,
      p.date,
      p.meal,
      p.recipeId,
      ...(withPosition ? [p.position] : []),
      email.toLowerCase(),
    )
    .run();
  return id;
}
```

- [ ] **Step 2: 失敗するテスト**（`test/api/plans.test.ts`）

import を `import { api, insertPlanRaw, sampleRecipe, signUp, signUpAs } from "./helpers";` にし、`create` の下に足す:

```ts
type PlanRow = {
  id: string;
  date: string;
  meal: string;
  position: number;
  recipeId: string;
  title: string;
};

async function plansOf(cookie: string, from: string, to = from) {
  const res = await api(cookie, `/plans?from=${from}&to=${to}`);
  return ((await res.json()) as { plans: PlanRow[] }).plans;
}

const put = (cookie: string, date: string, meal: string, recipeId: string) =>
  api(cookie, "/plans", { method: "PUT", body: { date, meal, recipeId } });
```

`describe("献立と買い物リスト")` の最初の `it("献立に入れると一覧に出て、同じ枠は置き換わり、外せる")` を丸ごと次の4つに置き換える:

```ts
  it("1つの枠に何品でも足せて、足した順に返る。同じレシピは2回足しても1品のまま", async () => {
    const me = await signUp();
    const a = await create(me, sampleRecipe);
    const b = await create(me, { ...sampleRecipe, title: "豚汁" });
    const day = "2030-01-07";
    expect((await put(me, day, "dinner", a)).status).toBe(204);
    expect((await put(me, day, "dinner", b)).status).toBe(204);
    expect((await put(me, day, "dinner", a)).status).toBe(204); // 何もしない
    const list = await plansOf(me, day);
    expect(list.map((p) => [p.title, p.position])).toEqual([
      ["鶏むね肉の甘酢炒め", 0],
      ["豚汁", 1],
    ]);
    expect(new Set(list.map((p) => p.id)).size).toBe(2);
    // 同じレシピを足し直しても、位置はずれない（3品目は position 2）
    const c = await create(me, { ...sampleRecipe, title: "ほうれん草のおひたし" });
    await put(me, day, "dinner", c);
    expect((await plansOf(me, day)).map((p) => p.position)).toEqual([0, 1, 2]);
  });

  it("並びは 日付 → 朝昼晩 → 枠の中の順", async () => {
    const me = await signUp();
    const a = await create(me, { ...sampleRecipe, title: "A" });
    const b = await create(me, { ...sampleRecipe, title: "B" });
    const d1 = "2030-02-01";
    const d2 = "2030-02-02";
    await put(me, d2, "breakfast", a);
    await put(me, d1, "dinner", b);
    await put(me, d1, "breakfast", a);
    await put(me, d1, "dinner", a);
    await put(me, d1, "lunch", b);
    expect(
      (await plansOf(me, d1, d2)).map((p) => `${p.date}:${p.meal}:${p.title}`),
    ).toEqual([
      `${d1}:breakfast:A`,
      `${d1}:lunch:B`,
      `${d1}:dinner:B`,
      `${d1}:dinner:A`,
      `${d2}:breakfast:A`,
    ]);
  });

  it("移行前の形（position を書かない）の行は position 0 の1品として読め、2品目を後ろに足せる", async () => {
    const me = await signUpAs("移行前");
    const a = await create(me.cookie, { ...sampleRecipe, title: "昔の献立" });
    const b = await create(me.cookie, { ...sampleRecipe, title: "足した品" });
    const day = "2030-03-01";
    await insertPlanRaw(me.email, { date: day, meal: "dinner", recipeId: a });
    expect(
      (await plansOf(me.cookie, day)).map((p) => [p.title, p.position]),
    ).toEqual([["昔の献立", 0]]);
    await put(me.cookie, day, "dinner", b);
    expect(
      (await plansOf(me.cookie, day)).map((p) => [p.title, p.position]),
    ).toEqual([
      ["昔の献立", 0],
      ["足した品", 1],
    ]);
  });

  it("枠を丸ごと空にする DELETE /plans/:date/:meal は残っている（古い画面のため）", async () => {
    const me = await signUp();
    const a = await create(me, sampleRecipe);
    const b = await create(me, { ...sampleRecipe, title: "豚汁" });
    const day = "2030-01-08";
    await put(me, day, "dinner", a);
    await put(me, day, "dinner", b);
    await put(me, day, "lunch", a);
    expect(
      (await api(me, `/plans/${day}/dinner`, { method: "DELETE" })).status,
    ).toBe(204);
    expect((await plansOf(me, day)).map((p) => p.meal)).toEqual(["lunch"]);
  });

  it("買い物リストは、1つの枠の全品の材料を合算する", async () => {
    const me = await signUp();
    const today = todayJst();
    const a = await create(me, sampleRecipe); // 鶏むね肉・たまねぎ・酢・砂糖
    const b = await create(me, {
      ...sampleRecipe,
      title: "大根の味噌汁",
      ingredients: [{ name: "大根", amount: "1/4本" }],
    });
    await put(me, today, "dinner", a);
    await put(me, today, "dinner", b);
    const res = (await (await api(me, "/shopping?days=1")).json()) as {
      items: ShopItem[];
      recipeCount: number;
    };
    expect(res.recipeCount).toBe(2);
    const names = res.items.map((i) => i.name);
    expect(names).toContain("鶏むね肉");
    expect(names).toContain("大根");
  });
```

- [ ] **Step 3: 失敗を確認** — `npx vitest run test/api/plans.test.ts` → FAIL（`position` が undefined、2品目で置き換わる、など）

- [ ] **Step 4: schema**（`src/api/data/schema.ts` の `mealPlans` を置き換える）

```ts
// ---- 献立（日付 × 朝昼晩 × 並び順つきの複数レシピ。同じ枠に同じレシピは1回まで）
export const mealPlans = sqliteTable(
  "meal_plans",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    meal: text("meal", { enum: ["breakfast", "lunch", "dinner"] }).notNull(),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    /** 枠の中の並び順（小さいほど上）。移行前の行は 0 */
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("meal_plans_item_uq").on(
      t.groupId,
      t.date,
      t.meal,
      t.recipeId,
    ),
    index("meal_plans_slot_idx").on(t.groupId, t.date, t.meal),
  ],
);
```

（既存のコメント行がこの上にあれば、それを上のコメントに置き換える）

- [ ] **Step 5: マイグレーションを生成して中身を見る**

Run: `npm run db:generate`
Expected: `drizzle/0003_<名前>.sql` と `drizzle/meta/0003_snapshot.json` ができ、`_journal.json` に idx 3 が足される。

Run: `cat drizzle/0003_*.sql`

**(a) 次の形（順番は違ってよい）ならそのまま使う:**

```sql
DROP INDEX `meal_plans_slot_uq`;--> statement-breakpoint
ALTER TABLE `meal_plans` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `meal_plans_item_uq` ON `meal_plans` (`group_id`,`date`,`meal`,`recipe_id`);--> statement-breakpoint
CREATE INDEX `meal_plans_slot_idx` ON `meal_plans` (`group_id`,`date`,`meal`);
```

**(b) テーブルの作り直し（`PRAGMA foreign_keys=OFF`・`CREATE TABLE \`__new_meal_plans\``・`INSERT INTO \`__new_meal_plans\` ... SELECT`・`DROP TABLE \`meal_plans\``・`ALTER TABLE \`__new_meal_plans\` RENAME TO`）が出たら**、SQL ファイルの中身を丸ごと (a) の4文に書き換える。

- 文の区切りの `--> statement-breakpoint` は残す（テストの `readD1Migrations` と wrangler がこれで文を分ける）
- ファイル名・`_journal.json`・`0003_snapshot.json` は生成されたまま触らない（snapshot はスキーマから作られるので、SQL を直しても食い違わない）

Run: `npm run db:generate`（もう一度）
Expected: `No schema changes, nothing to migrate` のように、新しいファイルが増えない（meta とスキーマが一致している確認）。増えたら消して原因を調べる。

- [ ] **Step 6: data 層**（`src/api/data/index.ts`）

`listPlans` と `setPlan` を次に置き換える（`deletePlan` はそのまま残す）:

```ts
    // ---- 献立（1つの枠に並び順つきで複数の品）
    async listPlans(from: string, to: string) {
      return db
        .select({
          id: s.mealPlans.id,
          date: s.mealPlans.date,
          meal: s.mealPlans.meal,
          position: s.mealPlans.position,
          recipeId: s.mealPlans.recipeId,
          title: s.recipes.title,
          category: s.recipes.category,
        })
        .from(s.mealPlans)
        .innerJoin(
          s.recipes,
          and(eq(s.recipes.id, s.mealPlans.recipeId), inGroup),
        )
        .where(
          and(
            eq(s.mealPlans.groupId, groupId),
            gte(s.mealPlans.date, from),
            lte(s.mealPlans.date, to),
          ),
        )
        .orderBy(
          asc(s.mealPlans.date),
          sql`case ${s.mealPlans.meal} when 'breakfast' then 0 when 'lunch' then 1 else 2 end`,
          asc(s.mealPlans.position),
          asc(s.mealPlans.id),
        );
    },

    /**
     * 枠の最後に1品足す。同じ枠に同じレシピがあれば何もしない。
     * position は「その枠の最大 + 1」を INSERT の中のサブクエリで決める（Worker で数えない）。
     */
    async addPlan(
      date: string,
      meal: "breakfast" | "lunch" | "dinner",
      recipeId: string,
    ) {
      await recipeRow(recipeId);
      await db
        .insert(s.mealPlans)
        .values({
          id: newId(),
          groupId,
          date,
          meal,
          recipeId,
          position: sql`(select coalesce(max(p.position) + 1, 0) from meal_plans p
            where p.group_id = ${groupId} and p.date = ${date} and p.meal = ${meal})`,
        })
        .onConflictDoNothing();
    },
```

- [ ] **Step 7: ルート**（`src/api/routes/plans.ts` の PUT）

```ts
/** 枠の最後に1品足す（同じレシピが既にあれば何もしない）。古い画面から呼ばれても品が増えるだけ */
plans.put("/", async (c) => {
  const parsed = mealPlanSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(c, parsed.error);
  const { date, meal, recipeId } = parsed.data;
  if (date < todayJst())
    return c.json({ error: "過ぎた日の献立は変えられません" }, 400);
  await c.var.repo.addPlan(date, meal, recipeId);
  return c.body(null, 204);
});
```

- [ ] **Step 8: 通ることを確認** — `npx vitest run test/api` → PASS（group.test.ts の参加のテストもこの時点ではまだ「ぶつかったら消す」のまま通る）

- [ ] **Step 9: 移行前のデータが残ることをローカル D1 で確かめる**（PR に書く。リポジトリにはファイルを残さない）

`.dev.vars` は作らない・読まない。一時フォルダの D1 を使うので、開発用のローカル D1 にも触らない。`0003_*.sql` は Step 5 で決まった実際のファイル名に置き換える。

```bash
TMP=$(mktemp -d)
X() { npx wrangler d1 execute mairecipe --local --persist-to "$TMP" "$@"; }
X --file drizzle/0000_init.sql
X --file drizzle/0001_talented_zarek.sql
X --file drizzle/0002_talented_clint_barton.sql
X --command "insert into groups (id, name) values ('g1', '移行テスト');
  insert into recipes (id, group_id, title, category, genre) values
    ('r1', 'g1', '煮物', '主菜', '和食'), ('r2', 'g1', 'サラダ', '副菜', '洋食');
  insert into meal_plans (id, group_id, date, meal, recipe_id) values
    ('p1', 'g1', '2030-01-01', 'dinner', 'r1'),
    ('p2', 'g1', '2030-01-01', 'lunch', 'r2'),
    ('p3', 'g1', '2030-01-02', 'dinner', 'r2');"
X --command "select count(*) as before_count from meal_plans"
X --file drizzle/0003_*.sql
X --command "select count(*) as after_count from meal_plans"
X --command "select id, date, meal, recipe_id, position from meal_plans order by id"
X --command "select name from sqlite_master where type = 'index' and tbl_name = 'meal_plans' order by name"
# 旧 unique が消えたので、同じ枠に2品目が入る。同じレシピは入らない
X --command "insert into meal_plans (id, group_id, date, meal, recipe_id, position) values ('p4', 'g1', '2030-01-01', 'dinner', 'r2', 1)"
X --command "insert into meal_plans (id, group_id, date, meal, recipe_id, position) values ('p5', 'g1', '2030-01-01', 'dinner', 'r1', 2)" || echo "期待どおり: 同じ枠に同じレシピは入らない"
X --command "select count(*) as final_count from meal_plans"
rm -rf "$TMP"
```

Expected:
- `before_count` = 3、`after_count` = 3（行が消えていない）
- p1・p2・p3 の position がすべて 0
- 索引は `meal_plans_item_uq`・`meal_plans_slot_idx`（と sqlite の自動索引）。`meal_plans_slot_uq` は無い
- p4 は入り、p5 は UNIQUE constraint failed で入らない。`final_count` = 4

出力（件数・position・索引名）を report に貼る。controller が PR の本文に書く。1つでも違ったら先に進まず報告する。

- [ ] **Step 10: Commit**

```bash
git add src/api/data/schema.ts drizzle/0003_*.sql drizzle/meta/0003_snapshot.json drizzle/meta/_journal.json src/api/data/index.ts src/api/routes/plans.ts test/api/helpers.ts test/api/plans.test.ts
git commit -m "feat: 献立の1つの枠に複数の品を並び順つきで足せるようにする"
```

---

### Task 2: 品ごとに外す・上下に並べ替える API（＋漏れテスト）

**Files:**
- Modify: `src/shared/recipe.ts`（`mealPlanSchema` の下）
- Modify: `src/api/data/index.ts`（import と forGroup の献立の節）
- Modify: `src/api/routes/plans.ts`
- Test: `test/api/plans.test.ts`、`test/api/recipes.test.ts`（「グループをまたいだ漏れがないこと」）

**Interfaces:**
- Consumes: Task 1 の `listPlans`（id・position）、`addPlan`、`insertPlanRaw`
- Produces:
  - `planMoveSchema = z.object({ direction: z.enum(["up", "down"]) })`（`src/shared/recipe.ts`）
  - forGroup: `deletePlanItem(id: string, today: string): Promise<void>`、`movePlanItem(id: string, direction: "up" | "down", today: string): Promise<void>`。他グループ・無い id は `NotFound`（404）、`date < today` は `BadInput`（400）
  - HTTP: `DELETE /api/plans/items/:id` → 204、`POST /api/plans/items/:id/move` `{ direction }` → 204（端なら何もしないで 204）

- [ ] **Step 1: 失敗するテスト**（`test/api/plans.test.ts`。import に `addDays` は既にある）

`describe("献立と買い物リスト")` の中、Task 1 で足したテストの後ろに足す:

```ts
  const move = (cookie: string, id: string, direction: string) =>
    api(cookie, `/plans/items/${id}/move`, {
      method: "POST",
      body: { direction },
    });

  it("品を1つ外すと、ほかの品は残る", async () => {
    const me = await signUp();
    const a = await create(me, { ...sampleRecipe, title: "A" });
    const b = await create(me, { ...sampleRecipe, title: "B" });
    const day = "2030-04-01";
    await put(me, day, "dinner", a);
    await put(me, day, "dinner", b);
    const [first] = await plansOf(me, day);
    expect(
      (await api(me, `/plans/items/${first!.id}`, { method: "DELETE" }))
        .status,
    ).toBe(204);
    expect((await plansOf(me, day)).map((p) => p.title)).toEqual(["B"]);
    // 外した品は、もう一度同じ枠に足せる（後ろに付く）
    await put(me, day, "dinner", a);
    expect((await plansOf(me, day)).map((p) => p.title)).toEqual(["B", "A"]);
  });

  it("上下に並べ替えられる。端での move は何もしない", async () => {
    const me = await signUp();
    const ids: string[] = [];
    for (const t of ["A", "B", "C"])
      ids.push(await create(me, { ...sampleRecipe, title: t }));
    const day = "2030-04-02";
    for (const r of ids) await put(me, day, "lunch", r);
    await put(me, day, "dinner", ids[0]!); // 別の枠は動かない
    const lunch = async () =>
      (await plansOf(me, day))
        .filter((p) => p.meal === "lunch")
        .map((p) => p.title);
    const idOf = async (title: string) =>
      (await plansOf(me, day)).find(
        (p) => p.meal === "lunch" && p.title === title,
      )!.id;

    expect((await move(me, await idOf("C"), "up")).status).toBe(204);
    expect(await lunch()).toEqual(["A", "C", "B"]);
    expect((await move(me, await idOf("A"), "up")).status).toBe(204); // 先頭
    expect((await move(me, await idOf("B"), "down")).status).toBe(204); // 最後
    expect(await lunch()).toEqual(["A", "C", "B"]);
    expect((await move(me, await idOf("A"), "down")).status).toBe(204);
    expect(await lunch()).toEqual(["C", "A", "B"]);
    // 夜の枠は1品のまま
    expect(
      (await plansOf(me, day))
        .filter((p) => p.meal === "dinner")
        .map((p) => p.title),
    ).toEqual(["A"]);
  });

  it("move の入力がおかしければ 400。無い id は 404", async () => {
    const me = await signUp();
    const a = await create(me, sampleRecipe);
    const day = "2030-04-03";
    await put(me, day, "dinner", a);
    const [item] = await plansOf(me, day);
    expect((await move(me, item!.id, "left")).status).toBe(400);
    expect(
      (await api(me, `/plans/items/${item!.id}/move`, { method: "POST" }))
        .status,
    ).toBe(400);
    expect((await move(me, "no-such-id", "up")).status).toBe(404);
    expect(
      (await api(me, "/plans/items/no-such-id", { method: "DELETE" })).status,
    ).toBe(404);
  });

  it("過ぎた日の品は外せない・並べ替えられない（400）", async () => {
    const me = await signUpAs("過去");
    const a = await create(me.cookie, { ...sampleRecipe, title: "A" });
    const b = await create(me.cookie, { ...sampleRecipe, title: "B" });
    const yesterday = addDays(todayJst(), -1);
    const first = await insertPlanRaw(me.email, {
      date: yesterday,
      meal: "dinner",
      recipeId: a,
      position: 0,
    });
    const second = await insertPlanRaw(me.email, {
      date: yesterday,
      meal: "dinner",
      recipeId: b,
      position: 1,
    });
    expect(
      (await api(me.cookie, `/plans/items/${first}`, { method: "DELETE" }))
        .status,
    ).toBe(400);
    expect((await move(me.cookie, second, "up")).status).toBe(400);
    expect(
      (await plansOf(me.cookie, yesterday)).map((p) => p.title),
    ).toEqual(["A", "B"]);
  });
```

`test/api/recipes.test.ts` の「他の人のレシピは 見えない・変えられない・消せない・献立に入れられない」の中、`// alice からは変わらず見える` の直前に足す:

```ts
    // 献立の品（id で操作する）も、他のグループからは外せない・並べ替えられない
    const id2 = await create(alice, { ...sampleRecipe, title: "副菜" });
    for (const r of [id, id2])
      await api(alice, "/plans", {
        method: "PUT",
        body: { date: "2030-01-02", meal: "dinner", recipeId: r },
      });
    const alicePlans = async () =>
      (
        (await (
          await api(alice, "/plans?from=2030-01-02&to=2030-01-02")
        ).json()) as { plans: { id: string; title: string }[] }
      ).plans;
    const [firstItem, secondItem] = await alicePlans();
    expect(
      (
        await api(bob.cookie, `/plans/items/${firstItem!.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await api(bob.cookie, `/plans/items/${secondItem!.id}/move`, {
          method: "POST",
          body: { direction: "up" },
        })
      ).status,
    ).toBe(404);
    expect((await alicePlans()).map((p) => p.title)).toEqual([
      sampleRecipe.title,
      "副菜",
    ]);
```

（`create(cookie, body)` は recipes.test.ts の先頭で定義済み。`alice` は Cookie 文字列、`bob` は `signUpAs` の戻り値）

- [ ] **Step 2: 失敗を確認** — `npx vitest run test/api/plans.test.ts test/api/recipes.test.ts` → FAIL（items のルートが無いので DELETE は `/:date/:meal` に当たって 400、POST は 404 など）

- [ ] **Step 3: 入力検証**（`src/shared/recipe.ts` の `mealPlanSchema` の直後）

```ts
/** 献立の品を1つ上・下の品と入れ替える */
export const planMoveSchema = z.object({
  direction: z.enum(["up", "down"]),
});
```

- [ ] **Step 4: data 層**（`src/api/data/index.ts`）

import の1行目を次にする:

```ts
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  lt,
  lte,
  max,
  sql,
} from "drizzle-orm";
```

`forGroup` の中、`syncHeaderFromLatest` の後ろ（`return {` の前）に足す:

```ts
  /** 自分のグループの献立の1行。無い・他のグループなら NotFound。過ぎた日なら BadInput */
  async function editablePlanItem(id: string, today: string) {
    const r = await db
      .select({
        id: s.mealPlans.id,
        date: s.mealPlans.date,
        meal: s.mealPlans.meal,
        position: s.mealPlans.position,
      })
      .from(s.mealPlans)
      .where(and(eq(s.mealPlans.id, id), eq(s.mealPlans.groupId, groupId)))
      .limit(1);
    if (!r[0]) throw new NotFound("plan");
    if (r[0].date < today)
      throw new BadInput("過ぎた日の献立は変えられません");
    return r[0];
  }
```

`addPlan` の後ろに足す:

```ts
    /** 1品だけ外す */
    async deletePlanItem(id: string, today: string) {
      await editablePlanItem(id, today);
      await db
        .delete(s.mealPlans)
        .where(and(eq(s.mealPlans.id, id), eq(s.mealPlans.groupId, groupId)));
    },

    /** 1つ上・下の品と position を入れ替える。端なら何もしない */
    async movePlanItem(id: string, direction: "up" | "down", today: string) {
      const item = await editablePlanItem(id, today);
      const up = direction === "up";
      const [other] = await db
        .select({ id: s.mealPlans.id, position: s.mealPlans.position })
        .from(s.mealPlans)
        .where(
          and(
            eq(s.mealPlans.groupId, groupId),
            eq(s.mealPlans.date, item.date),
            eq(s.mealPlans.meal, item.meal),
            up
              ? lt(s.mealPlans.position, item.position)
              : gt(s.mealPlans.position, item.position),
          ),
        )
        .orderBy(
          up ? desc(s.mealPlans.position) : asc(s.mealPlans.position),
        )
        .limit(1);
      if (!other) return;
      await db.batch([
        db
          .update(s.mealPlans)
          .set({ position: other.position })
          .where(
            and(eq(s.mealPlans.id, item.id), eq(s.mealPlans.groupId, groupId)),
          ),
        db
          .update(s.mealPlans)
          .set({ position: item.position })
          .where(
            and(
              eq(s.mealPlans.id, other.id),
              eq(s.mealPlans.groupId, groupId),
            ),
          ),
      ]);
    },
```

`deletePlan` の上に1行コメントを足す: `/** 枠を丸ごと空にする。画面からは使わないが、古い画面（PWA のキャッシュ）のために残す */`

- [ ] **Step 5: ルート**（`src/api/routes/plans.ts`）

import を `import { mealPlanSchema, planMoveSchema, shoppingMarkSchema } from "../../shared/recipe";` にし、PUT の直後・`plans.delete("/:date/:meal", …)` より**前**に足す:

```ts
// ↓ items のルートは "/:date/:meal" より先に登録する（DELETE /items/:id が date="items" にも一致するため）
plans.delete("/items/:id", async (c) => {
  await c.var.repo.deletePlanItem(c.req.param("id"), todayJst());
  return c.body(null, 204);
});

plans.post("/items/:id/move", async (c) => {
  const parsed = planMoveSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) return badRequest(c, parsed.error);
  await c.var.repo.movePlanItem(
    c.req.param("id"),
    parsed.data.direction,
    todayJst(),
  );
  return c.body(null, 204);
});
```

- [ ] **Step 6: 通ることを確認** — `npx vitest run test/api` → PASS

- [ ] **Step 7: Commit**

```bash
git add src/shared/recipe.ts src/api/data/index.ts src/api/routes/plans.ts test/api/plans.test.ts test/api/recipes.test.ts
git commit -m "feat: 献立の品を1つずつ外す・上下に並べ替える API"
```

---

### Task 3: 参加（#14）で献立がぶつかったら両方残す

**Files:**
- Modify: `src/api/data/membership.ts`
- Modify: `src/shared/group.ts`（`planSlotLabel` を消す）
- Modify: `src/web/api/client.ts`（`AcceptResult`）
- Modify: `src/web/pages/JoinGroup.tsx`
- Test: `test/api/group.test.ts`、`test/shared/group.test.ts`

**Interfaces:**
- Consumes: Task 1 の `position` 列・`addPlan`、Task 2 の `POST /api/plans/items/:id/move`
- Produces:
  - `membershipFor(db, user).accept(inviteId)` → `Promise<{ movedRecipes: number }>`（`keptPlans` は無くなる）
  - `AcceptResult = { movedRecipes: number }`（client.ts）
  - `planSlotLabel` は無くなる（`src/shared/group.ts` は `GROUP_MAX_MEMBERS`・`normalizeEmail`・`inviteSchema` だけ）

- [ ] **Step 1: 失敗するテスト**（`test/api/group.test.ts`）

1つ目の `it("確認済みの本人だけに招待が見え、…")` の中を次のように変える。

参加の結果:

```ts
    const res = await accept(b.cookie, inviteId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ movedRecipes: 1 });
```

参加後の献立（`// 参加後：同じものが見える。…` のコメントとその下の `plans` の確かめ）:

```ts
    // 参加後：同じものが見える。ぶつかった枠は両方残り、招待した側（A）の品が先
    expect(await titles(a.cookie)).toEqual(["Aの煮物", "Bのサラダ"]);
    expect(await titles(b.cookie)).toEqual(["Aの煮物", "Bのサラダ"]);
    const plans = (
      (await (
        await api(a.cookie, "/plans?from=2030-10-01&to=2030-10-31")
      ).json()) as {
        plans: { date: string; title: string; position: number }[];
      }
    ).plans;
    expect(plans.map((p) => `${p.date}:${p.title}:${p.position}`)).toEqual([
      "2030-10-03:Aの煮物:0",
      "2030-10-03:Bのサラダ:1",
      "2030-10-04:Bのサラダ:0",
    ]);
```

`describe("招待への参加")` の最後（`it("既にメンバーの人は招待できない（409）")` の後ろ）に足す:

```ts
  it("同じ枠に両方2品ずつあっても、招待した側の順 → 参加した側の順で並ぶ", async () => {
    const a = await signUpAs("A");
    const b = await signUpAs("B");
    const day = "2030-11-05";
    const a1 = await create(a.cookie, "A1");
    const a2 = await create(a.cookie, "A2");
    const b1 = await create(b.cookie, "B1");
    const b2 = await create(b.cookie, "B2");
    for (const r of [a1, a2]) await plan(a.cookie, day, r);
    for (const r of [b1, b2]) await plan(b.cookie, day, r);
    await verifyEmail(b.email);
    await invite(a.cookie, b.email);
    expect(
      (await accept(b.cookie, (await invitesOf(b.cookie))[0]!.id)).status,
    ).toBe(200);

    const read = async (cookie: string) =>
      (
        (await (
          await api(cookie, `/plans?from=${day}&to=${day}`)
        ).json()) as { plans: { id: string; title: string }[] }
      ).plans;
    expect((await read(a.cookie)).map((p) => p.title)).toEqual([
      "A1",
      "A2",
      "B1",
      "B2",
    ]);
    expect((await read(b.cookie)).map((p) => p.title)).toEqual([
      "A1",
      "A2",
      "B1",
      "B2",
    ]);
    // 移ってきた品も、同じグループの品として並べ替えられる
    const b1Item = (await read(a.cookie)).find((p) => p.title === "B1")!;
    expect(
      (
        await api(a.cookie, `/plans/items/${b1Item.id}/move`, {
          method: "POST",
          body: { direction: "up" },
        })
      ).status,
    ).toBe(204);
    expect((await read(b.cookie)).map((p) => p.title)).toEqual([
      "A1",
      "B1",
      "A2",
      "B2",
    ]);
  });
```

`test/shared/group.test.ts` から `planSlotLabel` の import と `describe("planSlotLabel", …)` を丸ごと消す。

- [ ] **Step 2: 失敗を確認** — `npx vitest run test/api/group.test.ts` → FAIL（`keptPlans` が返る、ぶつかった B の品が消えている）

- [ ] **Step 3: membership.ts**

import から `MEALS` の行（`import { MEALS } from "../../shared/constants";`）を消す。

`deleteCollidingPlans` の定義（`const deleteCollidingPlans = db … .returning({ date: …, meal: … });`）を消し、`deleteCollidingReports` の定義の後ろに足す:

```ts
      // 献立はぶつかっても両方残す。参加する側の行の position を、招待した側の同じ枠の
      // 最大 + 1 だけ後ろへずらす（無ければ 0 のまま）。group_id を付け替える movePlans より
      // 前に、別の文で流す：同じ文で group_id も変えると、相関サブクエリがすでに付け替えた
      // 行を拾い、参加する側の品同士の順番が崩れることがあるため。
      // 同じ枠に同じレシピが入ることは無い（レシピの id はグループごとに別）。
      const shiftMyPlans = db
        .update(s.mealPlans)
        .set({
          position: sql`${s.mealPlans.position} + coalesce((select max(h.position) + 1
            from meal_plans h where h.group_id = ${host}
              and h.date = ${s.mealPlans.date} and h.meal = ${s.mealPlans.meal}), 0)`,
        })
        .where(eq(s.mealPlans.groupId, mine));
```

batch の並びを次にする（`deleteCollidingPlans` を抜き、`shiftMyPlans` を `moveRecipes` の前に）:

```ts
        results = await db.batch([
          insertMember,
          deleteMyMembership,
          deleteCollidingMarks,
          deleteCollidingReports,
          shiftMyPlans,
          moveRecipes,
          moveVersions,
          moveMemos,
          moveImages,
          movePlans,
          moveMarks,
          moveReports,
          deleteInvite,
          deleteMyGroup,
        ]);
```

batch の上のコメント `// 1つのトランザクションで：条件を確かめながら参加 → ぶつかる行は招待した側を残す →` を
`// 1つのトランザクションで：条件を確かめながら参加 → ぶつかる印・報告は招待した側を残し、献立は後ろに並べる →` に変える。

最後の return を次にする:

```ts
      // 並びは上の db.batch([...]) と同じ。6番目（index 5）が moveRecipes
      const [, , , , , movedRecipeRows] = results;
      return { movedRecipes: movedRecipeRows.length };
```

- [ ] **Step 4: shared**（`src/shared/group.ts`）— `const MEAL_LABEL = …` と `planSlotLabel` を丸ごと消す

- [ ] **Step 5: 画面**

`src/web/api/client.ts`:

```ts
export type AcceptResult = { movedRecipes: number };
```

`src/web/pages/JoinGroup.tsx`:
- `import { planSlotLabel } from "../../shared/group";` を消す
- 完了表示の `const { movedRecipes, keptPlans } = accept.data;` を `const { movedRecipes } = accept.data;` にし、`{keptPlans.length > 0 && ( <ul> … </ul> )}` を丸ごと消す
- 説明文を次にする:

```tsx
            <p className="text-sm leading-7 text-[#4a433c]">
              参加すると、あなたのレシピ・献立・買い物リストは{" "}
              {invite.invitedBy || invite.groupName}{" "}
              さんのグループに移り、同じものを一緒に使います。同じ日・同じ食事の献立は、両方並べて残します。参加したあとで抜けることは、今はできません。
            </p>
```

- [ ] **Step 6: 通ることを確認** — `npx vitest run && npm run typecheck && npx eslint src test e2e && npx prettier --check src test e2e` → PASS（`grep -rn "keptPlans\|planSlotLabel" src test` が何も出さないことも確かめる）

- [ ] **Step 7: Commit**

```bash
git add src/api/data/membership.ts src/shared/group.ts src/web/api/client.ts src/web/pages/JoinGroup.tsx test/api/group.test.ts test/shared/group.test.ts
git commit -m "feat: 参加で献立の枠がぶつかったら両方残す（招待した側の品が先）"
```

---

### Task 4: 献立の画面（枠の中に品を並べる・足す・外す・並べ替える）

画面の見た目は TDD の例外。ロジックは Task 1〜2 の API にある。

**Files:**
- Modify: `src/web/api/client.ts`（`PlanEntry`・献立の呼び出し）
- Modify: `src/web/pages/Plan.tsx`（`Plan` を置き換え。`RecipePicker` はそのまま）
- Modify: `e2e/main-flow.spec.ts`（枠のボタンの名前が変わるので1か所）

**Interfaces:**
- Consumes: Task 1・2 の HTTP
- Produces:
  - `PlanEntry = { id: string; date: string; meal: Meal; position: number; recipeId: string; title: string; category: Category }`
  - `apiClient.addPlan(date, meal, recipeId): Promise<void>`、`apiClient.deletePlanItem(id): Promise<void>`、`apiClient.movePlanItem(id, direction: "up" | "down"): Promise<void>`（`setPlan`・`deletePlan` は無くなる）
  - 画面の名前（E2E が使う）: 1日ごとに `<section aria-label="今日">`（今日以外は `"10/3（金）"`）、枠の追加ボタン `"{md} {朝|昼|夜} に品を追加"`、品の題名ボタン = 題名そのまま、`"「{題名}」を上へ"`・`"「{題名}」を下へ"`・`"「{題名}」を{md} {朝|昼|夜}から外す"`

- [ ] **Step 1: client**（`src/web/api/client.ts`）

```ts
export type PlanEntry = {
  id: string;
  date: string;
  meal: Meal;
  /** 枠の中の並び順（小さいほど上） */
  position: number;
  recipeId: string;
  title: string;
  category: Category;
};
```

`setPlan`・`deletePlan` を次に置き換える:

```ts
  /** 枠の最後に1品足す（同じレシピが既にあれば何もしない） */
  addPlan: (date: string, meal: Meal, recipeId: string) =>
    call<void>("/plans", { method: "PUT", json: { date, meal, recipeId } }),
  deletePlanItem: (id: string) =>
    call<void>(`/plans/items/${encodeURIComponent(id)}`, { method: "DELETE" }),
  movePlanItem: (id: string, direction: "up" | "down") =>
    call<void>(`/plans/items/${encodeURIComponent(id)}/move`, {
      method: "POST",
      json: { direction },
    }),
```

- [ ] **Step 2: Plan.tsx**

375px の3列（1枠 約90px）には「題名＋上へ＋下へ＋外す（各 44px）」が入らないので、1日を1枚のカードにし、朝・昼・晩を行にする。`Plan` 関数と import を次に置き換え、ファイル末尾に `IconButton` を足す（`RecipePicker` は変えない）。

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiClient, type PlanEntry } from "@/api/client";
import { Empty, ErrorState, Loading, PageTitle } from "@/components/common";
import { categoryTint } from "@/lib/tint";
import { cn } from "@/lib/utils";
import { MEAL_LABELS, MEALS, type Meal } from "../../shared/constants";
import { addDays, labelDate, todayJst, weekStart } from "../../shared/dates";

export function Plan() {
  const [params, setParams] = useSearchParams();
  const adding = params.get("add");
  const today = todayJst();
  const [start, setStart] = useState(() => weekStart(today));
  const end = addDays(start, 6);
  const [picker, setPicker] = useState<{ date: string; meal: Meal } | null>(
    null,
  );
  const qc = useQueryClient();
  const nav = useNavigate();

  const plans = useQuery({
    queryKey: ["plans", start],
    queryFn: () => apiClient.plans(start, end),
  });
  const addingRecipe = useQuery({
    queryKey: ["recipe", adding],
    queryFn: () => apiClient.getRecipe(adding!),
    enabled: Boolean(adding),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["plans"] });
    void qc.invalidateQueries({ queryKey: ["shopping"] });
  };
  const add = useMutation({
    mutationFn: (p: { date: string; meal: Meal; recipeId: string }) =>
      apiClient.addPlan(p.date, p.meal, p.recipeId),
    onSuccess: () => {
      setPicker(null);
      if (adding) setParams({}, { replace: true });
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiClient.deletePlanItem(id),
    onSuccess: refresh,
  });
  const move = useMutation({
    mutationFn: (p: { id: string; direction: "up" | "down" }) =>
      apiClient.movePlanItem(p.id, p.direction),
    onSuccess: refresh,
  });
  const actionError = add.error ?? remove.error ?? move.error;

  // API が 日付 → 朝昼晩 → 枠の中の順 で返すので、その順のまま枠ごとに分ける
  const bySlot = useMemo(() => {
    const m = new Map<string, PlanEntry[]>();
    for (const p of plans.data?.plans ?? []) {
      const key = `${p.date}|${p.meal}`;
      const list = m.get(key);
      if (list) list.push(p);
      else m.set(key, [p]);
    }
    return m;
  }, [plans.data]);

  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  return (
    <>
      <PageTitle
        aside={
          <div className="flex items-center text-sm font-medium">
            <button
              type="button"
              aria-label="前の週"
              className="flex size-11 items-center justify-center"
              onClick={() => setStart(addDays(start, -7))}
            >
              <ChevronLeft className="size-5" />
            </button>
            {labelDate(start).md}〜{labelDate(end).md}
            <button
              type="button"
              aria-label="次の週"
              className="flex size-11 items-center justify-center"
              onClick={() => setStart(addDays(start, 7))}
            >
              <ChevronRight className="size-5" />
            </button>
          </div>
        }
      >
        献立
      </PageTitle>

      <div className="flex flex-col gap-2 px-5 pb-2">
        {adding && addingRecipe.data && (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-accent-soft px-3 py-2.5 text-[13px] text-accent-deep">
            「{addingRecipe.data.title}」を入れる枠をタップ
            <button
              type="button"
              className="min-h-11 shrink-0 underline"
              onClick={() => setParams({}, { replace: true })}
            >
              やめる
            </button>
          </div>
        )}
        {start !== weekStart(today) && (
          <button
            type="button"
            className="min-h-11 self-start text-xs text-accent underline"
            onClick={() => setStart(weekStart(today))}
          >
            今週に戻る
          </button>
        )}
        {actionError && (
          <p role="alert" className="text-sm text-danger">
            {actionError.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3 px-5 pb-8">
        {plans.isPending && <Loading />}
        {plans.isError && (
          <ErrorState error={plans.error} retry={() => plans.refetch()} />
        )}
        {plans.data &&
          days.map((d) => {
            const l = labelDate(d);
            const past = d < today;
            const isToday = d === today;
            return (
              <section
                key={d}
                aria-label={isToday ? "今日" : `${l.md}（${l.dow}）`}
                className={cn(
                  "flex flex-col gap-2 rounded-2xl border border-line-soft bg-card p-3",
                  past && "opacity-45",
                )}
              >
                <h2
                  className={cn(
                    "flex items-baseline gap-1.5",
                    isToday
                      ? "text-accent"
                      : l.dowIndex === 0
                        ? "text-danger"
                        : l.dowIndex === 6
                          ? "text-[#2f5e8c]"
                          : "text-ink",
                  )}
                >
                  <span className="text-[15px] font-bold">{l.md}</span>
                  <span className="text-xs">
                    {l.dow}
                    {isToday && "・今日"}
                  </span>
                </h2>
                {MEALS.map((meal) => {
                  const items = bySlot.get(`${d}|${meal}`) ?? [];
                  const slot = `${l.md} ${MEAL_LABELS[meal]}`;
                  return (
                    <div key={meal} className="flex gap-2">
                      <span className="w-6 shrink-0 pt-3 text-center text-xs text-sub">
                        {MEAL_LABELS[meal]}
                      </span>
                      <ul className="flex min-w-0 flex-1 flex-col gap-1.5">
                        {items.map((p, i) => (
                          <li
                            key={p.id}
                            className="flex min-h-11 items-center rounded-xl"
                            style={{ background: categoryTint(p.category) }}
                          >
                            <button
                              type="button"
                              onClick={() => nav(`/recipes/${p.recipeId}`)}
                              className="min-h-11 min-w-0 flex-1 px-3 py-2 text-left text-sm leading-snug font-bold"
                            >
                              {p.title}
                            </button>
                            {!past && (
                              <>
                                {i > 0 ? (
                                  <IconButton
                                    label={`「${p.title}」を上へ`}
                                    disabled={move.isPending}
                                    onClick={() =>
                                      move.mutate({ id: p.id, direction: "up" })
                                    }
                                  >
                                    <ChevronUp className="size-4" />
                                  </IconButton>
                                ) : (
                                  <span className="size-11 shrink-0" />
                                )}
                                {i < items.length - 1 ? (
                                  <IconButton
                                    label={`「${p.title}」を下へ`}
                                    disabled={move.isPending}
                                    onClick={() =>
                                      move.mutate({
                                        id: p.id,
                                        direction: "down",
                                      })
                                    }
                                  >
                                    <ChevronDown className="size-4" />
                                  </IconButton>
                                ) : (
                                  <span className="size-11 shrink-0" />
                                )}
                                <IconButton
                                  label={`「${p.title}」を${slot}から外す`}
                                  disabled={remove.isPending}
                                  onClick={() => remove.mutate(p.id)}
                                >
                                  <X className="size-4" />
                                </IconButton>
                              </>
                            )}
                          </li>
                        ))}
                        {!past && (
                          <li>
                            <button
                              type="button"
                              aria-label={`${slot} に品を追加`}
                              disabled={add.isPending}
                              onClick={() => {
                                if (adding)
                                  add.mutate({ date: d, meal, recipeId: adding });
                                else setPicker({ date: d, meal });
                              }}
                              className={cn(
                                "flex min-h-11 w-full items-center justify-center gap-1 rounded-xl border-[1.5px] border-dashed text-sm",
                                adding
                                  ? "border-accent bg-[#fbeee8] text-accent-deep"
                                  : "border-[#d6cdc1] text-faint",
                              )}
                            >
                              <Plus className="size-4" />
                              品を追加
                            </button>
                          </li>
                        )}
                        {past && items.length === 0 && (
                          <li className="flex min-h-11 items-center px-3 text-xs text-faint">
                            なし
                          </li>
                        )}
                      </ul>
                    </div>
                  );
                })}
              </section>
            );
          })}
      </div>

      {picker && (
        <RecipePicker
          label={`${labelDate(picker.date).md}（${labelDate(picker.date).dow}）${MEAL_LABELS[picker.meal]}`}
          onClose={() => setPicker(null)}
          onPick={(id) => add.mutate({ ...picker, recipeId: id })}
        />
      )}
    </>
  );
}
```

ファイルの末尾に足す:

```tsx
function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-11 shrink-0 items-center justify-center text-[#4a433c] disabled:opacity-40"
    >
      {children}
    </button>
  );
}
```

（`text-[#4a433c]`・`text-[#2f5e8c]`・`bg-[#fbeee8]`・`border-[#d6cdc1]` は今の Plan.tsx・JoinGroup.tsx にある値をそのまま使っている。新しい色は足さない）

- [ ] **Step 3: main-flow.spec.ts**（「5. 献立に入れる」の枠のボタン）

```ts
  await page
    .getByRole("button", { name: /に品を追加/ })
    .and(page.locator(":not([disabled])"))
    .last()
    .click();
```

- [ ] **Step 4: 確認** — `npm run typecheck && npx eslint src test e2e && npx prettier --check src test e2e`（prettier で落ちたら `npx prettier --write src/web/pages/Plan.tsx src/web/api/client.ts e2e/main-flow.spec.ts`）

- [ ] **Step 5: 目で確かめる**（任意だが推奨）— Task 5 の E2E のスクリーンショット `test-results/plan-multi-01.png` を開き、375px で題名が読めること・ボタンが重ならないことを見る

- [ ] **Step 6: Commit**

```bash
git add src/web/api/client.ts src/web/pages/Plan.tsx e2e/main-flow.spec.ts
git commit -m "feat: 献立の画面で1つの枠に複数の品を並べ、足す・外す・並べ替える"
```

---

### Task 5: E2E（1つの枠に2品 → 1品外す → 買い物リスト）

**Files:**
- Create: `e2e/plan-multi-dish.spec.ts`

**Interfaces:**
- Consumes: Task 4 の画面の名前（`region "今日"`・`"{md} 夜 に品を追加"`・`"「{題名}」を上へ／下へ"`・`"「{題名}」を{md} 夜から外す"`）、買い物の「今日」ボタン、ナビの「買い物」リンク

- [ ] **Step 1: テスト**

```ts
import { expect, test, type Page } from "@playwright/test";

// 献立の1つの枠（今日の夜）に2品足し、1品外すと、買い物リストには残った品の材料だけが出る
async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@example.test").fill(email);
  await page.getByPlaceholder("パスワード（8文字以上）").fill("password-1234");
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByRole("heading", { name: /レシピ/ })).toBeVisible();
}

async function makeRecipe(page: Page, title: string, ingredient: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "レシピを追加" }).click();
  await page.getByRole("button", { name: /ゼロから自分で作る/ }).click();
  await page.locator("#recipe-title").fill(title);
  await page.getByLabel("材料1の名前").fill(ingredient);
  await page.getByLabel("材料1の分量").fill("1本");
  await page.getByLabel("手順1").fill("煮る");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

test("1つの枠に2品足して1品外すと、買い物リストには残った品の材料が出る", async ({
  page,
}) => {
  await login(page, `e2e-dish-${Date.now()}@example.test`);
  await makeRecipe(page, "さばの味噌煮", "さば");
  await makeRecipe(page, "けんちん汁", "ごぼう");

  await page.goto("/plan");
  const today = page.getByRole("region", { name: "今日" });
  const addDinner = today.getByRole("button", { name: /夜 に品を追加/ });

  await addDinner.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /さばの味噌煮/ })
    .click();
  await expect(
    today.getByRole("button", { name: "さばの味噌煮", exact: true }),
  ).toBeVisible();

  await addDinner.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /けんちん汁/ })
    .click();
  await expect(
    today.getByRole("button", { name: "けんちん汁", exact: true }),
  ).toBeVisible();
  // 2品目は1品目の下に付く（上の品は「下へ」、下の品は「上へ」だけ出る）
  await expect(
    today.getByRole("button", { name: "「さばの味噌煮」を下へ" }),
  ).toBeVisible();
  await expect(
    today.getByRole("button", { name: "「けんちん汁」を上へ" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/plan-multi-01.png",
    fullPage: true,
  });

  await today.getByRole("button", { name: /「さばの味噌煮」を.*から外す/ }).click();
  await expect(
    today.getByRole("button", { name: "さばの味噌煮", exact: true }),
  ).toHaveCount(0);
  await expect(
    today.getByRole("button", { name: "けんちん汁", exact: true }),
  ).toBeVisible();

  await page.getByRole("link", { name: "買い物" }).click();
  await page.getByRole("button", { name: "今日", exact: true }).click();
  await expect(page.getByText("ごぼう")).toBeVisible();
  await expect(page.getByText("さば", { exact: true })).toHaveCount(0);
  await page.screenshot({
    path: "test-results/plan-multi-02-shopping.png",
    fullPage: true,
  });
});
```

- [ ] **Step 2: 実行**

`.dev.vars` は作らない・読まない。ダミーの Google の値も入れない（ログイン画面が変わって E2E が落ちる）。環境変数で渡す:

```bash
CLOUDFLARE_INCLUDE_PROCESS_ENV=true DEV_LOGIN=1 BETTER_AUTH_SECRET=$(openssl rand -hex 32) BETTER_AUTH_URL=http://localhost:5173 npm run e2e
```

Expected: 全部 PASS（main-flow 2件・invite・paste-import・plan-multi-dish）。5173 が他で使われていたら止めてから（`reuseExistingServer` で別のアプリに当たるため）。ローカル D1 のマイグレーションが古いと失敗するので、先に `npm run db:migrate:local` を流す（開発用のローカル D1。本番ではない）。

- [ ] **Step 3: Commit**

```bash
git add e2e/plan-multi-dish.spec.ts
git commit -m "test: 献立の1つの枠に2品足して1品外す E2E"
```

---

### Task 6: 決まりごとの更新と仕上げ

**Files:**
- Modify: `docs/spec.md`（機能表の 10 行目、§6 の献立の行）
- Modify: `README.md`（「2回目以降は…」の行）
- Modify: `docs/superpowers/specs/2026-09-29-group-invite-design.md`（「後で変えること」の行）

- [ ] **Step 1: spec.md**

機能表の 10 行目の説明を:
```md
| 10 | 献立：週の 日付 × 朝昼晩 に何品でも（同じレシピは1枠に1回まで）。品ごとに外す・上下に並べ替える。過ぎた日は薄く表示し、変えられない | なし | 実装済・本番未反映 | M3 |
```

§6 の献立の行を:
```md
- **献立**（meal_plans）は「日付 × 朝昼晩 × 並び順（position）つきの複数レシピ」。1枠に複数品、同じレシピは1枠に1回まで。参加でぶつかった枠は両方残し、招待した側の品が先
```

- [ ] **Step 2: README.md**（「2回目以降は `npm run db:migrate:remote`（マイグレーションが増えたときだけ）と `npm run deploy` だけ。」を置き換える）

```md
2回目以降は `npm run db:migrate:remote`（マイグレーションが増えたときだけ）と `npm run deploy` だけ。
マイグレーションの前には、本番 D1 のバックアップを取る（`npx wrangler d1 export mairecipe --remote --output=backup-<日付>.sql`。このファイルはコミットしない）。マイグレーションとデプロイの間は空けない。
```

- [ ] **Step 3: group-invite の設計**（20 行目「後で変えること: …」の行末に足す）

```md
→ #37 で対応済み（両方残し、招待した側の品が先。`docs/superpowers/specs/2026-09-29-meal-multi-dish-design.md`）
```

- [ ] **Step 4: 全体の確認**

```bash
npx eslint src test e2e && npx prettier --check src test e2e && npm run typecheck && npm run test
```

（docs/・README.md は .prettierignore に入っているので確認の対象外）

Expected: すべて PASS。`git status --short` で `apps/`・`supabase/` 以外に未コミットの変更が無いこと。

- [ ] **Step 5: Commit**

```bash
git add docs/spec.md README.md docs/superpowers/specs/2026-09-29-group-invite-design.md
git commit -m "docs: 献立は1枠に複数品（並び順つき）に更新"
```

- [ ] **Step 6: 仕上げ（controller）** — reviewer（Critical の観点は「forGroup 経由・セッションからの判定・漏れのテスト」の3点＋ Review Focus の5点）→ 指摘を直す → PR（base は `feat/group-invite`、`Closes #37`。本文に Task 1 Step 9 のローカル D1 の確認結果と、下の「本番への反映」を貼る）。**本番 D1 へのマイグレーションとデプロイはここでは行わない**

---

## 本番への反映（Eiichi に渡す手順。controller はここで止めて聞く）

この計画の範囲は PR まで。`npm run db:migrate:remote` と `npm run deploy` は Eiichi の OK が出てから、次の手順をそのまま渡す。
③マイグレーションから⑤デプロイまでの間、古いコードの「枠を上書き」（`on conflict (group_id, date, meal)`）は索引が無くなるので失敗する。③と⑤の間は空けない。

```bash
# ① 移行前の件数を控える
npx wrangler d1 execute mairecipe --remote --command "select count(*) as n from meal_plans"

# ② バックアップ（どちらか。両方でもよい）
npx wrangler d1 export mairecipe --remote --output=backup-meal-plans-$(date +%Y%m%d-%H%M).sql
npx wrangler d1 time-travel info mairecipe    # 表示された bookmark（今の時刻）を控える

# ③ マイグレーション（0003 だけが当たることを表示で確かめてから y）
npm run db:migrate:remote

# ④ 件数が①と同じこと、position がすべて 0 のこと
npx wrangler d1 execute mairecipe --remote --command "select count(*) as n, max(position) as max_position from meal_plans"

# ⑤ すぐデプロイ
npm run deploy
```

- ④で件数が違ったら、デプロイせずに止めて Claude に知らせる。戻すときは `npx wrangler d1 time-travel restore mairecipe --bookmark=<②で控えた bookmark>`
- 反映後の確認：スマホで献立を開き、今日の夜に2品足す → 1品外す → 買い物リストに残った品の材料が出る。PWA が古い画面のままなら一度閉じて開き直す
- バックアップの `.sql` はコミットしない
