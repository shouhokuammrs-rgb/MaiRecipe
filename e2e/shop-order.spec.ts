import { expect, test } from "@playwright/test";

// 買い物リストの売り場（DEC-032）：売り場ごとに分かれ、並び替えると保存した順になる
const SECTIONS = [
  "野菜・果物",
  "魚",
  "肉",
  "卵・豆腐・乳製品",
  "調味料",
  "乾物・缶詰",
  "米・パン・麺",
  "冷凍食品",
  "飲み物",
  "その他",
];
const item = (name: string, section: string, amount = "") => ({
  key: `${name}|`,
  name,
  amount,
  section,
  recipes: ["ダミーのレシピ"],
  merged: [],
  have: false,
});

test("売り場ごとに分かれ、順番を変えられる", async ({ page }) => {
  let saved = null as string[] | null;
  await page.route(
    (u) => u.pathname === "/api/shopping",
    (r) =>
      r.fulfill({
        json: {
          from: "2026-11-13",
          to: "2026-11-15",
          recipeCount: 2,
          people: 2,
          unscaled: [],
          sections: saved ?? SECTIONS,
          items: [
            item("しめじ", "野菜・果物", "2/3株"),
            item("長ねぎ", "野菜・果物", "たっぷり"),
            item("カツオ", "魚"),
            item("塩昆布", "乾物・缶詰", "大さじ1と1/3"),
            item("生米", "米・パン・麺", "2合"),
          ],
        },
      }),
  );
  await page.route(
    (u) => u.pathname === "/api/group/shop-order",
    async (r) => {
      saved = (r.request().postDataJSON() as { order: string[] | null }).order;
      await r.fulfill({ json: { sections: saved ?? SECTIONS } });
    },
  );

  await page.goto("/login");
  await page
    .getByPlaceholder("you@example.test")
    .fill(`e2e-s-${Date.now()}@example.test`);
  await page.getByPlaceholder("パスワード（8文字以上）").fill("password-1234");
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByRole("heading", { name: /レシピ/ })).toBeVisible();
  await page.getByRole("link", { name: "買い物" }).click();

  const headings = page.locator("main h2");
  await expect(headings).toHaveText([
    "野菜・果物",
    "魚",
    "乾物・缶詰",
    "米・パン・麺",
  ]);
  await page.screenshot({ path: "test-results/shop-01.png", fullPage: true });

  await page.getByRole("button", { name: "売り場の順番を変える" }).click();
  await page.getByRole("button", { name: "米・パン・麺を上へ" }).click();
  await page.getByRole("button", { name: "米・パン・麺を上へ" }).click();
  await page.screenshot({ path: "test-results/shop-02.png" });
  await page.getByRole("button", { name: "この順番にする" }).click();
  await expect(page.getByText("売り場の順番を保存しました")).toBeVisible();
  await expect(headings).toHaveText([
    "野菜・果物",
    "魚",
    "米・パン・麺",
    "乾物・缶詰",
  ]);
  expect(saved?.slice(0, 7)).toEqual([
    "野菜・果物",
    "魚",
    "肉",
    "卵・豆腐・乳製品",
    "米・パン・麺",
    "調味料",
    "乾物・缶詰",
  ]);
});
