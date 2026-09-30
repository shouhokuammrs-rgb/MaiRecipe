import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { api, signUpAs } from "./helpers";

async function groupOf(email: string): Promise<string> {
  const row = await env.DB.prepare(
    `select gm.group_id as g from group_members gm join user u on u.id = gm.user_id where u.email = ?`,
  )
    .bind(email)
    .first<{ g: string }>();
  return row!.g;
}

/** 0004 のうち、表を作る文以外（＝データの移し替え）をもう一度流す */
async function runPantryDataMigration() {
  const m = env.TEST_MIGRATIONS.find((x) => x.name.startsWith("0004"));
  if (!m) throw new Error("0004 が無い");
  for (const q of m.queries) {
    if (/^\s*CREATE/i.test(q)) continue;
    await env.DB.prepare(q).run();
  }
}

describe("#38 の移行：買い物の印を冷蔵庫へ", () => {
  it("家にある・買ったは冷蔵庫へ、残るのは調味料の「家にない」だけ", async () => {
    const me = await signUpAs("移行");
    // ログインしただけではグループが無いことがあるので、API を1回呼んでグループを作らせる
    await api(me.cookie, "/shopping?days=1");
    const g = await groupOf(me.email);
    const mark = (key: string, kind: string, value: number) =>
      env.DB.prepare(
        `insert into shopping_marks (group_id, key, kind, value) values (?, ?, ?, ?)`,
      )
        .bind(g, key, kind, value)
        .run();
    await mark("玉ねぎ|個", "home", 1);
    await mark("玉ねぎ|g", "bought", 1); // 単位違いでも冷蔵庫では1行
    await mark("卵|個", "bought", 1);
    await mark("牛乳|ml", "bought", 0); // 付けて外した印は移さない
    await mark("醤油|大さじ", "home", 0); // 調味料の「家にない」→ 残る
    await mark("醤油|小さじ", "home", 0); // 単位違い → 1つにまとまる
    await mark("みりん|大さじ", "home", 0);
    await mark("みりん|大さじ", "bought", 1); // 買ったので家にある → 印は消える

    await runPantryDataMigration();

    const pantry = await env.DB.prepare(
      `select name, added_on from pantry_items where group_id = ? order by name`,
    )
      .bind(g)
      .all<{ name: string; added_on: string }>();
    expect(pantry.results.map((r) => r.name).sort()).toEqual(
      ["みりん", "卵", "玉ねぎ"].sort(),
    );
    expect(pantry.results[0]!.added_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const marks = await env.DB.prepare(
      `select key, kind, value from shopping_marks where group_id = ?`,
    )
      .bind(g)
      .all<{ key: string; kind: string; value: number }>();
    expect(marks.results).toEqual([{ key: "醤油", kind: "home", value: 0 }]);
  });
});
