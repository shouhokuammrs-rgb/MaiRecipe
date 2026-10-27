import { expect, test } from "@playwright/test";

// 写真は単色のダミー（photo-import.spec.ts と同じ）
const DUMMY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAeACgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDt6KKK886wooooAKKKKACiiigAooooAKKKKAP/2Q==",
  "base64",
);

// 食べた記録（DEC-030）：外食を写真から入れる（AI の返事は差し替え）。自分の分だけ消せる
test("外食を写真から入れて、食べた記録に並ぶ", async ({ page }) => {
  const email = `e2e-meals-${Date.now()}@example.test`;
  await page.goto("/login");
  await page.getByPlaceholder("you@example.test").fill(email);
  await page.getByPlaceholder("パスワード（8文字以上）").fill("password-1234");
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByRole("heading", { name: /レシピ/ })).toBeVisible();

  let sent = "";
  await page.route("**/api/meals/photo", async (r) => {
    sent = r.request().postData() ?? "";
    await r.fulfill({
      json: { title: "ダミーの牛丼 並", kcal: 650, items: ["牛丼", "味噌汁"] },
    });
  });

  await page.goto("/plan");
  await page.getByRole("link", { name: /食べた記録/ }).click();
  await expect(page.getByText("まだ記録がありません。")).toBeVisible();
  await page.getByRole("button", { name: "＋ 外食・買ったもの" }).click();
  const sheet = page.getByRole("dialog", { name: "外食・買ったものを入れる" });
  await sheet.getByLabel("食事の写真").setInputFiles({
    name: "meal.jpg",
    mimeType: "image/jpeg",
    buffer: DUMMY_JPEG,
  });
  await expect(sheet.getByLabel("何を食べた？")).toHaveValue("ダミーの牛丼 並");
  await expect(sheet.getByLabel("カロリー（任意）")).toHaveValue("650");
  expect(sent.startsWith("/9j/")).toBe(true);
  await sheet.getByRole("button", { name: "昼" }).click();
  await sheet.getByRole("button", { name: "記録に入れる" }).click();

  await expect(page.getByText("ダミーの牛丼 並")).toBeVisible();
  await expect(page.getByText(/昼・1人前・約650kcal/)).toBeVisible();
  await expect(page.getByText(/1品・約650kcal/)).toBeVisible();

  await page.getByRole("button", { name: "消す" }).click();
  await page.getByRole("button", { name: "本当に消す？" }).click();
  await expect(page.getByText("まだ記録がありません。")).toBeVisible();
});
