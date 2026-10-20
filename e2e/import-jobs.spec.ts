import { expect, test } from "@playwright/test";

// 裏で進める取り込み（DEC-022）：すぐ返り、一覧と上の知らせで様子が分かり、確かめて保存できる
test("URL を入れると裏で読み取り、終わったら確かめて保存する", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const email = `e2e-jobs-${Date.now()}@example.test`;
  await page.goto("/login");
  await page.getByPlaceholder("you@example.test").fill(email);
  await page.getByPlaceholder("パスワード（8文字以上）").fill("password-1234");
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByRole("heading", { name: /レシピ/ })).toBeVisible();

  await page.goto("/import");
  // 外に出られない環境でも動くよう、読めないページを入れる（「見つからない」として終わる）
  await page.locator("#import-url").fill("https://example.invalid/recipe/1");
  await page.getByRole("button", { name: "読み取る" }).click();
  await expect(page.getByText("読み取りを始めました")).toBeVisible();
  const list = page.getByRole("region", { name: "読み取りの様子" });
  await expect(list).toContainText("example.invalid/recipe/1");

  // ほかの画面に移っても、終わったら下の知らせから開ける
  await page.goto("/");
  const strip = page.getByRole("status").filter({ hasText: /読み取/ });
  // 外に出られないので「読み取れませんでした」になる。手で入れて保存できる
  await expect(strip).toContainText("読み取れませんでした", {
    timeout: 60_000,
  });
  await page.screenshot({ path: "test-results/07-import-strip.png" });
  await strip.getByRole("link", { name: "手で入れる" }).click();
  await expect(page.getByText("取り込む内容の確認")).toBeVisible();

  // 手で入れて保存すると、一覧から消える
  await page.locator("#recipe-title").fill("ダミーの大根");
  await page.getByLabel("材料1の名前").fill("大根");
  await page.getByLabel("手順1").fill("切る");
  await page
    .getByRole("button", { name: "元のレシピ（v1）として保存" })
    .click();
  await expect(
    page.getByRole("button", { name: "料理モードで作る" }),
  ).toBeVisible();
  await page.goto("/import");
  await expect(
    page.getByRole("region", { name: "読み取りの様子" }),
  ).toHaveCount(0);
});
