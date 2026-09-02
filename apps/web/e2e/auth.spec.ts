import { expect, test } from "@playwright/test";

import {
  createAdminClient,
  createConfirmedUser,
  deleteUser,
  findUserByEmail,
  uniqueEmail,
  type TestUser,
} from "./helpers/supabase";

test.describe("メール認証フロー", () => {
  const admin = createAdminClient();
  let user: TestUser;

  test.beforeAll(async () => {
    user = await createConfirmedUser(admin, "auth");
  });

  test.afterAll(async () => {
    if (user) await deleteUser(admin, user.id);
  });

  test("未ログインで / にアクセスすると /login にリダイレクトされる", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/settings/profile");
    await expect(page).toHaveURL(/\/login\?next=%2Fsettings%2Fprofile$/);
  });

  test("ログイン → 空状態表示 → ログアウト", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("メールアドレス").fill(user.email);
    await page.getByLabel("パスワード", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "ログイン" }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("recipes-empty-state")).toContainText("レシピはまだありません");
    await expect(page.getByTestId("header-display-name")).toHaveText(user.displayName);

    // ログイン済みで /login に行くと / に戻される
    await page.goto("/login");
    await expect(page).toHaveURL(/\/$/);

    // ヘッダーのメニューからログアウト
    await page.getByTestId("user-menu-trigger").click();
    await page.getByTestId("logout-menu-item").click();
    await expect(page).toHaveURL(/\/login$/);

    // ログアウト後は保護ページに入れない
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("誤ったパスワードではエラーが表示される", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("メールアドレス").fill(user.email);
    await page.getByLabel("パスワード", { exact: true }).fill("wrong-password-123");
    await page.getByRole("button", { name: "ログイン" }).click();
    await expect(page.getByTestId("form-error")).toContainText("正しくありません");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("新規登録すると確認メール送信メッセージが出て、未確認ユーザーが作られる", async ({
    page,
  }) => {
    const email = uniqueEmail("signup");
    const password = "Signup-pass-1234";

    await page.goto("/signup");
    await page.getByLabel("表示名").fill("新規テスト");
    await page.getByLabel("メールアドレス").fill(email);
    await page.getByLabel(/^パスワード（\d+文字以上）$/).fill(password);
    await page.getByLabel("パスワード（確認）").fill(password);
    await page.getByRole("button", { name: "アカウントを作成" }).click();

    await expect(page.getByTestId("form-success")).toContainText("確認メールを送信しました");

    const created = await findUserByEmail(admin, email);
    expect(created).not.toBeNull();
    expect(created?.email_confirmed_at ?? null).toBeNull();
    expect(created?.user_metadata?.display_name).toBe("新規テスト");

    // 未確認のままログインするとエラー
    await page.goto("/login");
    await page.getByLabel("メールアドレス").fill(email);
    await page.getByLabel("パスワード", { exact: true }).fill(password);
    await page.getByRole("button", { name: "ログイン" }).click();
    await expect(page.getByTestId("form-error")).toBeVisible();

    if (created) await deleteUser(admin, created.id);
  });

  test("パスワード再設定メールの送信画面が成功メッセージを返す", async ({ page }) => {
    await page.goto("/reset-password");
    await page.getByLabel("メールアドレス").fill(user.email);
    await page.getByRole("button", { name: "再設定メールを送信" }).click();
    await expect(page.getByTestId("form-success")).toContainText("再設定用のメールを送信しました");
  });

  test("無効な確認リンクは /login にエラー付きで戻る", async ({ page }) => {
    await page.goto("/auth/confirm?token_hash=invalid&type=signup");
    await expect(page).toHaveURL(/\/login\?error=auth_link_invalid$/);
    await expect(page.getByTestId("form-error")).toContainText("無効");
  });
});
