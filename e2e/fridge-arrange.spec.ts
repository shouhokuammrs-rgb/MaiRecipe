import { expect, test } from "@playwright/test";

// 冷蔵庫のまとめて移動・並べ替え・元に戻す（DEC-034）
test("まとめて冷凍室へ移し、元に戻し、並べ替える", async ({ page }) => {
  await page.goto("/login");
  await page
    .getByPlaceholder("you@example.test")
    .fill(`e2e-arr-${Date.now()}@example.test`);
  await page.getByPlaceholder("パスワード（8文字以上）").fill("password-1234");
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByRole("heading", { name: /レシピ/ })).toBeVisible();

  await page.getByRole("link", { name: "冷蔵庫" }).click();
  await page.getByRole("button", { name: "＋ 食材" }).click();
  const addDialog = page.getByRole("dialog", { name: "冷蔵庫に入れる" });
  await addDialog
    .getByPlaceholder("玉ねぎ にんじん 豚こま")
    .fill("豚こま 鶏もも肉 卵 にんじん キャベツ 大根");
  await addDialog.getByRole("button", { name: "入れる", exact: true }).click();
  const zone = (name: string) => page.getByRole("region", { name });
  await expect(zone("チルド")).toContainText("豚こま");

  // まとめて冷凍室へ
  await page.getByRole("button", { name: "豚こまを選ぶ" }).click();
  await page.getByRole("button", { name: "鶏もも肉を選ぶ" }).click();
  await page.screenshot({ path: "test-results/arrange-01.png" });
  await page.getByRole("button", { name: "2個をまとめて移動" }).click();
  await page.screenshot({ path: "test-results/arrange-02.png" });
  await page
    .getByRole("dialog", { name: "まとめて移動" })
    .getByRole("button", { name: "冷凍室", exact: true })
    .click();
  await expect(page.getByText("2個を冷凍室に移しました")).toBeVisible();
  await expect(zone("冷凍室")).toContainText("豚こま");
  await expect(zone("冷凍室")).toContainText("鶏もも肉");

  // 元に戻す
  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(zone("チルド")).toContainText("豚こま");
  await expect(zone("冷凍室").getByText("豚こま", { exact: true })).toHaveCount(
    0,
  );

  // 名前順にする → 元に戻すで期限が近い順へ
  await page.getByRole("button", { name: /並べ替え：期限が近い順/ }).click();
  const sortDialog = page.getByRole("dialog", { name: "並べ替え" });
  await sortDialog.getByRole("button", { name: "名前順" }).click();
  await page.screenshot({ path: "test-results/arrange-03.png" });
  await sortDialog.getByRole("button", { name: "この並びにする" }).click();
  await expect(
    page.getByRole("button", { name: /並べ替え：名前順/ }),
  ).toBeVisible();
  const veg = zone("野菜室").locator("li");
  await expect(veg.nth(0)).toContainText("キャベツ");

  // 手で並べる：大根を一番上へ
  await page.getByRole("button", { name: /並べ替え：/ }).click();
  await sortDialog.getByRole("button", { name: /食材を手で並べる/ }).click();
  await page.getByRole("button", { name: "大根を上へ" }).click();
  await page.getByRole("button", { name: "大根を上へ" }).click();
  await page.screenshot({
    path: "test-results/arrange-04.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "この並びにする" }).click();
  await expect(
    page.getByRole("button", { name: /並べ替え：手で並べた順/ }),
  ).toBeVisible();
  await expect(veg.nth(0)).toContainText("大根");

  // 室の順番：冷凍室を上へ
  await page.getByRole("button", { name: /並べ替え：/ }).click();
  for (let i = 0; i < 4; i++)
    await sortDialog.getByRole("button", { name: "冷凍室を上へ" }).click();
  await sortDialog.getByRole("button", { name: "この並びにする" }).click();
  await expect(page.getByRole("region").first()).toHaveAccessibleName("冷凍室");
});
