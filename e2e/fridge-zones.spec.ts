import { expect, test } from "@playwright/test";

// 冷蔵庫の仕分け（DEC-033）：室ごとに分かれて出る → 置き場所を直すと、その室に移る
test("冷蔵庫の中が室ごとに分かれ、置き場所を直せる", async ({ page }) => {
  await page.goto("/login");
  await page
    .getByPlaceholder("you@example.test")
    .fill(`e2e-zone-${Date.now()}@example.test`);
  await page.getByPlaceholder("パスワード（8文字以上）").fill("password-1234");
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByRole("heading", { name: /レシピ/ })).toBeVisible();

  await page.getByRole("link", { name: "冷蔵庫" }).click();
  await page.getByRole("button", { name: "＋ 食材" }).click();
  const addDialog = page.getByRole("dialog", { name: "冷蔵庫に入れる" });
  await addDialog
    .getByPlaceholder("玉ねぎ にんじん 豚こま")
    .fill("卵 納豆 鶏もも肉 牛乳 キャベツ しめじ 冷凍うどん じゃがいも");
  await addDialog.getByRole("button", { name: "入れる", exact: true }).click();

  const zone = (name: string) => page.getByRole("region", { name });
  await expect(zone("冷蔵室")).toContainText("卵");
  await expect(zone("冷蔵室")).toContainText("納豆");
  await expect(zone("チルド")).toContainText("鶏もも肉");
  await expect(zone("ドアポケット")).toContainText("牛乳");
  await expect(zone("野菜室")).toContainText("キャベツ");
  await expect(zone("冷凍室")).toContainText("冷凍うどん");
  await expect(zone("常温（冷蔵庫の外）")).toContainText("じゃがいも");
  await page.screenshot({ path: "test-results/fridge-01.png", fullPage: true });

  // 卵をドアポケットへ
  await zone("冷蔵室").getByText("卵", { exact: true }).click();
  const edit = page.getByRole("dialog", { name: "卵の量・期限・置き場所" });
  await edit.getByRole("button", { name: "ドアポケット" }).click();
  await expect(edit).toContainText(
    "次に「卵」を入れたときもドアポケットに入ります",
  );
  await page.screenshot({ path: "test-results/fridge-02.png" });
  await edit.getByRole("button", { name: "保存" }).click();
  await expect(zone("ドアポケット")).toContainText("卵");
  await expect(zone("冷蔵室").getByText("卵", { exact: true })).toHaveCount(0);
});
