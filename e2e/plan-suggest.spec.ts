import { expect, test } from "@playwright/test";

// AI に献立を考えてもらう（#15 / DEC-028）：案は選んだものだけ献立に入る。
// AI の返事は差し替える（本物の AI は呼ばない）
test("AI の献立の案から選んだものだけ献立に入れる", async ({ page }) => {
  const email = `e2e-plan-ai-${Date.now()}@example.test`;
  await page.goto("/login");
  await page.getByPlaceholder("you@example.test").fill(email);
  await page.getByPlaceholder("パスワード（8文字以上）").fill("password-1234");
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByRole("heading", { name: /レシピ/ })).toBeVisible();

  const make = async (title: string, category: string) => {
    const res = await page.request.post("/api/recipes", {
      data: {
        title,
        category,
        genre: "和食",
        sourceUrl: null,
        videoUrl: null,
        origin: "own",
        ingredients: [{ name: "大根", amount: "1/4本" }],
        steps: ["切る", "煮る"],
      },
    });
    return ((await res.json()) as { id: string }).id;
  };
  const buri = await make("ダミーのぶり大根", "主菜");
  const miso = await make("ダミーのみそ汁", "汁物");

  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  let asked: unknown = null;
  await page.route("**/api/plans/suggest", async (r) => {
    asked = r.request().postDataJSON();
    await r.fulfill({
      json: {
        suggestions: [
          {
            date: today,
            meal: "dinner",
            reason: "大根を使い切る",
            recipeIds: [buri, miso],
            recipes: [
              { id: buri, title: "ダミーのぶり大根", category: "主菜" },
              { id: miso, title: "ダミーのみそ汁", category: "汁物" },
            ],
          },
        ],
      },
    });
  });

  await page.goto("/plan");
  await page
    .getByRole("button", { name: "AI に献立を考えてもらう（無料）" })
    .click();
  await page.getByRole("button", { name: "今日だけ" }).click();
  await page.getByLabel("希望（任意）").fill("野菜多めで");
  await page.getByRole("button", { name: "考えてもらう" }).click();
  await expect(page.getByText("大根を使い切る")).toBeVisible();
  expect(asked).toEqual({ days: 1, meals: ["dinner"], wish: "野菜多めで" });

  // みそ汁は外して、ぶり大根だけ入れる
  await page.getByRole("checkbox", { name: /ダミーのみそ汁/ }).uncheck();
  await page.getByRole("button", { name: "選んだ 1 品を献立に入れる" }).click();
  await expect(
    page.getByRole("region", { name: "AI の献立の提案" }),
  ).toHaveCount(0);

  const plans = (await (
    await page.request.get(`/api/plans?from=${today}&to=${today}`)
  ).json()) as { plans: { meal: string; recipeId: string }[] };
  expect(plans.plans.map((p) => [p.meal, p.recipeId])).toEqual([
    ["dinner", buri],
  ]);
});
