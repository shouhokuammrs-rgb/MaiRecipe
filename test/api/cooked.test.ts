import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { todayJst } from "../../src/shared/dates";
import { api, sampleRecipe, signUp, signUpAs, verifyEmail } from "./helpers";

// 作った！（DEC-030）：作った記録は共有、誰が食べたか・評価は本人のもの
type Info = {
  members: { id: string; name: string; isMe: boolean; role: string }[];
  invites: { id: string; email: string }[];
};
const E = env as unknown as { GEMINI_API_KEY?: string; AI?: unknown };
afterEach(() => {
  delete E.GEMINI_API_KEY;
  delete E.AI;
  vi.restoreAllMocks();
});
const info = async (c: string) =>
  (await (await api(c, "/group")).json()) as Info;

/** A が B を招待して同じグループにする。[A, B] の cookie と id を返す */
async function pair() {
  const a = await signUpAs("A");
  const b = await signUpAs("B");
  await verifyEmail(b.email);
  await api(a.cookie, "/group/invites", {
    method: "POST",
    body: { email: b.email },
  });
  const inviteId = (await info(a.cookie)).invites[0]!.id;
  await api(b.cookie, `/invites/${inviteId}/accept`, { method: "POST" });
  const members = (await info(a.cookie)).members;
  return {
    a: a.cookie,
    b: b.cookie,
    aId: members.find((m) => m.name === "A")!.id,
    bId: members.find((m) => m.name === "B")!.id,
  };
}

async function recipe(c: string, title = "ダミーの生姜焼き") {
  const res = await api(c, "/recipes", {
    method: "POST",
    body: {
      ...sampleRecipe,
      title,
      servings: 2,
      ingredients: [
        { name: "豚こま肉", amount: "200g" },
        { name: "玉ねぎ", amount: "1個" },
      ],
    },
  });
  return ((await res.json()) as { id: string }).id;
}

type Detail = {
  recipe: {
    versions: { id: string; seq: number }[];
    cooked: {
      id: string;
      versionSeq: number | null;
      servings: number;
      cookedOn: string;
      cookedBy: string;
      note: string;
      myRating: string | null;
      iAte: boolean;
    }[];
    cookedStats: {
      count: number;
      lastCookedOn: string | null;
      again: number;
      myLatestRating: string | null;
    };
  };
};
const detail = async (c: string, id: string) =>
  ((await (await api(c, `/recipes/${id}`)).json()) as Detail).recipe;

describe("POST /api/recipes/:id/cooked", () => {
  it("作った記録が版に紐づいて残り、食べた人ごとに食べた記録が入る。評価と食べたかは本人の分だけ見える", async () => {
    const { a, b, aId, bId } = await pair();
    const id = await recipe(a);
    const v = (await detail(a, id)).versions[0]!;
    const res = await api(a, `/recipes/${id}/cooked`, {
      method: "POST",
      body: {
        versionId: v.id,
        servings: 3,
        eaters: [
          { userId: aId, portion: 1 },
          { userId: bId, portion: 1.5 },
        ],
        rating: "again",
        note: "大根を足した",
      },
    });
    expect(res.status).toBe(201);
    const r = await detail(b, id);
    expect(r.cooked).toHaveLength(1);
    expect(r.cooked[0]).toMatchObject({
      versionSeq: 1,
      servings: 3,
      cookedOn: todayJst(),
      cookedBy: "A",
      note: "大根を足した",
      // B から見ると A の評価は見えず、自分が食べたことだけ分かる
      myRating: null,
      iAte: true,
    });
    expect(JSON.stringify(r.cooked[0])).not.toContain("again");
    expect(r.cookedStats).toEqual({
      count: 1,
      lastCookedOn: todayJst(),
      again: 0,
      myLatestRating: null,
    });
    const rA = await detail(a, id);
    expect(rA.cooked[0]).toMatchObject({ myRating: "again", iAte: true });
    expect(rA.cookedStats.again).toBe(1);
    // B が自分の評価を付ける
    const rate = await api(b, `/cooked/${r.cooked[0]!.id}/rating`, {
      method: "PUT",
      body: { rating: "meh" },
    });
    expect(rate.status).toBe(204);
    const r2 = await detail(b, id);
    expect(r2.cooked[0]!.myRating).toBe("meh");
    expect(r2.cookedStats.myLatestRating).toBe("meh");
    // A の見え方は変わらない
    expect((await detail(a, id)).cooked[0]!.myRating).toBe("again");
    // 食べた記録は本人の分だけ見える
    const mealsA = (await (
      await api(a, `/meals?from=${todayJst()}&to=${todayJst()}`)
    ).json()) as { meals: { title: string; portion: number }[] };
    expect(mealsA.meals).toEqual([
      expect.objectContaining({ title: "ダミーの生姜焼き", portion: 1 }),
    ]);
    const mealsB = (await (
      await api(b, `/meals?from=${todayJst()}&to=${todayJst()}`)
    ).json()) as { meals: { portion: number }[] };
    expect(mealsB.meals.map((m) => m.portion)).toEqual([1.5]);
    // グループの外の人には何も見えない
    const stranger = await signUp();
    const mealsS = (await (
      await api(stranger, `/meals?from=${todayJst()}&to=${todayJst()}`)
    ).json()) as { meals: unknown[] };
    expect(mealsS.meals).toEqual([]);
  });

  it("使った食材を冷蔵庫から消す（選んだものだけ）", async () => {
    const me = await signUp();
    const id = await recipe(me);
    await api(me, "/pantry", {
      method: "POST",
      body: { names: ["豚こま肉", "玉ねぎ", "にんじん"] },
    });
    const items = (await (await api(me, "/pantry")).json()) as {
      items: { id: string; name: string }[];
    };
    const pork = items.items.find((i) => i.name === "豚こま肉")!.id;
    const meId = (await info(me)).members[0]!.id;
    const res = await api(me, `/recipes/${id}/cooked`, {
      method: "POST",
      body: {
        servings: 2,
        eaters: [{ userId: meId, portion: 1 }],
        usedPantryIds: [pork],
      },
    });
    expect(res.status).toBe(201);
    const pantry = (await (await api(me, "/pantry")).json()) as {
      items: { name: string }[];
    };
    expect(pantry.items.map((i) => i.name).sort()).toEqual([
      "にんじん",
      "玉ねぎ",
    ]);
  });

  it("グループ外の人は食べた人にできない（400）。他人のレシピには記録できない（404）。他人の記録の評価は付けられない（404）", async () => {
    const { a, aId } = await pair();
    const stranger = await signUpAs("S");
    const strangerId = (await info(stranger.cookie)).members[0]!.id;
    const id = await recipe(a);
    expect(
      (
        await api(a, `/recipes/${id}/cooked`, {
          method: "POST",
          body: {
            servings: 2,
            eaters: [{ userId: strangerId, portion: 1 }],
          },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api(stranger.cookie, `/recipes/${id}/cooked`, {
          method: "POST",
          body: { servings: 2, eaters: [{ userId: strangerId, portion: 1 }] },
        })
      ).status,
    ).toBe(404);
    await api(a, `/recipes/${id}/cooked`, {
      method: "POST",
      body: { servings: 2, eaters: [{ userId: aId, portion: 1 }] },
    });
    const logId = (await detail(a, id)).cooked[0]!.id;
    expect(
      (
        await api(stranger.cookie, `/cooked/${logId}/rating`, {
          method: "PUT",
          body: { rating: "again" },
        })
      ).status,
    ).toBe(404);
    expect(
      (await api(stranger.cookie, `/cooked/${logId}`, { method: "DELETE" }))
        .status,
    ).toBe(404);
    // 他人の冷蔵庫の行を usedPantryIds に入れても消えない
    await api(stranger.cookie, "/pantry", {
      method: "POST",
      body: { names: ["ひみつのかぶ"] },
    });
    const sp = (await (await api(stranger.cookie, "/pantry")).json()) as {
      items: { id: string }[];
    };
    await api(a, `/recipes/${id}/cooked`, {
      method: "POST",
      body: {
        servings: 2,
        eaters: [{ userId: aId, portion: 1 }],
        usedPantryIds: [sp.items[0]!.id],
      },
    });
    const sPantry = (await (await api(stranger.cookie, "/pantry")).json()) as {
      items: { name: string }[];
    };
    expect(sPantry.items.map((i) => i.name)).toEqual(["ひみつのかぶ"]);
  });

  it("記録を消すと、食べた記録と評価も消える", async () => {
    const me = await signUp();
    const id = await recipe(me);
    const meId = (await info(me)).members[0]!.id;
    await api(me, `/recipes/${id}/cooked`, {
      method: "POST",
      body: {
        servings: 2,
        eaters: [{ userId: meId, portion: 1 }],
        rating: "ok",
      },
    });
    const logId = (await detail(me, id)).cooked[0]!.id;
    expect(
      (await api(me, `/cooked/${logId}`, { method: "DELETE" })).status,
    ).toBe(204);
    expect((await detail(me, id)).cooked).toEqual([]);
    const meals = (await (
      await api(me, `/meals?from=${todayJst()}&to=${todayJst()}`)
    ).json()) as { meals: unknown[] };
    expect(meals.meals).toEqual([]);
    const n = await env.DB.prepare(
      "select count(*) as n from cook_ratings where cook_log_id = ?",
    )
      .bind(logId)
      .first<{ n: number }>();
    expect(n?.n).toBe(0);
  });
});

describe("作った記録が「最近作った」に効く", () => {
  it("献立に入れずに作ったレシピは、今日のおすすめで下がり、AI 献立の「最近作った」に入る", async () => {
    const me = await signUp();
    const a = await recipe(me, "ダミーの鮭のホイル焼き");
    const b = await recipe(me, "ダミーの鮭のムニエル");
    await api(me, "/pantry", { method: "POST", body: { names: ["鮭"] } });
    // 両方とも材料は同じ（豚こま肉・玉ねぎ）なので、作った方だけ下がる
    await api(me, `/recipes/${a}/cooked`, {
      method: "POST",
      body: { servings: 2, eaters: [] },
    });
    const reco = (await (await api(me, "/recommend")).json()) as {
      main: { id: string }[];
    };
    expect(reco.main.map((r) => r.id)).toEqual([b, a]);

    E.GEMINI_API_KEY = "k";
    const bodies: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      bodies.push(String(init?.body));
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"plan":[]}' }] } }],
        }),
      );
    });
    await api(me, "/plans/suggest", {
      method: "POST",
      body: { days: 1, meals: ["dinner"] },
    });
    expect(bodies[0]).toContain("最近作った：ダミーの鮭のホイル焼き");
  });
});
