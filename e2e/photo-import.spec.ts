import { expect, test } from "@playwright/test";

// 料理本の写真から（#15）：写真を選ぶと端末で縮めて送り、読めた下書きを確かめて保存する。
// AI の返事は差し替える（本物の AI は呼ばない）。写真は単色のダミー
const DUMMY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAeACgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDt6KKK886wooooAKKKKACiiigAooooAKKKKAP/2Q==",
  "base64",
);

test("写真からレシピを読み取って保存する", async ({ page }) => {
  const email = `e2e-photo-${Date.now()}@example.test`;
  await page.goto("/login");
  await page.getByPlaceholder("you@example.test").fill(email);
  await page.getByPlaceholder("パスワード（8文字以上）").fill("password-1234");
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByRole("heading", { name: /レシピ/ })).toBeVisible();

  let sent = "";
  await page.route("**/api/import/photo", async (r) => {
    sent = r.request().postData() ?? "";
    await r.fulfill({
      json: {
        kind: "photo",
        found: true,
        draft: {
          title: "ダミーの肉じゃが",
          ingredients: [{ name: "じゃがいも", amount: "3個" }],
          steps: ["じゃがいもを切る", "煮る"],
          timeLabel: "",
          servings: 2,
          tips: [],
          category: "主菜",
          genre: "和食",
          sourceUrl: null,
          videoUrl: null,
        },
        message: "AI（無料）が写真を読み取りました。",
      },
    });
  });

  await page.goto("/import");
  await page.getByRole("button", { name: "写真から" }).click();
  await page
    .getByLabel("本の名前・ページ（任意・出典として残します）")
    .fill("ダミーの本 p.12");
  await page.getByLabel("レシピの写真を選ぶ").setInputFiles({
    name: "page.jpg",
    mimeType: "image/jpeg",
    buffer: DUMMY_JPEG,
  });
  await expect(page.getByText("取り込む内容の確認")).toBeVisible();
  // 縮めた JPEG を base64 の文字で送っている
  expect(sent.startsWith("/9j/")).toBe(true);
  await expect(page.getByLabel("材料1の名前")).toHaveValue("じゃがいも");
  await page
    .getByRole("button", { name: "元のレシピ（v1）として保存" })
    .click();
  await expect(
    page.getByRole("heading", { name: "ダミーの肉じゃが" }),
  ).toBeVisible();
  // 本の名前は「出典：…」のメモとして残る
  const id = page.url().split("/recipes/")[1]!;
  const detail = (await (
    await page.request.get(`/api/recipes/${id}`)
  ).json()) as {
    recipe: { memos: { text: string }[] };
  };
  expect(detail.recipe.memos.map((m) => m.text)).toEqual([
    "出典：ダミーの本 p.12",
  ]);
});
