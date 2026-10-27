import { expect, test } from "@playwright/test";

// 作った！（DEC-030）：料理モードの最後から記録を残し、使った食材が冷蔵庫から消え、
// レシピの画面に作った記録と自分の評価が出る
test("できあがり → 作った！ で記録が残り、冷蔵庫から使い切りにする", async ({
  page,
}) => {
  const email = `e2e-cooked-${Date.now()}@example.test`;
  await page.goto("/login");
  await page.getByPlaceholder("you@example.test").fill(email);
  await page.getByPlaceholder("パスワード（8文字以上）").fill("password-1234");
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByRole("heading", { name: /レシピ/ })).toBeVisible();

  const res = await page.request.post("/api/recipes", {
    data: {
      title: "ダミーの肉じゃが",
      category: "主菜",
      genre: "和食",
      servings: 2,
      sourceUrl: null,
      videoUrl: null,
      origin: "own",
      ingredients: [
        { name: "じゃがいも", amount: "3個" },
        { name: "豚こま肉", amount: "200g" },
        { name: "しょうゆ", amount: "大さじ2" },
      ],
      steps: ["切る", "煮る"],
    },
  });
  const { id } = (await res.json()) as { id: string };
  await page.request.post("/api/pantry", {
    data: { names: ["じゃがいも", "豚こま肉", "にんじん"] },
  });

  await page.goto(`/recipes/${id}/cook`);
  await page.getByRole("button", { name: "次へ" }).click();
  await page.getByRole("button", { name: "できあがり" }).click();
  const sheet = page.getByRole("dialog", { name: "作った！" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("2人分")).toBeVisible();
  // 自分は食べた（既定）、評価は「また作る」。にんじんは候補に出ない
  await expect(sheet.getByRole("button", { name: /自分/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await sheet.getByRole("button", { name: "また作る" }).click();
  await expect(sheet.getByRole("button", { name: "じゃがいも" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "にんじん" })).toHaveCount(0);
  // 豚こま肉はまだ残っているので外す
  await sheet.getByRole("button", { name: "豚こま肉" }).click();
  await sheet.getByPlaceholder(/ひとこと/).fill("しょうゆ控えめで");
  await sheet.getByRole("button", { name: "記録を残す" }).click();

  await expect(page).toHaveURL(new RegExp(`/recipes/${id}$`));
  await expect(page.getByText("作った記録（1回）")).toBeVisible();
  await expect(page.getByText("しょうゆ控えめで")).toBeVisible();
  await expect(
    page.getByRole("group", { name: "自分の評価" }).getByRole("button", {
      name: "また作る",
    }),
  ).toHaveAttribute("aria-pressed", "true");

  const pantry = (await (await page.request.get("/api/pantry")).json()) as {
    items: { name: string }[];
  };
  expect(pantry.items.map((i) => i.name).sort()).toEqual([
    "にんじん",
    "豚こま肉",
  ]);
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const meals = (await (
    await page.request.get(`/api/meals?from=${today}&to=${today}`)
  ).json()) as { meals: { title: string; portion: number }[] };
  expect(meals.meals).toEqual([
    expect.objectContaining({ title: "ダミーの肉じゃが", portion: 1 }),
  ]);
});
