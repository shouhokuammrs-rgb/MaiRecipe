import { expect, test } from "@playwright/test";

import {
  createAdminClient,
  createAnonClient,
  createConfirmedUser,
  deleteUser,
  getOwnGroupId,
  type TestUser,
} from "./helpers/supabase";

/**
 * 受け入れ条件: 他ユーザーの recipes を直接クエリしても 0 件（RLS）
 * ブラウザを介さず supabase-js（anon key + 各ユーザーのセッション）で PostgREST を直接叩く。
 */
test.describe("RLS: recipes はグループメンバー以外に見えない", () => {
  const admin = createAdminClient();
  let alice: TestUser;
  let bob: TestUser;

  test.beforeAll(async () => {
    alice = await createConfirmedUser(admin, "rls-alice");
    bob = await createConfirmedUser(admin, "rls-bob");
  });

  test.afterAll(async () => {
    if (alice) await deleteUser(admin, alice.id);
    if (bob) await deleteUser(admin, bob.id);
  });

  test("Alice のレシピは Bob から 0 件、更新/削除も 0 行", async () => {
    // Alice: 自分のグループにレシピを作成
    const aliceClient = createAnonClient();
    const aliceSignIn = await aliceClient.auth.signInWithPassword({
      email: alice.email,
      password: alice.password,
    });
    expect(aliceSignIn.error).toBeNull();

    const aliceGroupId = await getOwnGroupId(aliceClient);
    const inserted = await aliceClient
      .from("recipes")
      .insert({ group_id: aliceGroupId, title: "アリスのカレー" })
      .select("id, created_by")
      .single();
    expect(inserted.error).toBeNull();
    expect(inserted.data?.created_by).toBe(alice.id);
    const recipeId = inserted.data!.id;

    await aliceClient
      .from("recipe_ingredients")
      .insert({ recipe_id: recipeId, name: "にんじん", amount: "1", unit: "本" });

    // Alice 自身には見える
    const aliceView = await aliceClient.from("recipes").select("id");
    expect(aliceView.error).toBeNull();
    expect(aliceView.data?.map((r) => r.id)).toContain(recipeId);

    // Bob: 直接クエリしても 0 件
    const bobClient = createAnonClient();
    const bobSignIn = await bobClient.auth.signInWithPassword({
      email: bob.email,
      password: bob.password,
    });
    expect(bobSignIn.error).toBeNull();

    const bobAll = await bobClient.from("recipes").select("id");
    expect(bobAll.error).toBeNull();
    expect(bobAll.data).toHaveLength(0);

    const bobById = await bobClient.from("recipes").select("id").eq("id", recipeId).maybeSingle();
    expect(bobById.error).toBeNull();
    expect(bobById.data).toBeNull();

    const bobIngredients = await bobClient
      .from("recipe_ingredients")
      .select("id")
      .eq("recipe_id", recipeId);
    expect(bobIngredients.error).toBeNull();
    expect(bobIngredients.data).toHaveLength(0);

    // 更新・削除も 0 行（エラーにはならず、単に対象外）
    const bobUpdate = await bobClient
      .from("recipes")
      .update({ title: "乗っ取り" })
      .eq("id", recipeId)
      .select("id");
    expect(bobUpdate.error).toBeNull();
    expect(bobUpdate.data).toHaveLength(0);

    const bobDelete = await bobClient.from("recipes").delete().eq("id", recipeId).select("id");
    expect(bobDelete.error).toBeNull();
    expect(bobDelete.data).toHaveLength(0);

    // Bob は Alice のグループにレシピを作れない（with check 違反）
    const bobInsert = await bobClient
      .from("recipes")
      .insert({ group_id: aliceGroupId, title: "不正投稿" })
      .select("id");
    expect(bobInsert.error).not.toBeNull();

    // Alice のレシピは無事
    const stillThere = await aliceClient
      .from("recipes")
      .select("title")
      .eq("id", recipeId)
      .single();
    expect(stillThere.data?.title).toBe("アリスのカレー");

    // 未ログイン（anon）は何も見えない
    const anon = createAnonClient();
    const anonView = await anon.from("recipes").select("id");
    expect(anonView.data ?? []).toHaveLength(0);
  });
});
