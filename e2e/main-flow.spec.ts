import { expect, test } from "@playwright/test";

// ローカルの仮ログイン（DEV_LOGIN=1）で、取り込み以外の一通りの流れを確かめる。
// 1. 手でレシピを作る → 2. 材料を直して v2 → 3. メモを残す → 4. あゆみに出る
// 5. 献立に入れる → 6. 買い物リストに出る → 7. 家にある印で隠れる
test("レシピを作って改良し、献立から買い物リストまで", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.test`;
  await page.goto("/login");
  await page.getByPlaceholder("you@example.test").fill(email);
  await page.getByPlaceholder("パスワード（8文字以上）").fill("password-1234");
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByRole("heading", { name: /レシピ/ })).toBeVisible();
  await expect(page.getByText("まだレシピがありません")).toBeVisible();

  // 1. ゼロから作る
  await page.getByRole("button", { name: "レシピを追加" }).click();
  await page.getByRole("button", { name: /ゼロから自分で作る/ }).click();
  await page.locator("#recipe-title").fill("鶏むね肉の甘酢炒め");
  await page.getByRole("button", { name: "中華" }).click();
  await page.getByLabel("材料1の名前").fill("鶏むね肉");
  await page.getByLabel("材料1の分量").fill("300g");
  await page.getByLabel("材料2の名前").fill("たまねぎ");
  await page.getByLabel("材料2の分量").fill("1個");
  await page.getByLabel("材料3の名前").fill("酢");
  await page.getByLabel("材料3の分量").fill("大さじ3");
  await page.getByLabel("手順1").fill("鶏肉をそぎ切りにする");
  await page.getByLabel("手順2").fill("焼いて酢で絡める");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(
    page.getByRole("heading", { name: "鶏むね肉の甘酢炒め" }),
  ).toBeVisible();
  await expect(page.getByText("元のレシピ（まだ改良なし）")).toBeVisible();
  await page.screenshot({ path: "test-results/01-detail.png", fullPage: true });

  // 2. 編集して v2
  await page.getByRole("button", { name: "材料・作り方を編集" }).click();
  await expect(page.getByLabel("材料3の名前")).toHaveValue("酢");
  await page.getByLabel("材料3の名前").fill("米酢");
  await page.getByRole("button", { name: "v2 として保存" }).click();
  await expect(page.getByText(/最新版 v2/)).toBeVisible();

  // 3. メモ → 4. あゆみ
  await page.locator("#memo-input").fill("砂糖は少し減らしてもいい");
  await page.getByRole("button", { name: "メモを残す" }).click();
  await expect(page.getByText("酢 → 米酢")).toBeVisible();
  await expect(page.getByText("砂糖は少し減らしてもいい")).toBeVisible();
  await page.screenshot({ path: "test-results/02-thread.png", fullPage: true });

  // v1 を見る
  await page.getByRole("button", { name: "この版を見る" }).click();
  await expect(page.getByText(/v1（元のレシピ） を表示中/)).toBeVisible();
  await page.getByRole("button", { name: "最新版へ" }).click();

  // 5. 献立に入れる（今日の夜）
  await page.getByRole("button", { name: "献立に追加" }).click();
  await expect(page.getByText("を入れる枠をタップ")).toBeVisible();
  await page
    .getByRole("button", { name: /に品を追加/ })
    .and(page.locator(":not([disabled])"))
    .last()
    .click();
  await page.screenshot({ path: "test-results/03-plan.png", fullPage: true });

  // 6. 買い物リスト（1週間）
  await page.getByRole("link", { name: "買い物" }).click();
  await page.getByRole("button", { name: "1週間" }).click();
  await expect(page.getByText("米酢")).toHaveCount(0); // 調味料は最初から家にある扱いで隠れる
  await expect(page.getByText("玉ねぎ")).toBeVisible(); // たまねぎ → 玉ねぎ に名寄せ
  await expect(page.getByText("（たまねぎ もまとめました）")).toBeVisible();
  await page.screenshot({
    path: "test-results/04-shopping.png",
    fullPage: true,
  });

  // 7. 家にある → 隠れる
  const onionRow = page.locator("li", { hasText: "玉ねぎ" });
  await onionRow.getByRole("button", { name: "家にある" }).click();
  await expect(page.getByText("玉ねぎ")).toHaveCount(0);
});

test("ログインしていなければログイン画面へ", async ({ page }) => {
  await page.goto("/plan");
  await expect(page).toHaveURL(/\/login$/);
});
