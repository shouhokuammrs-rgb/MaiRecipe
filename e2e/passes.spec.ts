import { expect, test } from "@playwright/test";

// 別々に使う人の招待（DEC-031）：入れたメールが一覧に出て、ログイン前なら取り消せる
test("別々に使う人を招待して、取り消せる", async ({ page }) => {
  const stamp = Date.now();
  await page.goto("/login");
  await page
    .getByPlaceholder("you@example.test")
    .fill(`e2e-p-${stamp}@example.test`);
  await page.getByPlaceholder("パスワード（8文字以上）").fill("password-1234");
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByRole("heading", { name: /レシピ/ })).toBeVisible();

  await page.goto("/settings");
  const mom = `mom-${stamp}@example.test`;
  await page.locator('input[name="pass-email"]').fill(mom);
  await page.getByRole("button", { name: "別々に使う人として招待" }).click();
  await expect(page.getByText(mom)).toBeVisible();
  await expect(page.getByText("まだログインしていません")).toBeVisible();
  await page.screenshot({ path: "test-results/passes-01.png", fullPage: true });

  await page.getByRole("button", { name: "取り消す" }).last().click();
  await page.getByRole("button", { name: "本当に取り消す？" }).click();
  await expect(page.getByText(mom)).toHaveCount(0);
});
