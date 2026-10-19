# おすすめと「これを使いたい」（#38 PR2）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 冷蔵庫の画面に「今日のおすすめ」の1食セット（主菜・副菜・汁物）を出して1タップで献立の夜に入れられるようにし、冷蔵庫で食材を選んで「これを使いたい」でレシピを探せるようにする。

**Architecture:** 点数とセットの組み方は `src/shared/recommend.ts` の純粋関数（テスト必須）。API は `GET /api/recommend` 1本で、データ層に「レシピ（分類・更新日時・最新版の材料）」を読む関数を1つ足す。冷蔵庫と献立は既存の `listPantry` / `listPlans` を使う。「これを使いたい」は既存の `POST /api/recipes/find` をそのまま使う。画面は冷蔵庫の上におすすめカード、一覧に選ぶチェック。

**Tech Stack:** Cloudflare Workers + Hono、D1 + Drizzle、React 19 + TanStack Query + Tailwind v4、Vitest、Playwright

**Spec:** `docs/superpowers/specs/2026-09-30-pantry-and-recommend-design.md`（§3 PR2・§4・§5 の「今日のおすすめ」「これを使いたい」）。見た目の正はデモ https://claude.ai/artifact/Jwzq7gsnhqUNM13qGNguSC の冷蔵庫タブ

## Global Constraints

- グループの判定はセッションからだけ。DB は `src/api/data/` の `forGroup` 経由だけ。routes から DB を直接触らない（ESLint で禁止）
- 新しい API には `test/api` に「グループをまたいだ漏れがないこと」を足す（他人のレシピがおすすめに出ない・他人の冷蔵庫が効かない）
- Worker の CPU は 10ms まで。点数は名前の比較だけにする
- 検索条件・集計に SQLite 独自関数を使わない
- AI は使わない（DEC-012）
- 画面: 日本語、375px 基準、タップ領域 44px 以上、ローディング／エラー／空状態。`confirm()` は使わない。色は `src/web/index.css` の @theme のトークン（text-white は既存の慣習で可）。API は `src/web/api/client.ts` 経由だけ。トーストは既存の `src/web/components/Toast.tsx`（useToast / Toast）を使う
- 分類: main＝主菜・丼、side＝副菜、soup＝汁物。デザート・その他は出さない。入れる先は夜（dinner）だけ
- コミットの最後に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- マイグレーションは無い

## Review Focus

1. 冷蔵庫が空・レシピが0件・ある分類だけレシピが無いとき、カードが壊れない（無い分類の行は出さない。全部無ければカードごと出さない）→ Task 1 のテストと Task 3
2. 候補が1件の分類で ⇄ を押しても同じレシピのまま落ちない（剰余で回る）→ Task 1
3. 「これを使いたい」で11個以上は選べない（find の上限10）→ Task 4
4. 同じレシピがすでにその夜に入っていても、入れる操作が失敗しない（API は重複を無視する）→ Task 3 で入れる前後の件数を気にしない作り
5. 期限が過ぎた食材も「期限が近い」として加点される → Task 1

---

## File Structure

| ファイル | 役割 |
|---|---|
| Create `src/shared/recommend.ts` / `test/shared/recommend.test.ts` | 点数・分類ごとの並び・セットの組み方・最初に空いている夜 |
| Modify `src/api/data/index.ts` | `recommendRecipes()` を足す |
| Create `src/api/routes/recommend.ts` / Modify `src/api/index.ts` | `GET /api/recommend` |
| Create `test/api/recommend.test.ts` | API と漏れのテスト |
| Modify `src/web/api/client.ts` | `recommend()` |
| Create `src/web/components/RecoCard.tsx` / Modify `src/web/pages/Fridge.tsx` | おすすめカード |
| Modify `src/web/pages/Fridge.tsx` | 選ぶチェックと「これを使いたい」 |
| Create `e2e/recommend.spec.ts` / Modify `docs/spec.md` | E2E と仕様 |

---

### Task 1: 点数とセットの組み方（`src/shared/recommend.ts`）

**Files:**
- Create: `src/shared/recommend.ts`
- Test: `test/shared/recommend.test.ts`

**Interfaces:**
- Consumes: `canonicalName`, `matchesIngredient`（`src/shared/ingredients.ts`）、`isSeasoning`, `isExpiringSoon`（`src/shared/pantry.ts`）、`addDays`（`src/shared/dates.ts`）、`Ingredient`（`src/shared/recipe.ts`）
- Produces:
  - `RECO_SLOTS = ["main", "side", "soup"] as const`、`type RecoSlot = (typeof RECO_SLOTS)[number]`
  - `slotOf(category: string): RecoSlot | null`（主菜・丼→main、副菜→side、汁物→soup、ほかは null）
  - `type RecoRecipe = { id: string; title: string; category: string; updatedAt: number; ingredients: Ingredient[] }`
  - `type RecoPantry = { name: string; expiresOn: string | null }`
  - `type RecoPlan = { recipeId: string; date: string }`
  - `type Reco = { id: string; title: string; category: string; have: string[]; soon: string[] }`
  - `type RecoLists = Record<RecoSlot, Reco[]>`
  - `RECO_LIMIT = 10`
  - `scoreRecipe(r: RecoRecipe, pantry: RecoPantry[], plans: RecoPlan[], today: string): { score: number; have: string[]; soon: string[] }`
  - `rankRecommendations(recipes: RecoRecipe[], pantry: RecoPantry[], plans: RecoPlan[], today: string): RecoLists`（各分類 RECO_LIMIT 件まで）
  - `pickSet(lists: RecoLists, round: number, swaps: Record<RecoSlot, number>): { slot: RecoSlot; reco: Reco }[]`
  - `firstEmptyDinner(plans: { date: string; meal: string }[], today: string): string`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// test/shared/recommend.test.ts
import { describe, expect, it } from "vitest";
import {
  firstEmptyDinner,
  pickSet,
  rankRecommendations,
  scoreRecipe,
  slotOf,
  type RecoRecipe,
} from "../../src/shared/recommend";

const T = "2026-09-30";
const r = (
  id: string,
  category: string,
  names: string[],
  updatedAt = 0,
): RecoRecipe => ({
  id,
  title: id,
  category,
  updatedAt,
  ingredients: names.map((name) => ({ name, amount: "" })),
});

describe("分類", () => {
  it("主菜と丼は main、副菜は side、汁物は soup、ほかは出さない", () => {
    expect(slotOf("主菜")).toBe("main");
    expect(slotOf("丼")).toBe("main");
    expect(slotOf("副菜")).toBe("side");
    expect(slotOf("汁物")).toBe("soup");
    expect(slotOf("デザート")).toBeNull();
    expect(slotOf("その他")).toBeNull();
  });
});

describe("点数", () => {
  it("調味料を除いた材料のうち、冷蔵庫にある割合 × 100。名寄せと「材料から探す」と同じ当て方", () => {
    const s = scoreRecipe(
      r("a", "主菜", ["鶏むね肉", "たまねぎ", "ピーマン", "醤油", "砂糖"]),
      [
        { name: "玉ねぎ", expiresOn: null },
        { name: "鶏肉", expiresOn: null },
      ],
      [],
      T,
    );
    expect(s.score).toBeCloseTo((2 / 3) * 100);
    expect(s.have).toEqual(["鶏むね肉", "たまねぎ"]);
    expect(s.soon).toEqual([]);
  });

  it("主な材料が0なら0点", () => {
    expect(scoreRecipe(r("a", "汁物", ["味噌"]), [], [], T).score).toBe(0);
  });

  it("期限が3日以内（過ぎたものも）の食材を使うと、1つにつき +15", () => {
    const s = scoreRecipe(
      r("a", "主菜", ["鮭", "しめじ", "玉ねぎ"]),
      [
        { name: "鮭", expiresOn: "2026-10-03" },
        { name: "しめじ", expiresOn: "2026-09-28" },
        { name: "玉ねぎ", expiresOn: "2026-10-10" },
      ],
      [],
      T,
    );
    expect(s.score).toBeCloseTo(100 + 30);
    expect(s.soon).toEqual(["鮭", "しめじ"]);
  });

  it("過去7日の献立に入っていたら −25、今日から6日後までに入っていたら −60（両方なら両方）", () => {
    const rec = r("a", "主菜", ["鮭"]);
    const pantry = [{ name: "鮭", expiresOn: null }];
    expect(
      scoreRecipe(rec, pantry, [{ recipeId: "a", date: "2026-09-23" }], T)
        .score,
    ).toBe(75);
    expect(
      scoreRecipe(rec, pantry, [{ recipeId: "a", date: "2026-09-22" }], T)
        .score,
    ).toBe(100);
    expect(
      scoreRecipe(rec, pantry, [{ recipeId: "a", date: "2026-10-06" }], T)
        .score,
    ).toBe(40);
    expect(
      scoreRecipe(rec, pantry, [{ recipeId: "a", date: "2026-10-07" }], T)
        .score,
    ).toBe(100);
    expect(
      scoreRecipe(
        rec,
        pantry,
        [
          { recipeId: "a", date: "2026-09-29" },
          { recipeId: "a", date: T },
        ],
        T,
      ).score,
    ).toBe(15);
  });
});

describe("分類ごとの並び", () => {
  it("点数 → 更新が新しい順 → 名前。デザートは出さず、各10件まで", () => {
    const recipes = [
      r("古い主菜", "主菜", ["鮭"], 1),
      r("新しい主菜", "主菜", ["鮭"], 2),
      r("丼", "丼", ["玉ねぎ"], 3),
      r("副菜", "副菜", ["ほうれん草"], 0),
      r("プリン", "デザート", ["卵"], 9),
      ...Array.from({ length: 12 }, (_, i) =>
        r(`汁物${String(i).padStart(2, "0")}`, "汁物", ["豆腐"], 0),
      ),
    ];
    const lists = rankRecommendations(
      recipes,
      [{ name: "鮭", expiresOn: null }],
      [],
      T,
    );
    expect(lists.main.map((x) => x.id)).toEqual(["新しい主菜", "古い主菜", "丼"]);
    expect(lists.side.map((x) => x.id)).toEqual(["副菜"]);
    expect(lists.soup).toHaveLength(10);
    expect(lists.soup[0]!.id).toBe("汁物00");
    expect(lists.main[0]).toEqual({
      id: "新しい主菜",
      title: "新しい主菜",
      category: "主菜",
      have: ["鮭"],
      soon: [],
    });
  });
});

describe("セットの組み方", () => {
  const reco = (id: string) => ({
    id,
    title: id,
    category: "",
    have: [],
    soon: [],
  });
  const lists = {
    main: [reco("m0"), reco("m1"), reco("m2")],
    side: [reco("s0")],
    soup: [],
  };
  it("組み合わせ番号と ⇄ の回数の和を、候補の数で割った余り番目。レシピの無い分類は出さない", () => {
    expect(
      pickSet(lists, 0, { main: 0, side: 0, soup: 0 }).map((x) => [
        x.slot,
        x.reco.id,
      ]),
    ).toEqual([
      ["main", "m0"],
      ["side", "s0"],
    ]);
    expect(
      pickSet(lists, 1, { main: 1, side: 5, soup: 2 }).map((x) => x.reco.id),
    ).toEqual(["m2", "s0"]);
    expect(
      pickSet(lists, 2, { main: 2, side: 0, soup: 0 }).map((x) => x.reco.id),
    ).toEqual(["m1", "s0"]);
  });
});

describe("最初に空いている夜", () => {
  it("今日から14日以内で夜が空いている最初の日。無ければ今日", () => {
    expect(firstEmptyDinner([], T)).toBe(T);
    expect(
      firstEmptyDinner(
        [
          { date: T, meal: "dinner" },
          { date: "2026-10-01", meal: "lunch" },
        ],
        T,
      ),
    ).toBe("2026-10-01");
    const full = Array.from({ length: 14 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 8, 30 + i)).toISOString().slice(0, 10),
      meal: "dinner",
    }));
    expect(firstEmptyDinner(full, T)).toBe(T);
  });
});
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run test/shared/recommend.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 実装する**

```ts
// src/shared/recommend.ts
// 冷蔵庫と献立から、保存したレシピに点数を付けて「今日のおすすめ」を作る。AI は使わない。
import { addDays } from "./dates";
import { canonicalName, matchesIngredient } from "./ingredients";
import { isExpiringSoon, isSeasoning } from "./pantry";
import type { Ingredient } from "./recipe";

export const RECO_SLOTS = ["main", "side", "soup"] as const;
export type RecoSlot = (typeof RECO_SLOTS)[number];
export const RECO_LIMIT = 10;

export type RecoRecipe = {
  id: string;
  title: string;
  category: string;
  updatedAt: number;
  ingredients: Ingredient[];
};
export type RecoPantry = { name: string; expiresOn: string | null };
export type RecoPlan = { recipeId: string; date: string };
export type Reco = {
  id: string;
  title: string;
  category: string;
  /** 冷蔵庫にある主な材料（レシピ側の表記） */
  have: string[];
  /** have のうち期限が近いもの */
  soon: string[];
};
export type RecoLists = Record<RecoSlot, Reco[]>;

/** 期限が近い食材1つあたりの加点 */
const SOON_BONUS = 15;
/** 過去7日の献立に入っていたときの減点 */
const RECENT_PENALTY = 25;
/** 今日から6日後までの献立に入っているときの減点 */
const PLANNED_PENALTY = 60;

export function slotOf(category: string): RecoSlot | null {
  if (category === "主菜" || category === "丼") return "main";
  if (category === "副菜") return "side";
  if (category === "汁物") return "soup";
  return null;
}

export function scoreRecipe(
  r: RecoRecipe,
  pantry: RecoPantry[],
  plans: RecoPlan[],
  today: string,
): { score: number; have: string[]; soon: string[] } {
  // 調味料を除き、名寄せした名前で重複を消した「主な材料」（表記はレシピ側の最初のもの）
  const seen = new Set<string>();
  const main: string[] = [];
  for (const ing of r.ingredients) {
    const c = canonicalName(ing.name);
    if (!c || isSeasoning(c) || seen.has(c)) continue;
    seen.add(c);
    main.push(ing.name.trim());
  }
  const have: string[] = [];
  const soon: string[] = [];
  for (const name of main) {
    const hit = pantry.find((p) => matchesIngredient(p.name, name));
    if (!hit) continue;
    have.push(name);
    if (isExpiringSoon(hit.expiresOn, today)) soon.push(name);
  }
  let score = main.length ? (have.length / main.length) * 100 : 0;
  score += soon.length * SOON_BONUS;
  const mine = plans.filter((p) => p.recipeId === r.id);
  if (mine.some((p) => p.date >= addDays(today, -7) && p.date < today))
    score -= RECENT_PENALTY;
  if (mine.some((p) => p.date >= today && p.date <= addDays(today, 6)))
    score -= PLANNED_PENALTY;
  return { score, have, soon };
}

export function rankRecommendations(
  recipes: RecoRecipe[],
  pantry: RecoPantry[],
  plans: RecoPlan[],
  today: string,
): RecoLists {
  const scored = recipes
    .map((r) => ({ r, slot: slotOf(r.category), ...scoreRecipe(r, pantry, plans, today) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.r.updatedAt - a.r.updatedAt ||
        a.r.title.localeCompare(b.r.title, "ja"),
    );
  const lists: RecoLists = { main: [], side: [], soup: [] };
  for (const x of scored) {
    if (!x.slot || lists[x.slot].length >= RECO_LIMIT) continue;
    lists[x.slot].push({
      id: x.r.id,
      title: x.r.title,
      category: x.r.category,
      have: x.have,
      soon: x.soon,
    });
  }
  return lists;
}

/** 組み合わせ番号 round と、分類ごとの ⇄ の回数から、今出すセットを選ぶ。レシピの無い分類は出さない */
export function pickSet(
  lists: RecoLists,
  round: number,
  swaps: Record<RecoSlot, number>,
): { slot: RecoSlot; reco: Reco }[] {
  const out: { slot: RecoSlot; reco: Reco }[] = [];
  for (const slot of RECO_SLOTS) {
    const list = lists[slot];
    if (!list.length) continue;
    out.push({ slot, reco: list[(round + swaps[slot]) % list.length]! });
  }
  return out;
}

/** 今日から14日以内で夜が空いている最初の日。無ければ今日 */
export function firstEmptyDinner(
  plans: { date: string; meal: string }[],
  today: string,
): string {
  for (let i = 0; i < 14; i++) {
    const d = addDays(today, i);
    if (!plans.some((p) => p.date === d && p.meal === "dinner")) return d;
  }
  return today;
}
```

注意: 1つ目の点数テストの `鶏肉` → `鶏むね肉` は `matchesIngredient` の「◯肉」の規則で当たる。当たらなければ `matchesIngredient` の実装を確かめ、テストではなく照合の引数の順（`matchesIngredient(term=冷蔵庫の名前, name=材料名)`）を直す。

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run test/shared/recommend.test.ts && npm run lint && npm run typecheck`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/shared/recommend.ts test/shared/recommend.test.ts
git commit -m "feat: おすすめの点数・分類ごとの並び・セットの組み方"
```

---

### Task 2: `GET /api/recommend` と漏れのテスト

**Files:**
- Modify: `src/api/data/index.ts`（`allLatestIngredients` の下に足す）
- Create: `src/api/routes/recommend.ts`
- Modify: `src/api/index.ts`（`api.route("/recommend", recommend);` を `/pantry` の次に）
- Test: `test/api/recommend.test.ts`

**Interfaces:**
- Consumes: Task 1 の `rankRecommendations`, `RecoRecipe`、既存の `listPantry()`, `listPlans(from, to)`, `latestVersionsInGroup()`, `inGroup`
- Produces:
  - `forGroup`: `recommendRecipes(): Promise<RecoRecipe[]>`（自分のグループのレシピの id・title・category・updatedAt（ミリ秒の数）・最新版の材料）
  - `GET /api/recommend` → `{ main: Reco[]; side: Reco[]; soup: Reco[]; today: string }`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// test/api/recommend.test.ts
import { describe, expect, it } from "vitest";
import { todayJst } from "../../src/shared/dates";
import { api, sampleRecipe, signUp } from "./helpers";

type Reco = { id: string; title: string; category: string; have: string[]; soon: string[] };
type Lists = { main: Reco[]; side: Reco[]; soup: Reco[]; today: string };

async function create(cookie: string, title: string, category: string, names: string[]) {
  const res = await api(cookie, "/recipes", {
    method: "POST",
    body: {
      ...sampleRecipe,
      title,
      category,
      ingredients: names.map((name) => ({ name, amount: "1個" })),
    },
  });
  return ((await res.json()) as { id: string }).id;
}
const reco = async (c: string) => (await (await api(c, "/recommend")).json()) as Lists;

describe("おすすめ", () => {
  it("冷蔵庫の食材を多く使う順。分類ごとに分かれ、デザートは出ない", async () => {
    const me = await signUp();
    const a = await create(me, "鮭のホイル焼き", "主菜", ["鮭", "しめじ", "醤油"]);
    const b = await create(me, "親子丼", "丼", ["鶏もも肉", "卵"]);
    const c = await create(me, "豚汁", "汁物", ["豚こま肉", "大根"]);
    await create(me, "プリン", "デザート", ["卵"]);
    await api(me, "/pantry", { method: "POST", body: { names: ["鮭", "しめじ", "卵"] } });
    const r = await reco(me);
    expect(r.today).toBe(todayJst());
    expect(r.main.map((x) => x.id)).toEqual([a, b]);
    expect(r.main[0]).toMatchObject({ category: "主菜", have: ["鮭", "しめじ"] });
    expect(r.side).toEqual([]);
    expect(r.soup.map((x) => x.id)).toEqual([c]);
  });

  it("今週の献立にもう入っているレシピは下がる", async () => {
    const me = await signUp();
    const a = await create(me, "A", "主菜", ["鮭"]);
    const b = await create(me, "B", "主菜", ["鮭"]);
    await api(me, "/pantry", { method: "POST", body: { names: ["鮭"] } });
    await api(me, "/plans", {
      method: "PUT",
      body: { date: todayJst(), meal: "dinner", recipeId: b },
    });
    expect((await reco(me)).main.map((x) => x.id)).toEqual([a, b]);
  });

  it("グループをまたいだ漏れがない：他人のレシピは出ず、他人の冷蔵庫は効かない", async () => {
    const alice = await signUp();
    const bob = await signUp();
    await create(alice, "Aの主菜", "主菜", ["鮭"]);
    const mine = await create(bob, "Bの主菜", "主菜", ["鮭"]);
    await api(alice, "/pantry", { method: "POST", body: { names: ["鮭"] } });
    const r = await reco(bob);
    expect(r.main.map((x) => x.id)).toEqual([mine]);
    expect(r.main[0]!.have).toEqual([]);
  });

  it("ログインしていなければ 401", async () => {
    expect((await api(null, "/recommend")).status).toBe(401);
  });
});
```

注意: 2つ目のテストの A と B は同点になり得ない（B は −60）。1つ目の `親子丼` は卵が当たって 50 点、`鮭のホイル焼き` は 100 点。

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run test/api/recommend.test.ts`
Expected: FAIL（404）

- [ ] **Step 3: 実装する**

`src/api/data/index.ts` に `import type { RecoRecipe } from "../../shared/recommend";` を足し、`allLatestIngredients` の下に:

```ts
    /** おすすめ用：レシピの分類・更新日時と、最新版の材料 */
    async recommendRecipes(): Promise<RecoRecipe[]> {
      const [latest, rows] = await Promise.all([
        latestVersionsInGroup(),
        db
          .select({
            id: s.recipes.id,
            title: s.recipes.title,
            category: s.recipes.category,
            updatedAt: s.recipes.updatedAt,
          })
          .from(s.recipes)
          .where(inGroup),
      ]);
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        category: r.category,
        updatedAt: r.updatedAt.getTime(),
        ingredients: latest.get(r.id)?.ingredients ?? [],
      }));
    },
```

```ts
// src/api/routes/recommend.ts
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
```

`src/api/index.ts` に import と `api.route("/recommend", recommend);`。

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run test/api/recommend.test.ts && npm run test && npm run lint && npm run typecheck`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/api test/api/recommend.test.ts
git commit -m "feat: おすすめの API（冷蔵庫と献立から分類ごとに点数順）"
```

---

### Task 3: 今日のおすすめカード

**Files:**
- Modify: `src/web/api/client.ts`
- Create: `src/web/components/RecoCard.tsx`
- Modify: `src/web/pages/Fridge.tsx`（一覧の見出しの上にカードを置く）

**Interfaces:**
- Consumes: Task 1 の `pickSet`, `firstEmptyDinner`, `RECO_SLOTS`, `Reco`, `RecoSlot`、`apiClient.plans(from, to)`, `apiClient.addPlan(date, "dinner", recipeId)`、`labelDate`, `addDays`、Toast
- Produces:
  - `apiClient.recommend: () => call<{ main: Reco[]; side: Reco[]; soup: Reco[]; today: string }>("/recommend")`（`Reco`・`RecoLists` 型は `src/shared/recommend.ts` から import）
  - `RecoCard({ onToast }: { onToast: (msg: string) => void })`（冷蔵庫の画面が持つトーストに出す）
  - 献立の読み込みは queryKey `["plans", today, addDays(today, 13)]`（Task 4 も同じキーを使う）

- [ ] **Step 1: client に足す**

- [ ] **Step 2: カードを作る**（デモの「今日のおすすめ」と同じ見た目・動き）
- `useQuery(["recommend"], apiClient.recommend)` と、`today` が分かったら `useQuery(["plans", today, addDays(today, 13)], () => apiClient.plans(today, addDays(today, 13)))`
- state: `round`（0）、`swaps`（`{ main: 0, side: 0, soup: 0 }`）、`off: RecoSlot[]`（外した分類）、`target: string | null`（null なら `firstEmptyDinner(plans, today)`）
- 読み込み中は `<Loading label="おすすめを考えています…" />`、エラーは `<ErrorState error retry />`。`pickSet` が空（どの分類にもレシピが無い）ならカードを出さない（`return null`）
- 見た目: `rounded-2xl border border-line bg-card p-3.5 flex flex-col gap-3`。見出し行に「今日のおすすめ」（太字16px）と右に「⇄ ほかの組み合わせ」（accent の文字ボタン、高さ 44px、押すと `round+1`・`swaps` を0に・`off` を空に）
- 1品1行（`ul`、行の間に薄い線）。行の左側全体が1つのボタン（`aria-pressed={on}`、高さ 56px 以上）: 22px の四角（on で herb の塗り＋白いチェック）、分類（`reco.category`、11px・faint・幅28px）、レシピ名（15px 太字・1行で省略）、その下に使う食材（12px sub。`soon` にあるものは `text-danger font-bold`。`have` が空なら「冷蔵庫の食材は使いません」）。off の行は名前と食材を faint＋取り消し線。押すと off を切り替え
- 行の右に ⇄ ボタン（44×44、`aria-label={`${reco.category}を別のレシピに替える`}`、その分類の候補が1件なら disabled）。押すと `swaps[slot]+1`（off はそのまま）
- 下に PrimaryButton（幅いっぱい）: 選んだ数 n>0 なら `${labelDate(target).md}の夜に ${n}品入れる`、0 なら disabled で「入れる品を選んでください」
- その下に「‹ 前の日」「次の日 ›」（左右端、accent の文字ボタン、高さ 44px）。前の日は target が today のとき disabled。押すと target を ±1 日
- 入れる: 選んだ品を順に `await apiClient.addPlan(target, "dinner", id)`（同時に投げない。枠の並び順が崩れないように）。成功で `onToast(`${md}（${dow}）の夜に${n}品入れました。献立タブで見られます`)`、`off`・`target` を戻し、`invalidateQueries` に `["plans"]`・`["recommend"]`・`["shopping"]`。失敗は `onToast(apiErrorMessage(e))`（`src/web/lib/utils.ts`）。実行中はボタンを disabled
- `Fridge.tsx`: `PageTitle` の下、「冷蔵庫の中（n）」の見出しの上に `<RecoCard onToast={show} />`。冷蔵庫の追加・使い切った・直すの成功時に `["recommend"]` も invalidate する

- [ ] **Step 3: 型と lint、動かして見る**

Run: `npm run typecheck && npm run lint && npm run test`。`npm run dev` で 375px 幅の /fridge を開き、主菜・副菜・汁物のレシピを1つずつ作ってから、行の切り替え・⇄・ほかの組み合わせ・日の移動・入れる→献立タブで確認

- [ ] **Step 4: コミット**

```bash
git add src/web
git commit -m "feat: 冷蔵庫の画面に今日のおすすめ（1食セットを夜に入れる）"
```

---

### Task 4: 選ぶチェックと「これを使いたい」

**Files:**
- Modify: `src/web/pages/Fridge.tsx`

**Interfaces:**
- Consumes: `apiClient.find(terms)`（`FindResult = { id, title, matched, total, have, missing }`）、`apiClient.addPlan`、Task 1 の `firstEmptyDinner`、Task 3 の plans の queryKey `["plans", today, addDays(today, 13)]`
- Produces: なし（最後の画面）

- [ ] **Step 1: 実装する**
- 各行の左に選ぶチェック（見た目 28px の四角、押せる範囲は 44×44。`aria-pressed`、`aria-label={`${name}を選ぶ`}`。on で herb の塗り＋白いチェック）。選んだ名前は `selected: string[]`（冷蔵庫の一覧の並び順）。**10個まで**（11個目は選ばずトースト「10個まで選べます」）。使い切った食材は選択からも外す
- 一覧の上の見出し行の右に小さく「食材を選ぶと「これを使いたい」」（faint・11.5px）
- 1つ以上選ぶと、一覧の下に PrimaryButton（幅いっぱい）`${n}個を使いたい → レシピを探す`。押すと `terms = [...selected]` を固定して `useQuery({ queryKey: ["find", terms], queryFn: () => apiClient.find(terms), enabled: terms.length > 0 })`。選び直したら結果は消す（terms を空に）
- 結果: 見出し `「${terms.join("・")}」を使うレシピ`、`ul` のカード。各行: レシピ名（15px、押すと `/recipes/:id` へ `Link`）、その下に `${matched}個使う：${have.join("・")}`（herb・太字・11.5px）、右に「献立へ」（44px 以上）。押すと `firstEmptyDinner(plans, today)` の夜に `addPlan`、トースト `${md}（${dow}）の夜に入れました`、`["plans"]`・`["recommend"]`・`["shopping"]` を invalidate
- 読み込み中 `<Loading />`、エラー `<ErrorState />`、0件 `<Empty>保存したレシピには、この食材を使うものがありません。</Empty>`

- [ ] **Step 2: 型と lint、動かして見る**

Run: `npm run typecheck && npm run lint && npm run test`。dev で食材を2つ選んで結果と「献立へ」を確かめる

- [ ] **Step 3: コミット**

```bash
git add src/web/pages/Fridge.tsx
git commit -m "feat: 冷蔵庫で食材を選んで「これを使いたい」"
```

---

### Task 5: E2E と仕様書

**Files:**
- Create: `e2e/recommend.spec.ts`
- Modify: `docs/spec.md`

- [ ] **Step 1: E2E を書く**（`e2e/plan-multi-dish.spec.ts` の `login` と `makeRecipe` をまねる。`makeRecipe` はカテゴリを選べるようにする：レシピ編集画面のカテゴリの選び方は `src/web/components/RecipeEditor.tsx` を読んで合わせる）
1. ログイン。主菜「鮭のホイル焼き」（材料 鮭）、汁物「豆腐の味噌汁」（材料 豆腐）を作る
2. 冷蔵庫タブ → 「＋ 食材」→ `鮭 豆腐` を入れる
3. 「今日のおすすめ」に2つのレシピ名が見える。ボタン `/の夜に 2品入れる/` を押す → トーストに「2品入れました」
4. 献立タブ → 2つのレシピ名が見える
5. 冷蔵庫タブ → 「鮭を選ぶ」→ 「1個を使いたい → レシピを探す」→「「鮭」を使うレシピ」の下に「鮭のホイル焼き」と「1個使う：鮭」

- [ ] **Step 2: 仕様書**
- §3 の表の末尾に `| 18 | 今日のおすすめ：冷蔵庫の食材をよく使う・期限が近い食材を使うレシピを上に、最近や今週の献立に入ったものは下げて、主菜・副菜・汁物の1食セットを出す。1タップで夜の献立に入れる。冷蔵庫で食材を選んで「これを使いたい」 | なし | 実装済・本番未反映 | M3 |`
- §6 に「**おすすめ**は保存しない。開くたびに冷蔵庫と献立（今日の7日前〜6日後）から計算する（`src/shared/recommend.ts`）」を足す

- [ ] **Step 3: 全部通す**

Run: `npm run lint && npm run typecheck && npm run test && npm run e2e`
Expected: すべて PASS

- [ ] **Step 4: コミット**

```bash
git add e2e docs/spec.md
git commit -m "test: おすすめの E2E／docs: 仕様におすすめを足す"
```
