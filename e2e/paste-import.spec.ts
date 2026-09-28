import { expect, test } from "@playwright/test";
import { DESCRIPTION_LOOSE } from "../test/shared/fixtures/import-fixtures";

// 見出しの無い概要欄を貼って、材料と手順に分け、全体と内訳の重なりの注意が出る
test("文章を貼って取り込む", async ({ page }) => {
  const email = `e2e-paste-${Date.now()}@example.test`;
  await page.goto("/login");
  await page.getByPlaceholder("you@example.test").fill(email);
  await page.getByPlaceholder("パスワード（8文字以上）").fill("password-1234");
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByRole("heading", { name: /レシピ/ })).toBeVisible();

  await page.goto("/import");
  await page.getByRole("button", { name: "文章を貼って" }).click();
  await page
    .locator("#import-text-url")
    .fill("https://www.youtube.com/watch?v=abcDEF12345");
  await page.locator("#import-text").fill(DESCRIPTION_LOOSE);
  await page.getByRole("button", { name: "材料と作り方に分ける" }).click();

  await expect(
    page.getByText("貼り付けた文章から読み取りました"),
  ).toBeVisible();
  await expect(
    page.getByText(/「ダミー魚」は全体の量と内訳の両方/),
  ).toBeVisible();
  await expect(page.getByLabel("材料2の名前")).toHaveValue(
    "ダミー魚（塩焼き）",
  );
  await expect(page.getByLabel("手順1")).toHaveValue("魚に塩をふって10分おく");
  await page.screenshot({ path: "test-results/03-paste.png", fullPage: true });

  await page
    .getByRole("button", { name: "元のレシピ（v1）として保存" })
    .click();
  await expect(
    page.getByRole("heading", { name: "貼り付けたレシピ" }),
  ).toBeVisible();
});
