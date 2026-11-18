import { expect, test } from "@playwright/test";

// まとめて読み直す（DEC-037）：設定から入り、選んで始めると、順番待ちの数が出る
test("レシピをまとめて読み直す", async ({ page }) => {
  let queued = 0;
  let sent = null as string[] | null;
  await page.route(
    (u) => u.pathname === "/api/recipes/reread",
    async (r) => {
      if (r.request().method() === "GET")
        return r.fulfill({
          json: {
            recipes: [
              { id: "r1", title: "ダミーの親子丼", versions: 1 },
              { id: "r2", title: "ダミーの肉じゃが", versions: 3 },
              { id: "r3", title: "ダミーの煮物", versions: 1 },
            ],
          },
        });
      if (r.request().method() === "POST") {
        sent = (r.request().postDataJSON() as { ids: string[] }).ids;
        queued = sent.length;
        return r.fulfill({
          status: 202,
          json: { queued: sent.length, skipped: 0 },
        });
      }
      queued = 0;
      return r.fulfill({ status: 204, body: "" });
    },
  );
  await page.route(
    (u) => u.pathname === "/api/import/jobs",
    (r) => r.fulfill({ json: { jobs: [], queued } }),
  );

  await page.goto("/login");
  await page
    .getByPlaceholder("you@example.test")
    .fill(`e2e-rr-${Date.now()}@example.test`);
  await page.getByPlaceholder("パスワード（8文字以上）").fill("password-1234");
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByRole("heading", { name: /レシピ/ })).toBeVisible();

  await page.goto("/settings");
  await page.getByRole("link", { name: "まとめて読み直す" }).click();
  await expect(page.getByText("読み直すレシピ（3 / 3）")).toBeVisible();
  await page.getByRole("checkbox", { name: /ダミーの肉じゃが/ }).click();
  await page.screenshot({ path: "test-results/reread-01.png", fullPage: true });
  await page.getByRole("button", { name: "2件を読み直す" }).click();
  await expect(page.getByText(/あと2件待ち/).first()).toBeVisible();
  expect(sent).toEqual(["r1", "r3"]);
  await page.screenshot({ path: "test-results/reread-02.png" });
  await page.getByRole("button", { name: "残りをやめる" }).click();
  await expect(
    page.getByRole("button", { name: "2件を読み直す" }),
  ).toBeEnabled();
});
