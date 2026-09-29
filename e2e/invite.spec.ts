import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

// ローカルの仮ログインは本人確認が無いので、招待される側だけローカル D1 で確認済みにしてから進める
function verifyLocal(email: string) {
  execFileSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "mairecipe",
      "--local",
      "--command",
      `update user set email_verified = 1 where email = '${email}'`,
    ],
    { stdio: "ignore" },
  );
}

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@example.test").fill(email);
  await page.getByPlaceholder("パスワード（8文字以上）").fill("password-1234");
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByRole("heading", { name: /レシピ/ })).toBeVisible();
}

async function makeRecipe(page: Page, title: string) {
  await page.getByRole("button", { name: "レシピを追加" }).click();
  await page.getByRole("button", { name: /ゼロから自分で作る/ }).click();
  await page.locator("#recipe-title").fill(title);
  await page.getByLabel("材料1の名前").fill("卵");
  await page.getByLabel("手順1").fill("焼く");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

test("招待して参加すると、同じレシピが見える", async ({ browser }) => {
  const stamp = Date.now();
  const aMail = `e2e-a-${stamp}@example.test`;
  const bMail = `e2e-b-${stamp}@example.test`;
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();

  await login(a, aMail);
  await makeRecipe(a, "Aの煮物");
  await login(b, bMail);
  await makeRecipe(b, "Bのサラダ");
  verifyLocal(bMail);

  await a.goto("/settings");
  await a.locator("#invite-email").fill(bMail.toUpperCase());
  await a.getByRole("button", { name: "招待する" }).click();
  await expect(a.getByText(bMail)).toBeVisible();
  await a.screenshot({
    path: "test-results/invite-01-pending.png",
    fullPage: true,
  });

  await b.goto("/");
  await b.screenshot({
    path: "test-results/invite-02-banner.png",
    fullPage: true,
  });
  await b.getByRole("link", { name: /招待が届いています/ }).click();
  await b.screenshot({
    path: "test-results/invite-03-before-join.png",
    fullPage: true,
  });
  await b.getByRole("button", { name: "参加する" }).click();
  await b.getByRole("button", { name: "本当に参加する？" }).click();
  await expect(b.getByText("参加しました")).toBeVisible();
  await expect(b.getByText("レシピを 1 件移しました")).toBeVisible();
  await b.screenshot({ path: "test-results/04-joined.png", fullPage: true });

  await b.getByRole("link", { name: "レシピを見る" }).click();
  await expect(b.getByText("Aの煮物")).toBeVisible();
  await a.goto("/");
  await expect(a.getByText("Bのサラダ")).toBeVisible();
});
