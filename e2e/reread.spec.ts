import { expect, test } from "@playwright/test";

// 保存済みのレシピを出典から読み直す。読めなかったときは今の版のまま戻れる（空の版を作らない）
test("出典から読み直す（読めなかったとき）", async ({ page }) => {
  test.setTimeout(120_000);
  const email = `e2e-reread-${Date.now()}@example.test`;
  await page.goto("/login");
  await page.getByPlaceholder("you@example.test").fill(email);
  await page.getByPlaceholder("パスワード（8文字以上）").fill("password-1234");
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByRole("heading", { name: /レシピ/ })).toBeVisible();

  const res = await page.request.post("/api/recipes", {
    data: {
      title: "ダミーの読み直し",
      category: "主菜",
      genre: "和食",
      // 外に出られない環境でも動くよう、読めない出典にする
      sourceUrl: "https://example.invalid/recipe/reread",
      videoUrl: null,
      origin: "import",
      ingredients: [{ name: "大根", amount: "1/2本" }],
      steps: ["切る"],
    },
  });
  const { id } = (await res.json()) as { id: string };

  await page.goto(`/recipes/${id}`);
  await page.getByRole("button", { name: "出典から読み直す" }).click();
  await expect(page.getByText("読み直しを始めました")).toBeVisible();

  const strip = page.getByRole("status").filter({ hasText: /読み取/ });
  await expect(strip).toContainText("読み取れませんでした", {
    timeout: 60_000,
  });
  await strip.getByRole("link", { name: "確かめる" }).click();
  await expect(page.getByText("出典から読み直せませんでした")).toBeVisible();
  await page.getByRole("button", { name: "レシピに戻る" }).click();
  await expect(
    page.getByRole("heading", { name: "ダミーの読み直し" }),
  ).toBeVisible();
  // 版は増えていない
  await expect(page.getByText("元のレシピ（まだ改良なし）")).toBeVisible();
});
