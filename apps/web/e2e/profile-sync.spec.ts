import { expect, test, type Page } from "@playwright/test";

import {
  createAdminClient,
  createConfirmedUser,
  deleteUser,
  type TestUser,
} from "./helpers/supabase";

/**
 * 受け入れ条件: 2台のブラウザで同一アカウントにログインし、片方で表示名を変えると
 * もう片方でも反映される。
 * → 独立した 2 つの BrowserContext（cookie 非共有 = 別デバイス相当）で検証する。
 */
test.describe("プロフィール表示名のデバイス間同期", () => {
  const admin = createAdminClient();
  let user: TestUser;

  test.beforeAll(async () => {
    user = await createConfirmedUser(admin, "sync");
  });

  test.afterAll(async () => {
    if (user) await deleteUser(admin, user.id);
  });

  async function login(page: Page) {
    await page.goto("/login");
    await page.getByLabel("メールアドレス").fill(user.email);
    await page.getByLabel("パスワード", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "ログイン" }).click();
    await expect(page).toHaveURL(/\/$/);
  }

  test("デバイスAで表示名を変更するとデバイスBにも反映される", async ({ browser }) => {
    const deviceA = await browser.newContext();
    const deviceB = await browser.newContext({ ...test.info().project.use, isMobile: true });
    const pageA = await deviceA.newPage();
    const pageB = await deviceB.newPage();

    try {
      await login(pageA);
      await login(pageB);
      await expect(pageB.getByTestId("header-display-name")).toHaveText(user.displayName);

      const newName = `同期テスト-${Date.now().toString(36)}`;

      await pageA.goto("/settings/profile");
      await pageA.getByLabel("表示名").fill(newName);
      await pageA.getByRole("button", { name: "保存" }).click();
      await expect(pageA.getByTestId("form-success")).toContainText("更新しました");
      await expect(pageA.getByTestId("header-display-name")).toHaveText(newName);

      // デバイスB: 再読み込みすると新しい表示名
      await pageB.reload();
      await expect(pageB.getByTestId("header-display-name")).toHaveText(newName);

      // DB 上も更新されている
      const { data } = await admin
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .single();
      expect(data?.display_name).toBe(newName);
    } finally {
      await deviceA.close();
      await deviceB.close();
    }
  });
});
