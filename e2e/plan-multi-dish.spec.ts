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

  await today
    .getByRole("button", { name: /「さばの味噌煮」を.*から外す/ })
    .click();
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
