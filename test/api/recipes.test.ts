import { describe, expect, it } from "vitest";
import { api, sampleRecipe, signUp } from "./helpers";

type Recipe = {
  id: string;
  title: string;
  videoUrl: string | null;
  versions: {
    id: string;
    seq: number;
    kind: string;
    ingredients: { name: string; amount: string }[];
    changes: string[];
  }[];
  memos: { id: string; appliedVersionId: string | null }[];
};

async function create(
  cookie: string,
  body: object = sampleRecipe,
): Promise<string> {
  const res = await api(cookie, "/recipes", { method: "POST", body });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function get(cookie: string, id: string): Promise<Recipe> {
  const res = await api(cookie, `/recipes/${id}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { recipe: Recipe }).recipe;
}

describe("ログイン", () => {
  it("ログインしていなければ 401", async () => {
    expect((await api(null, "/recipes")).status).toBe(401);
    expect(
      (await api(null, "/plans?from=2026-09-28&to=2026-10-04")).status,
    ).toBe(401);
  });

  it("ヘルスチェックと設定はログイン不要", async () => {
    expect((await api(null, "/health")).status).toBe(200);
    expect(await (await api(null, "/config")).json()).toEqual({
      googleLogin: false,
      devLogin: true,
    });
  });
});

describe("レシピと版", () => {
  it("作ると元のレシピ（v1）ができ、分量の表記がそろい、動画は YouTube の URL にそろう", async () => {
    const me = await signUp();
    const id = await create(me);
    const r = await get(me, id);
    expect(r.versions).toHaveLength(1);
    expect(r.versions[0]).toMatchObject({ seq: 1, kind: "original" });
    expect(r.versions[0]!.ingredients[2]).toEqual({
      name: "酢",
      amount: "大さじ3",
    });
    expect(r.videoUrl).toBe("https://www.youtube.com/watch?v=abcDEF12345");
  });

  it("編集すると差分つきの版が積まれ、何も変えなければ版は増えない", async () => {
    const me = await signUp();
    const id = await create(me);
    const edited = {
      ...sampleRecipe,
      ingredients: sampleRecipe.ingredients.map((i) =>
        i.name === "酢"
          ? { name: "米酢", amount: "大さじ3" }
          : i.name === "砂糖"
            ? { name: "砂糖", amount: "大さじ1と1/2" }
            : i,
      ),
    };
    const res = await api(me, `/recipes/${id}/versions`, {
      method: "POST",
      body: edited,
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      seq: 2,
      changes: ["砂糖 大さじ2 → 大さじ1と1/2", "酢 → 米酢"],
    });

    const same = await api(me, `/recipes/${id}/versions`, {
      method: "POST",
      body: edited,
    });
    expect(await same.json()).toEqual({ unchanged: true });
    expect((await get(me, id)).versions).toHaveLength(2);
  });

  it("メモを反映した版を消すと、メモは未反映に戻る。元のレシピは消せない", async () => {
    const me = await signUp();
    const id = await create(me);
    const memoRes = await api(me, `/recipes/${id}/memos`, {
      method: "POST",
      body: { text: "酢は米酢がおすすめ" },
    });
    const memoId = ((await memoRes.json()) as { id: string }).id;
    const v = await api(me, `/recipes/${id}/versions`, {
      method: "POST",
      body: { ...sampleRecipe, title: "甘酢炒め（米酢）", memoId },
    });
    const { versionId } = (await v.json()) as { versionId: string };

    let r = await get(me, id);
    expect(r.versions[1]!.kind).toBe("memo");
    expect(r.memos[0]!.appliedVersionId).toBe(versionId);
    expect(r.title).toBe("甘酢炒め（米酢）");

    expect(
      (
        await api(me, `/recipes/${id}/versions/${r.versions[0]!.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await api(me, `/recipes/${id}/versions/${versionId}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(204);
    r = await get(me, id);
    expect(r.versions).toHaveLength(1);
    expect(r.memos[0]!.appliedVersionId).toBeNull();
    expect(r.title).toBe(sampleRecipe.title);
  });

  it("入力が正しくなければ 400", async () => {
    const me = await signUp();
    const res = await api(me, "/recipes", {
      method: "POST",
      body: { ...sampleRecipe, category: "おやつ" },
    });
    expect(res.status).toBe(400);
  });

  it("検索（レシピ名・カテゴリ）と材料から探す", async () => {
    const me = await signUp();
    await create(me);
    await create(me, {
      ...sampleRecipe,
      title: "豚汁",
      category: "汁物",
      genre: "和食",
      ingredients: [{ name: "豚こま肉", amount: "150g" }],
    });
    const byName = (await (await api(me, "/recipes?q=甘酢")).json()) as {
      recipes: { title: string }[];
    };
    expect(byName.recipes.map((r) => r.title)).toEqual(["鶏むね肉の甘酢炒め"]);
    const byCat = (await (await api(me, "/recipes?category=汁物")).json()) as {
      recipes: { title: string }[];
    };
    expect(byCat.recipes.map((r) => r.title)).toEqual(["豚汁"]);
    const found = (await (
      await api(me, "/recipes/find", {
        method: "POST",
        body: { terms: ["鶏肉", "玉ねぎ"] },
      })
    ).json()) as {
      results: { title: string; matched: number }[];
    };
    expect(found.results).toEqual([
      expect.objectContaining({ title: "鶏むね肉の甘酢炒め", matched: 2 }),
    ]);
  });

  it("写真を保存して取り出せる", async () => {
    const me = await signUp();
    const id = await create(me);
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const put = await api(me, `/recipes/${id}/image`, {
      method: "PUT",
      raw: bytes,
      headers: { "content-type": "image/jpeg" },
    });
    expect(put.status).toBe(204);
    const got = await api(me, `/recipes/${id}/image`);
    expect(got.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes);
    const bad = await api(me, `/recipes/${id}/image`, {
      method: "PUT",
      raw: "x",
      headers: { "content-type": "text/plain" },
    });
    expect(bad.status).toBe(415);
  });
});

describe("レビューで見つかった点の再発防止", () => {
  it("版を消しても番号は詰めない。消した版のカテゴリも元に戻る", async () => {
    const me = await signUp();
    const id = await create(me);
    await api(me, `/recipes/${id}/versions`, {
      method: "POST",
      body: { ...sampleRecipe, title: "v2" },
    });
    const v3 = await api(me, `/recipes/${id}/versions`, {
      method: "POST",
      body: { ...sampleRecipe, title: "v3", category: "丼" },
    });
    const { versionId } = (await v3.json()) as { versionId: string };
    await api(me, `/recipes/${id}/versions/${versionId}`, { method: "DELETE" });
    let r = (await (await api(me, `/recipes/${id}`)).json()) as {
      recipe: { category: string; title: string };
    };
    expect(r.recipe).toMatchObject({ title: "v2", category: "主菜" });
    const v4 = await api(me, `/recipes/${id}/versions`, {
      method: "POST",
      body: { ...sampleRecipe, title: "v4" },
    });
    expect(await v4.json()).toMatchObject({ seq: 4 });
    r = (await (await api(me, `/recipes/${id}`)).json()) as {
      recipe: { category: string; title: string };
    };
    expect(r.recipe.title).toBe("v4");
  });

  it("% や _ を含む名前でも検索できる", async () => {
    const me = await signUp();
    await create(me, { ...sampleRecipe, title: "糖質50%オフの煮物" });
    await create(me, { ...sampleRecipe, title: "普通の煮物" });
    const res = (await (
      await api(me, `/recipes?q=${encodeURIComponent("50%")}`)
    ).json()) as { recipes: { title: string }[] };
    expect(res.recipes.map((r) => r.title)).toEqual(["糖質50%オフの煮物"]);
  });

  it("レシピが100件を超えても一覧と材料から探すが動く", async () => {
    const me = await signUp();
    for (let i = 0; i < 12; i++) {
      await Promise.all(
        Array.from({ length: 10 }, (_, k) =>
          create(me, { ...sampleRecipe, title: `料理${i * 10 + k}` }),
        ),
      );
    }
    const list = await api(me, "/recipes");
    expect(list.status).toBe(200);
    expect(
      ((await list.json()) as { recipes: unknown[] }).recipes,
    ).toHaveLength(120);
    const found = await api(me, "/recipes/find", {
      method: "POST",
      body: { terms: ["鶏肉"] },
    });
    expect(found.status).toBe(200);
    expect(
      ((await found.json()) as { results: unknown[] }).results,
    ).toHaveLength(120);
  });
});

describe("グループをまたいだ漏れがないこと", () => {
  it("他の人のレシピは 見えない・変えられない・消せない・献立に入れられない", async () => {
    const alice = await signUp("A");
    const bob = await signUp("B");
    const id = await create(alice);

    const list = (await (await api(bob, "/recipes")).json()) as {
      recipes: unknown[];
    };
    expect(list.recipes).toEqual([]);
    expect((await api(bob, `/recipes/${id}`)).status).toBe(404);
    expect(
      (
        await api(bob, `/recipes/${id}/versions`, {
          method: "POST",
          body: { ...sampleRecipe, title: "乗っ取り" },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await api(bob, `/recipes/${id}/memos`, {
          method: "POST",
          body: { text: "x" },
        })
      ).status,
    ).toBe(404);
    expect((await api(bob, `/recipes/${id}/image`)).status).toBe(404);
    expect(
      (await api(bob, `/recipes/${id}`, { method: "DELETE" })).status,
    ).toBe(404);
    expect(
      (
        await api(bob, "/plans", {
          method: "PUT",
          body: { date: "2030-01-01", meal: "dinner", recipeId: id },
        })
      ).status,
    ).toBe(404);
    const found = (await (
      await api(bob, "/recipes/find", {
        method: "POST",
        body: { terms: ["鶏肉"] },
      })
    ).json()) as { results: unknown[] };
    expect(found.results).toEqual([]);

    // 読めなかった URL の報告も、グループの外からは見えない
    await api(alice, "/import/reports", {
      method: "POST",
      body: { url: "https://example.com/secret" },
    });
    const reports = (await (await api(bob, "/import/reports")).json()) as {
      reports: unknown[];
    };
    expect(reports.reports).toEqual([]);

    // グループの中身（メンバー・招待）も、他のグループからは見えない
    await api(alice, "/group/invites", {
      method: "POST",
      body: { email: "secret@example.test" },
    });
    const g = (await (await api(bob, "/group")).json()) as {
      invites: unknown[];
      members: unknown[];
    };
    expect(g.invites).toEqual([]);
    expect(g.members).toHaveLength(1);

    // bob は alice の招待を取り消せない。自分宛ての招待も無い
    const aliceInvites = (await (await api(alice, "/group")).json()) as {
      invites: { id: string }[];
    };
    const secretInviteId = aliceInvites.invites[0]!.id;
    expect(
      (
        await api(bob, `/group/invites/${secretInviteId}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(404);
    expect(
      ((await (await api(bob, "/invites")).json()) as { invites: unknown[] })
        .invites,
    ).toEqual([]);

    // alice からは変わらず見える
    expect((await get(alice, id)).title).toBe(sampleRecipe.title);
  });
});
