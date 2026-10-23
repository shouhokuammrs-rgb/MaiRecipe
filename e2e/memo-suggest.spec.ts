import { expect, test } from "@playwright/test";

// メモから AI の変更案（#23）：選んだものだけ編集欄に入り、確かめて新しい版にする。
// AI の返事は差し替える（本物の AI は呼ばない）
test("メモから AI の変更案を選んで、新しい版にする", async ({ page }) => {
  const email = `e2e-memo-${Date.now()}@example.test`;
  await page.goto("/login");
  await page.getByPlaceholder("you@example.test").fill(email);
  await page.getByPlaceholder("パスワード（8文字以上）").fill("password-1234");
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByRole("heading", { name: /レシピ/ })).toBeVisible();

  const res = await page.request.post("/api/recipes", {
    data: {
      title: "ダミーの照り焼き",
      category: "主菜",
      genre: "和食",
      sourceUrl: null,
      videoUrl: null,
      origin: "own",
      ingredients: [
        { name: "鶏もも肉", amount: "1枚" },
        { name: "砂糖", amount: "大さじ2" },
      ],
      steps: ["鶏肉を焼く", "タレを煮からめる"],
    },
  });
  const { id } = (await res.json()) as { id: string };
  const memo = await page.request.post(`/api/recipes/${id}/memos`, {
    data: { text: "甘すぎた。砂糖は半分でいい" },
  });
  const { id: memoId } = (await memo.json()) as { id: string };

  await page.route(`**/api/recipes/${id}/memos/${memoId}/suggest`, (r) =>
    r.fulfill({
      json: {
        versionId: "x",
        changes: [
          {
            kind: "ingredient",
            action: "update",
            index: 2,
            name: "砂糖",
            amount: "大さじ1",
            reason: "甘さ控えめに",
            quote: "砂糖は半分でいい",
            grounded: true,
          },
          {
            kind: "tip",
            action: "add",
            step: null,
            text: "みりんで照りを出す",
            reason: "照りを足す",
            quote: "",
            grounded: false,
          },
        ],
      },
    }),
  );

  await page.goto(`/recipes/${id}/edit?memo=${memoId}`);
  await page
    .getByRole("button", { name: "AI に変更案を出してもらう（無料）" })
    .click();
  await expect(page.getByText("材料2：砂糖 大さじ2 → 大さじ1")).toBeVisible();
  await expect(page.getByText("AI の推測（メモには無い）")).toBeVisible();
  await page.screenshot({
    path: "test-results/12-memo-suggest.png",
    fullPage: true,
  });
  // メモに基づく案だけ最初から選ばれている
  await page
    .getByRole("button", { name: "選んだ 1 件を下の編集欄に入れる" })
    .click();
  await expect(page.getByLabel("材料2の分量")).toHaveValue("大さじ1");
  await page.getByRole("button", { name: "v2 として保存" }).click();
  await expect(
    page.getByRole("heading", { name: "ダミーの照り焼き" }),
  ).toBeVisible();
  await expect(page.getByText("大さじ1", { exact: true })).toBeVisible();
});
