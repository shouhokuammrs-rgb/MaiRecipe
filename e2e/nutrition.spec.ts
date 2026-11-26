import { expect, test, type Page } from "@playwright/test";

// 栄養で探す（DEC-038）：栄養を選ぶと手持ちのレシピが多い順に並ぶ。レシピの画面に「多くとれる栄養」が出る
async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@example.test").fill(email);
  await page.getByPlaceholder("パスワード（8文字以上）").fill("password-1234");
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByRole("heading", { name: /レシピ/ })).toBeVisible();
}

async function makeRecipe(
  page: Page,
  title: string,
  ingredient: string,
  amount: string,
) {
  await page.goto("/");
  await page.getByRole("button", { name: "レシピを追加" }).click();
  await page.getByRole("button", { name: /ゼロから自分で作る/ }).click();
  await page.locator("#recipe-title").fill(title);
  await page.getByLabel("材料1の名前").fill(ingredient);
  await page.getByLabel("材料1の分量").fill(amount);
  await page.getByLabel("手順1").fill("煮る");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

test("栄養を選ぶと多い順に並び、レシピの画面から同じ栄養で探せる", async ({
  page,
}) => {
  await login(page, `e2e-nutrition-${Date.now()}@example.test`);
  await makeRecipe(page, "小松菜の煮びたし", "小松菜", "1束");
  await makeRecipe(page, "きゅうりの浅漬け", "きゅうり", "1本");
  await makeRecipe(page, "なぞの一品", "なぞの食材", "100g");

  // レシピの画面：小松菜（鉄・カルシウムなど）は「多くとれる栄養」が出る
  await page.goto("/");
  await page.getByText("小松菜の煮びたし").click();
  const note = page.getByRole("region", { name: "栄養の目安" });
  await expect(note).toBeVisible();
  await expect(
    note.getByRole("link", { name: "鉄が多いレシピを探す" }),
  ).toBeVisible();
  await expect(note).toContainText("日本食品標準成分表（八訂）増補2023年");

  // 一覧 →「栄養で探す」→ 鉄
  await page.goto("/");
  await page.getByRole("link", { name: /栄養で探す/ }).click();
  await expect(page.getByRole("heading", { name: "栄養で探す" })).toBeVisible();
  await expect(
    page.getByText("上から栄養を 1 つ選んでください。"),
  ).toBeVisible();
  await page.getByRole("button", { name: "鉄", exact: true }).click();
  const list = page.getByRole("list").filter({ hasText: "小松菜の煮びたし" });
  await expect(list.getByRole("link")).toHaveCount(1);
  await expect(list).toContainText("多い");
  await expect(list).toContainText("主に 小松菜 から");
  // 少なめのレシピは出ない。読めなかったレシピは件数で知らせる
  await expect(page.getByText("きゅうりの浅漬け")).toHaveCount(0);
  await expect(page.getByText(/並べられなかったレシピが 1\s*件/)).toBeVisible();

  // 多いレシピが無い栄養
  await page.getByRole("button", { name: "ビタミンD", exact: true }).click();
  await expect(
    page.getByText("ビタミンDが多めのレシピは、まだありません。"),
  ).toBeVisible();

  // 一覧からレシピを開くと、同じ栄養で「栄養を足すなら」が開いている
  await page.getByRole("button", { name: "鉄", exact: true }).click();
  await page.getByRole("link", { name: /小松菜の煮びたし/ }).click();
  const add = page.getByRole("region", { name: "栄養を足すなら" });
  await expect(
    add.getByRole("button", { name: "鉄", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  // 小松菜だけで鉄はもう多いので、食材は出さずにそう伝える
  await expect(add).toContainText("鉄がもう多く含まれています");
  await expect(add.getByRole("list")).toHaveCount(0);
  // 栄養を変えると、煮物に混ぜやすい食材が、量と変わり方つきで出る
  await add.getByRole("button", { name: "ビタミンD", exact: true }).click();
  await expect(add).toContainText("この料理に混ぜやすい食材です。");
  await expect(add.getByRole("listitem").first()).toBeVisible();
  await expect(add.getByRole("list")).toContainText("→");
  await expect(add.getByRole("list")).not.toContainText("小松菜");
  await expect(add).toContainText("日本食品標準成分表（八訂）増補2023年");
  await expect(page).toHaveURL(/\?n=vitaminD/);
  // もう一度押すと閉じて、URL からも消える
  await add.getByRole("button", { name: "ビタミンD", exact: true }).click();
  await expect(add.getByRole("list")).toHaveCount(0);
  await expect(page).not.toHaveURL(/n=/);

  // レシピの画面のチップから、その栄養で探す画面へ
  await page
    .getByRole("region", { name: "栄養の目安" })
    .getByRole("link", { name: "ビタミンCが多いレシピを探す" })
    .click();
  await expect(page).toHaveURL(/\/nutrition\?n=vitaminC/);
  await expect(
    page.getByRole("button", { name: "ビタミンC", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("小松菜の煮びたし")).toBeVisible();
});

test("人数の分からないレシピは、その場で人数を入れると並びが変わる", async ({
  page,
}) => {
  await login(page, `e2e-servings-${Date.now()}@example.test`);
  // 出典の無いレシピなので、元のレシピから人数は見つからない
  await makeRecipe(page, "小松菜の煮びたし", "小松菜", "1束");
  await page.goto("/nutrition?n=iron");
  const row = page
    .getByRole("listitem")
    .filter({ hasText: "小松菜の煮びたし" });
  await expect(row).toContainText("多い");
  await expect(row).toContainText("2人分として計算");
  const ask = row.getByRole("group", { name: "何人分のレシピか" });
  await expect(ask).toBeVisible();
  // 押し間違えたら、保存される前に取り消せる
  await ask.getByRole("button", { name: "6人分にする" }).click();
  await expect(ask).toContainText("6人分で保存します。");
  await ask.getByRole("button", { name: "取り消す" }).click();
  await expect(row).toContainText("多い");
  await ask.getByRole("button", { name: "4人分にする" }).click();
  await expect(ask).toContainText("4人分で保存します。");
  // 数秒後に保存される。4人分で割るので「ふつう」になり、聞く欄と注記は消える
  await expect(row).toContainText("ふつう", { timeout: 15000 });
  await expect(row).not.toContainText("2人分として計算");
  await expect(ask).toHaveCount(0);
  // レシピの画面でも 4人分になっている
  await row.getByRole("link").click();
  await expect(
    page.getByRole("group", { name: "何人分のレシピか" }),
  ).toHaveCount(0);
  await expect(page.getByText("4人分").first()).toBeVisible();
});
