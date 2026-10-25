import { expect, test } from "@playwright/test";

// 冷蔵庫の食材から AI に新しいレシピを考えてもらう（#15 / DEC-029）。
// 保存すると「AI が考えたレシピ（出典なし）」と出る。AI の返事は差し替える
test("冷蔵庫の食材から AI のレシピ案を保存する", async ({ page }) => {
  const email = `e2e-idea-${Date.now()}@example.test`;
  await page.goto("/login");
  await page.getByPlaceholder("you@example.test").fill(email);
  await page.getByPlaceholder("パスワード（8文字以上）").fill("password-1234");
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByRole("heading", { name: /レシピ/ })).toBeVisible();
  await page.request.post("/api/pantry", { data: { names: ["大根"] } });

  let asked: unknown = null;
  await page.route("**/api/recipes/ideas", async (r) => {
    asked = r.request().postDataJSON();
    await r.fulfill({
      json: {
        ideas: [
          {
            title: "ダミーの大根ステーキ",
            category: "副菜",
            genre: "和食",
            timeLabel: "15分",
            servings: 2,
            ingredients: [{ name: "大根", amount: "1/4本" }],
            steps: ["輪切りにする", "中火で両面を焼く"],
            tips: [],
          },
        ],
      },
    });
  });

  await page.goto("/fridge");
  await page.getByRole("button", { name: "大根を選ぶ" }).click();
  await page.getByRole("button", { name: /1個を使いたい/ }).click();
  await page.getByRole("button", { name: "考えてもらう" }).click();
  await expect(page.getByText("ダミーの大根ステーキ")).toBeVisible();
  expect(asked).toEqual({ use: ["大根"], wish: "" });

  await page.getByRole("button", { name: "このレシピを保存する" }).click();
  await expect(page).toHaveURL(/\/recipes\//);
  await expect(
    page.getByText(/AI が考えたレシピです（出典なし）/),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "ダミーの大根ステーキ" }),
  ).toBeVisible();
});
