import { expect, test, type Page } from "@playwright/test";

// 冷蔵庫：まとめて入れる（調味料は入らない）→ 使い切ったで消す
// → 買い物のチェックで入った品は、買い物リストでは既定で隠れ、「冷蔵庫にあるものも表示」で見える
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
  await page.getByLabel("材料1の分量").fill("1個");
  await page.getByLabel("手順1").fill("炒める");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

test("冷蔵庫に入れる・使い切る・買い物のチェックで入る", async ({ page }) => {
  await login(page, `e2e-pantry-${Date.now()}@example.test`);

  // 1. 下のタブ「冷蔵庫」→ 空の文言
  await page.getByRole("link", { name: "冷蔵庫" }).click();
  await expect(page.getByRole("heading", { name: "冷蔵庫" })).toBeVisible();
  await expect(page.getByText("冷蔵庫は空です")).toBeVisible();

  // 2. 「＋ 食材」→ まとめて入れる。トーストに件数と、入らなかった調味料（醤油）
  await page.getByRole("button", { name: "＋ 食材" }).click();
  const addDialog = page.getByRole("dialog", { name: "冷蔵庫に入れる" });
  await addDialog
    .getByPlaceholder("玉ねぎ にんじん 豚こま")
    .fill("たまねぎ にんじん しょうゆ");
  await addDialog.getByRole("button", { name: "入れる", exact: true }).click();

  const toast = page.getByRole("status");
  await expect(toast).toContainText("2個を冷蔵庫に入れました");
  await expect(toast).toContainText("醤油");

  await expect(page.getByText("玉ねぎ", { exact: true })).toBeVisible();
  await expect(page.getByText("にんじん", { exact: true })).toBeVisible();
  await expect(page.getByText("醤油", { exact: true })).toHaveCount(0);

  // 3. 「にんじん」の「使い切った」→「本当に消す？」→ 一覧から消える
  const carrotRow = page.locator("li", { hasText: "にんじん" });
  await carrotRow.getByRole("button", { name: "使い切った" }).click();
  await carrotRow.getByRole("button", { name: "本当に消す？" }).click();
  await expect(page.getByText("にんじん", { exact: true })).toHaveCount(0);
  await expect(page.getByText("玉ねぎ", { exact: true })).toBeVisible();

  // 4. 玉ねぎを使うレシピを今日の夜に入れる（plan-multi-dish の手順をまねる）
  await makeRecipe(page, "肉じゃが", "たまねぎ");
  await page.goto("/plan");
  const today = page.getByRole("region", { name: "今日" });
  await today.getByRole("button", { name: /夜 に品を追加/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /肉じゃが/ })
    .click();
  await expect(
    today.getByRole("button", { name: "肉じゃが", exact: true }),
  ).toBeVisible();

  // すでに冷蔵庫にあるので、買い物リストには既定で出ない
  await page.getByRole("link", { name: "買い物" }).click();
  await page.getByRole("button", { name: "今日", exact: true }).click();
  await expect(page.getByText("玉ねぎ", { exact: true })).toHaveCount(0);

  // 「冷蔵庫にあるものも表示」をオンにすると見える
  await page.getByRole("button", { name: /冷蔵庫にあるものも表示/ }).click();
  await expect(page.getByText("玉ねぎ", { exact: true })).toBeVisible();
});
