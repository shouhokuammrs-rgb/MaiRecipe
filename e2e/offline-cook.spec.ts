import { expect, test } from "@playwright/test";

// 電波が弱い台所：一度開いたレシピは、API に届かなくても料理モードで見られる
test("API に届かなくても、開いたことのあるレシピは料理モードで見られる", async ({
  page,
}) => {
  const email = `e2e-offline-${Date.now()}@example.test`;
  await page.goto("/login");
  await page.getByPlaceholder("you@example.test").fill(email);
  await page.getByPlaceholder("パスワード（8文字以上）").fill("password-1234");
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByRole("heading", { name: /レシピ/ })).toBeVisible();

  const res = await page.request.post("/api/recipes", {
    data: {
      title: "ダミーのオフライン",
      category: "主菜",
      genre: "和食",
      sourceUrl: null,
      videoUrl: null,
      origin: "own",
      ingredients: [{ name: "卵", amount: "2個" }],
      steps: ["卵を割る", "焼く"],
    },
  });
  const { id } = (await res.json()) as { id: string };
  await page.goto(`/recipes/${id}`);
  await expect(
    page.getByRole("heading", { name: "ダミーのオフライン" }),
  ).toBeVisible();

  // ここから API に届かない（電波が無い）
  await page.route(
    (u) => u.pathname.startsWith("/api/"),
    (r) => r.abort("internetdisconnected"),
  );
  await page.goto(`/recipes/${id}/cook`);
  await expect(page.getByText("卵を割る")).toBeVisible();
  await expect(page.getByText(/この端末に残していたレシピ/)).toBeVisible();
  await page.screenshot({ path: "test-results/11-offline-cook.png" });
});
