import { expect, test } from "@playwright/test";

// 保存済みのレシピの URL を入れたら、読み取る前に「保存済みです」と知らせる
test("同じ URL の二重取り込みを知らせる", async ({ page }) => {
  const email = `e2e-dup-${Date.now()}@example.test`;
  await page.goto("/login");
  await page.getByPlaceholder("you@example.test").fill(email);
  await page.getByPlaceholder("パスワード（8文字以上）").fill("password-1234");
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByRole("heading", { name: /レシピ/ })).toBeVisible();

  const res = await page.request.post("/api/recipes", {
    data: {
      title: "ダミーの保存済み",
      category: "主菜",
      genre: "和食",
      sourceUrl: "https://example.com/recipes/dup",
      videoUrl: null,
      origin: "import",
      ingredients: [],
      steps: ["切る"],
    },
  });
  expect(res.ok()).toBeTruthy();

  await page.goto("/import");
  await page
    .locator("#import-url")
    .fill("https://www.example.com/recipes/dup/");
  await page.getByRole("button", { name: "読み取る" }).click();
  await expect(page.getByText("このレシピは保存済みです")).toBeVisible();
  await page.screenshot({ path: "test-results/10-dup.png" });
  await page.getByRole("button", { name: "保存済みのレシピを開く" }).click();
  await expect(
    page.getByRole("heading", { name: "ダミーの保存済み" }),
  ).toBeVisible();
});
