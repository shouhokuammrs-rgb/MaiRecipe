import { expect, test, type Page } from "@playwright/test";

// 「今日のおすすめ」1食セットを1タップで献立に入れる。冷蔵庫で食材を選ぶと「これを使いたい」でレシピを探せる
async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@example.test").fill(email);
  await page.getByPlaceholder("パスワード（8文字以上）").fill("password-1234");
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByRole("heading", { name: /レシピ/ })).toBeVisible();
}

// カテゴリの既定は「主菜」なので、それ以外のときだけチップを押す
async function makeRecipe(
  page: Page,
  title: string,
  category: string,
  ingredient: string,
) {
  await page.goto("/");
  await page.getByRole("button", { name: "レシピを追加" }).click();
  await page.getByRole("button", { name: /ゼロから自分で作る/ }).click();
  await page.locator("#recipe-title").fill(title);
  if (category !== "主菜") {
    await page.getByRole("button", { name: category, exact: true }).click();
  }
  await page.getByLabel("材料1の名前").fill(ingredient);
  await page.getByLabel("材料1の分量").fill("1本");
  await page.getByLabel("手順1").fill("煮る");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

test("今日のおすすめを献立に入れる・冷蔵庫で食材を選んで「これを使いたい」", async ({
  page,
}) => {
  await login(page, `e2e-reco-${Date.now()}@example.test`);
  await makeRecipe(page, "鮭のホイル焼き", "主菜", "鮭");
  await makeRecipe(page, "豆腐の味噌汁", "汁物", "豆腐");

  // 冷蔵庫タブ → 「＋ 食材」→ 鮭 豆腐 を入れる
  // レシピ詳細画面には下のタブが出ないので直接開く（一覧系の画面だけ表示: AppLayout）
  await page.goto("/fridge");
  await expect(page.getByRole("heading", { name: "冷蔵庫" })).toBeVisible();
  await page.getByRole("button", { name: "＋ 食材", exact: true }).click();
  const addDialog = page.getByRole("dialog", { name: "冷蔵庫に入れる" });
  await addDialog.getByPlaceholder("玉ねぎ にんじん 豚こま").fill("鮭 豆腐");
  await addDialog.getByRole("button", { name: "入れる", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "2個を冷蔵庫に入れました",
  );

  // 「今日のおすすめ」に2つのレシピ名が見える
  await expect(
    page.getByRole("heading", { name: "今日のおすすめ" }),
  ).toBeVisible();
  await expect(page.getByText("鮭のホイル焼き")).toBeVisible();
  await expect(page.getByText("豆腐の味噌汁")).toBeVisible();

  // ボタン「M/Dの夜に 2品入れる」を押す → トーストに「2品入れました」
  await page.getByRole("button", { name: /の夜に 2品入れる/ }).click();
  await expect(page.getByRole("status")).toContainText("2品入れました");

  // 献立タブ → 2つのレシピ名が見える
  await page.getByRole("link", { name: "献立" }).click();
  await expect(
    page.getByRole("button", { name: "鮭のホイル焼き", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "豆腐の味噌汁", exact: true }),
  ).toBeVisible();

  // 冷蔵庫タブ → 「鮭を選ぶ」→ 「1個を使いたい → レシピを探す」
  await page.getByRole("link", { name: "冷蔵庫" }).click();
  await page.getByRole("button", { name: "鮭を選ぶ", exact: true }).click();
  await page
    .getByRole("button", { name: "1個を使いたい → レシピを探す", exact: true })
    .click();

  // 「「鮭」を使うレシピ」の下に「鮭のホイル焼き」と「1個使う：鮭」
  await expect(
    page.getByRole("heading", { name: "「鮭」を使うレシピ" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "鮭のホイル焼き" }),
  ).toBeVisible();
  await expect(page.getByText("1個使う：鮭")).toBeVisible();
});
