import { expect, test } from "@playwright/test";

// 料理モード：手順を1つずつ・タイマー・材料・できあがり（#26）
test("料理モードで作る", async ({ page }) => {
  const email = `e2e-cook-${Date.now()}@example.test`;
  await page.goto("/login");
  await page.getByPlaceholder("you@example.test").fill(email);
  await page.getByPlaceholder("パスワード（8文字以上）").fill("password-1234");
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByRole("heading", { name: /レシピ/ })).toBeVisible();

  const res = await page.request.post("/api/recipes", {
    data: {
      title: "ダミーの煮物",
      category: "主菜",
      genre: "和食",
      timeLabel: "20分",
      sourceUrl: "https://example.com/r/1",
      videoUrl: null,
      origin: "own",
      ingredients: [
        { name: "大根", amount: "1/2本" },
        { name: "しょうゆ", amount: "大さじ2" },
      ],
      steps: [
        "大根を2cm幅に切る",
        "弱火で10〜15分煮る",
        "しょうゆを入れて味を見る",
      ],
    },
  });
  expect(res.ok()).toBeTruthy();
  const { id } = (await res.json()) as { id: string };

  await page.goto(`/recipes/${id}`);
  await page.getByRole("button", { name: "料理モードで作る" }).click();
  await expect(page.getByText("1 / 3")).toBeVisible();
  await expect(page.getByText("大根を2cm幅に切る")).toBeVisible();
  await expect(page.getByRole("button", { name: "戻る" })).toBeDisabled();

  await page.getByRole("button", { name: "次へ" }).click();
  await expect(page.getByText("2 / 3")).toBeVisible();
  await page.getByRole("button", { name: "10〜15分 のタイマー" }).click();
  await expect(
    page.getByRole("list", { name: "動いているタイマー" }),
  ).toContainText(/1[45]:[0-9]{2}/);

  await page.getByRole("button", { name: "材料", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "材料" })).toContainText(
    "大さじ2",
  );
  await page.screenshot({ path: "test-results/05-cook-ings.png" });
  await page.getByRole("button", { name: "材料を閉じる" }).click();
  await page.screenshot({ path: "test-results/05-cook.png" });

  // アシスタント：換算は計算で即答、「5分のタイマー」は打っても動く、AI が無いときは理由
  await page.getByRole("button", { name: "相談" }).click();
  const sheet = page.getByRole("dialog", { name: "アシスタントに相談" });
  await sheet.getByRole("button", { name: "大さじ1は小さじ何杯？" }).click();
  await expect(sheet).toContainText("大さじ1は小さじ3杯です（15ml）。");
  await expect(sheet).toContainText("計算した答え");
  await sheet.getByLabel("相談したいこと").fill("5分のタイマー");
  await sheet.getByRole("button", { name: "送る" }).click();
  await expect(sheet).toContainText("5分のタイマーをかけました。");
  await sheet.getByLabel("相談したいこと").fill("落とし蓋がないときは？");
  await sheet.getByRole("button", { name: "送る" }).click();
  await expect(sheet).toContainText("うまく答えられませんでした");
  await page.screenshot({ path: "test-results/06-assist.png" });
  await sheet.getByRole("button", { name: "相談を閉じる" }).click();
  await expect(
    page.getByRole("list", { name: "動いているタイマー" }),
  ).toContainText("5分");

  await page.getByRole("button", { name: "次へ" }).click();
  await page.getByRole("button", { name: "できあがり" }).click();
  await expect(
    page.getByRole("heading", { name: "ダミーの煮物" }),
  ).toBeVisible();
});
