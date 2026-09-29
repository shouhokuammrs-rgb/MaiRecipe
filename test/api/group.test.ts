import { describe, expect, it } from "vitest";
import { todayJst } from "../../src/shared/dates";
import {
  api,
  groupMembershipCount,
  rawShoppingMark,
  signUpAs,
  verifyEmail,
} from "./helpers";

type GroupInfo = {
  name: string;
  members: { name: string; isMe: boolean; role: string }[];
  invites: { id: string; email: string }[];
};
const info = async (cookie: string) =>
  (await (await api(cookie, "/group")).json()) as GroupInfo;
const invite = (cookie: string, email: string) =>
  api(cookie, "/group/invites", { method: "POST", body: { email } });

describe("/api/group（グループ内の操作）", () => {
  it("最初は自分だけ。招待すると正規化したアドレスで招待中に出る。二度目は1件のまま", async () => {
    const a = await signUpAs("A");
    expect((await info(a.cookie)).members).toEqual([
      { name: "A", isMe: true, role: "owner" },
    ]);
    expect((await invite(a.cookie, "  Partner@Example.test ")).status).toBe(
      201,
    );
    expect((await invite(a.cookie, "partner@example.test")).status).toBe(201);
    expect((await info(a.cookie)).invites.map((i) => i.email)).toEqual([
      "partner@example.test",
    ]);
  });

  it("自分は招待できない（400）。メールでなければ 400", async () => {
    const a = await signUpAs("A");
    expect((await invite(a.cookie, ` ${a.email.toUpperCase()} `)).status).toBe(
      400,
    );
    expect((await invite(a.cookie, "not-mail")).status).toBe(400);
  });

  it("自分以外4人まで。5人目の招待は 409", async () => {
    const a = await signUpAs("A");
    for (let k = 0; k < 4; k++)
      expect(
        (await invite(a.cookie, `p${k}-${Date.now()}@example.test`)).status,
      ).toBe(201);
    expect(
      (await invite(a.cookie, `p5-${Date.now()}@example.test`)).status,
    ).toBe(409);
  });

  it("取り消せる。他のグループの招待は取り消せない（404）", async () => {
    const a = await signUpAs("A");
    const c = await signUpAs("C");
    await invite(a.cookie, "x@example.test");
    const id = (await info(a.cookie)).invites[0]!.id;
    expect(
      (await api(c.cookie, `/group/invites/${id}`, { method: "DELETE" }))
        .status,
    ).toBe(404);
    expect((await info(a.cookie)).invites).toHaveLength(1);
    expect(
      (await api(a.cookie, `/group/invites/${id}`, { method: "DELETE" }))
        .status,
    ).toBe(204);
    expect((await info(a.cookie)).invites).toEqual([]);
  });
});

const invitesOf = async (cookie: string) =>
  (
    (await (await api(cookie, "/invites")).json()) as {
      invites: { id: string; groupName: string; invitedBy: string }[];
    }
  ).invites;
const accept = (cookie: string, id: string) =>
  api(cookie, `/invites/${id}/accept`, { method: "POST" });
const recipe = (title: string) => ({
  title,
  category: "主菜",
  genre: "和食",
  ingredients: [{ name: "卵", amount: "1個" }],
  steps: ["焼く"],
});
const create = async (cookie: string, title: string) =>
  (
    (await (
      await api(cookie, "/recipes", { method: "POST", body: recipe(title) })
    ).json()) as { id: string }
  ).id;
const titles = async (cookie: string) =>
  (
    (await (await api(cookie, "/recipes")).json()) as {
      recipes: { title: string }[];
    }
  ).recipes
    .map((r) => r.title)
    .sort();
const plan = (cookie: string, date: string, recipeId: string) =>
  api(cookie, "/plans", {
    method: "PUT",
    body: { date, meal: "dinner", recipeId },
  });

const COMMON_URL = "https://invite-fixture.example.test/common";
const B_ONLY_URL = "https://invite-fixture.example.test/b-only";

describe("招待への参加", () => {
  it("確認済みの本人だけに招待が見え、参加すると相手のデータを持って同じグループになる", async () => {
    const a = await signUpAs("A");
    const b = await signUpAs("B");
    const c = await signUpAs("C");
    const aRecipe = await create(a.cookie, "Aの煮物");
    const bRecipe = await create(b.cookie, "Bのサラダ");
    await plan(a.cookie, "2030-10-03", aRecipe);
    await plan(b.cookie, "2030-10-03", bRecipe); // ぶつかる枠
    await plan(b.cookie, "2030-10-04", bRecipe); // ぶつからない枠

    // A 側の印・報告（参加でぶつかったとき A の側が残ることを確かめる下準備）
    await api(a.cookie, "/shopping/marks", {
      method: "PUT",
      body: { key: "共通の印", kind: "home", value: true },
    });
    await api(a.cookie, "/import/reports", {
      method: "POST",
      body: { url: COMMON_URL },
    });

    // B 側のメモ・写真・印・報告（参加で A 側に移ることを確かめる）
    expect(
      (
        await api(b.cookie, `/recipes/${bRecipe}/memos`, {
          method: "POST",
          body: { text: "多めに作る" },
        })
      ).status,
    ).toBe(201);
    const photoBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]);
    expect(
      (
        await api(b.cookie, `/recipes/${bRecipe}/image`, {
          method: "PUT",
          raw: photoBytes,
          headers: { "content-type": "image/jpeg" },
        })
      ).status,
    ).toBe(204);
    await api(b.cookie, "/shopping/marks", {
      method: "PUT",
      body: { key: "共通の印", kind: "home", value: false }, // ぶつかる
    });
    await api(b.cookie, "/shopping/marks", {
      method: "PUT",
      body: { key: "Bだけの印", kind: "bought", value: true }, // ぶつからない
    });
    await api(b.cookie, "/import/reports", {
      method: "POST",
      body: { url: COMMON_URL }, // ぶつかる
    });
    await api(b.cookie, "/import/reports", {
      method: "POST",
      body: { url: B_ONLY_URL }, // ぶつからない
    });
    // B が自分のレシピに版を1つ積んでおく（参加で recipe_versions も一緒に移ることを確かめる）
    expect(
      (
        await api(b.cookie, `/recipes/${bRecipe}/versions`, {
          method: "POST",
          body: {
            ...recipe("Bのサラダ"),
            ingredients: [{ name: "卵", amount: "2個" }],
          },
        })
      ).status,
    ).toBe(201);

    await invite(a.cookie, ` ${b.email.toUpperCase()} `);
    const inviteId = (await info(a.cookie)).invites[0]!.id;

    // 未確認のメールでは招待が見えず、参加もできない
    expect(await invitesOf(b.cookie)).toEqual([]);
    expect((await accept(b.cookie, inviteId)).status).toBe(404);

    await verifyEmail(b.email);
    expect(await invitesOf(b.cookie)).toEqual([
      { id: inviteId, groupName: expect.any(String), invitedBy: "A" },
    ]);

    // 参加前：お互いに見えない（レシピ・写真・報告・印）
    expect(await titles(b.cookie)).toEqual(["Bのサラダ"]);
    expect(await titles(a.cookie)).toEqual(["Aの煮物"]);
    expect((await api(a.cookie, `/recipes/${bRecipe}`)).status).toBe(404);
    expect((await api(a.cookie, `/recipes/${bRecipe}/image`)).status).toBe(404);
    expect(
      (
        (await (await api(a.cookie, "/import/reports")).json()) as {
          reports: { url: string }[];
        }
      ).reports.map((r) => r.url),
    ).toEqual([COMMON_URL]);
    expect(
      (
        (await (await api(b.cookie, "/import/reports")).json()) as {
          reports: { url: string }[];
        }
      ).reports
        .map((r) => r.url)
        .sort(),
    ).toEqual([B_ONLY_URL, COMMON_URL].sort());
    expect(await rawShoppingMark(a.email, "共通の印", "home")).toBe(true);
    expect(await rawShoppingMark(b.email, "共通の印", "home")).toBe(false);
    expect(await rawShoppingMark(b.email, "Bだけの印", "bought")).toBe(true);
    // 参加前：B から A の献立は見えず、B の /group はまだ自分1人だけ
    expect(
      (
        (await (
          await api(b.cookie, "/plans?from=2030-10-01&to=2030-10-31")
        ).json()) as { plans: { title: string }[] }
      ).plans.map((p) => p.title),
    ).toEqual(["Bのサラダ", "Bのサラダ"]);
    expect((await info(b.cookie)).members.map((m) => m.name)).toEqual(["B"]);

    // 招待されていない C は、確認済みでも参加できない
    await verifyEmail(c.email);
    expect(await invitesOf(c.cookie)).toEqual([]);
    expect((await accept(c.cookie, inviteId)).status).toBe(404);

    const res = await accept(b.cookie, inviteId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ movedRecipes: 1 });

    // 参加後：同じものが見える。ぶつかった枠は両方残り、招待した側（A）の品が先
    expect(await titles(a.cookie)).toEqual(["Aの煮物", "Bのサラダ"]);
    expect(await titles(b.cookie)).toEqual(["Aの煮物", "Bのサラダ"]);
    const plans = (
      (await (
        await api(a.cookie, "/plans?from=2030-10-01&to=2030-10-31")
      ).json()) as {
        plans: { date: string; title: string; position: number }[];
      }
    ).plans;
    expect(plans.map((p) => `${p.date}:${p.title}:${p.position}`)).toEqual([
      "2030-10-03:Aの煮物:0",
      "2030-10-03:Bのサラダ:1",
      "2030-10-04:Bのサラダ:0",
    ]);

    // A から B が持ち込んだメモ・写真・版が見える
    const bRecipeFromA = (await (
      await api(a.cookie, `/recipes/${bRecipe}`)
    ).json()) as {
      recipe: {
        memos: { text: string }[];
        hasImage: boolean;
        versions: {
          seq: number;
          ingredients: { name: string; amount: string }[];
        }[];
      };
    };
    expect(bRecipeFromA.recipe.memos.map((m) => m.text)).toContain(
      "多めに作る",
    );
    expect(bRecipeFromA.recipe.hasImage).toBe(true);
    expect(bRecipeFromA.recipe.versions.map((v) => v.seq)).toEqual([1, 2]);
    expect(bRecipeFromA.recipe.versions[1]!.ingredients).toEqual([
      { name: "卵", amount: "2個" },
    ]);
    const img = await api(a.cookie, `/recipes/${bRecipe}/image`);
    expect(img.status).toBe(200);
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(photoBytes);

    // ぶつかった印は招待した側（A）の値が残り、ぶつからない印は移る
    expect(await rawShoppingMark(a.email, "共通の印", "home")).toBe(true);
    expect(await rawShoppingMark(a.email, "Bだけの印", "bought")).toBe(true);

    // 報告は重複せず、両方見える
    expect(
      (
        (await (await api(a.cookie, "/import/reports")).json()) as {
          reports: { url: string }[];
        }
      ).reports
        .map((r) => r.url)
        .sort(),
    ).toEqual([B_ONLY_URL, COMMON_URL].sort());

    // B が持ってきたレシピを A が編集できる
    expect(
      (
        await api(a.cookie, `/recipes/${bRecipe}/versions`, {
          method: "POST",
          body: recipe("Bのサラダ改"),
        })
      ).status,
    ).toBe(201);
    // メンバーは2人（B の1人グループは作り直されない）、招待は消えた
    const g = await info(b.cookie);
    expect(g.members.map((m) => [m.name, m.isMe])).toEqual([
      ["A", false],
      ["B", true],
    ]);
    expect(g.invites).toEqual([]);
    // 同じ招待でもう一度は 404
    expect((await accept(b.cookie, inviteId)).status).toBe(404);
    // C からは何も見えない
    expect(await titles(c.cookie)).toEqual([]);
    expect((await api(c.cookie, `/recipes/${bRecipe}`)).status).toBe(404);
    expect(
      (
        (await (await api(c.cookie, "/import/reports")).json()) as {
          reports: unknown[];
        }
      ).reports,
    ).toEqual([]);
    // 参加後も、C からは献立・買い物のどちらも空
    expect(
      (
        (await (
          await api(c.cookie, "/plans?from=2030-10-01&to=2030-10-31")
        ).json()) as { plans: unknown[] }
      ).plans,
    ).toEqual([]);
    // /shopping は「今日から」の献立で計算するので、2030年の献立だけでは A 自身の買い物リストも
    // 空になってしまい、C が空でも何も証明しない。今日の枠に献立を1つ入れてから確かめる
    await plan(a.cookie, todayJst(), aRecipe);
    const aShopping = (await (
      await api(a.cookie, "/shopping?days=7")
    ).json()) as {
      items: unknown[];
    };
    expect(aShopping.items.length).toBeGreaterThan(0); // 下見：この枠が本当に買い物リストに反映される
    const cShopping = (await (
      await api(c.cookie, "/shopping?days=7")
    ).json()) as {
      items: unknown[];
    };
    expect(cShopping.items).toEqual([]);
  });

  it("取り消し済みの招待は参加できない（404）", async () => {
    const a = await signUpAs("A");
    const b = await signUpAs("B");
    await verifyEmail(b.email);
    await invite(a.cookie, b.email);
    const id = (await info(a.cookie)).invites[0]!.id;
    expect(
      (await api(a.cookie, `/group/invites/${id}`, { method: "DELETE" }))
        .status,
    ).toBe(204);
    expect((await accept(b.cookie, id)).status).toBe(404);
  });

  it("同じ招待を同時に2回受けても、参加できるのは1回だけ（レース対策）", async () => {
    const a = await signUpAs("A");
    const b = await signUpAs("B");
    await verifyEmail(b.email);
    await invite(a.cookie, b.email);
    const id = (await invitesOf(b.cookie))[0]!.id;

    const [r1, r2] = await Promise.all([
      accept(b.cookie, id),
      accept(b.cookie, id),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 404]);
    expect(await groupMembershipCount(b.email)).toBe(1);
  });

  it("同時に別々の招待を受けても、入るグループは1つだけ（レース対策）", async () => {
    const a = await signUpAs("A");
    const e = await signUpAs("E");
    const b = await signUpAs("B");
    await verifyEmail(b.email);
    await invite(a.cookie, b.email);
    await invite(e.cookie, b.email);
    const invites = await invitesOf(b.cookie);
    const idA = invites.find((i) => i.invitedBy === "A")!.id;
    const idE = invites.find((i) => i.invitedBy === "E")!.id;

    const [rA, rE] = await Promise.all([
      accept(b.cookie, idA),
      accept(b.cookie, idE),
    ]);
    // どちらか一方だけが参加できる。両方成功して2つのグループに入る、ということは無い
    expect([rA.status, rE.status].sort()).toEqual([200, 409]);
    expect(await groupMembershipCount(b.email)).toBe(1);
  });

  it("参加の途中で相手（自分が招待した人）のグループの人数が変わっても、データが半分だけ移ることは無い（レース対策）", async () => {
    const a = await signUpAs("A");
    const b = await signUpAs("B");
    const d = await signUpAs("D");
    await verifyEmail(b.email);
    await verifyEmail(d.email);
    const dRecipe = await create(d.cookie, "Dの卵焼き");
    await invite(b.cookie, d.email); // B が D を招待（D が受けると B のグループに入る）
    const idBD = (await invitesOf(d.cookie))[0]!.id;
    await invite(a.cookie, b.email); // A が B を招待
    const idAB = (await invitesOf(b.cookie))[0]!.id;

    // B が A に参加するのと、D が B に参加するのを同時に起こす
    const [rb, rd] = await Promise.all([
      accept(b.cookie, idAB),
      accept(d.cookie, idBD),
    ]);

    const successes = [rb.status, rd.status].filter((s) => s === 200);
    expect(successes).toHaveLength(1);
    expect(await groupMembershipCount(b.email)).toBe(1);
    expect(await groupMembershipCount(d.email)).toBe(1);

    if (rb.status === 200) {
      // B が先に A に参加した場合：B のグループへの D の招待は無くなるので D は 404
      expect(rd.status).toBe(404);
      // D は自分のデータのまま。A から D のレシピは見えない（漏れていない）
      expect(await titles(d.cookie)).toEqual(["Dの卵焼き"]);
      expect((await api(a.cookie, `/recipes/${dRecipe}`)).status).toBe(404);
    } else {
      // D が先に B に参加した場合：B のグループが2人になるので B の A への参加は 409
      expect(rb.status).toBe(409);
      // D のレシピは B のグループに入るが、A のグループにはまだ無い（半分だけ移っていない）
      expect(await titles(b.cookie)).toContain("Dの卵焼き");
      expect((await api(a.cookie, `/recipes/${dRecipe}`)).status).toBe(404);
    }
  });

  it("自分のグループにメンバーがいる人は参加できない（409）", async () => {
    const a = await signUpAs("A");
    const b = await signUpAs("B");
    const d = await signUpAs("D");
    await verifyEmail(b.email);
    await verifyEmail(d.email);
    await invite(b.cookie, d.email);
    expect(
      (await accept(d.cookie, (await invitesOf(d.cookie))[0]!.id)).status,
    ).toBe(200);
    await invite(a.cookie, b.email);
    expect(
      (await accept(b.cookie, (await invitesOf(b.cookie))[0]!.id)).status,
    ).toBe(409);
  });

  it("既にメンバーの人は招待できない（409）", async () => {
    const a = await signUpAs("A");
    const b = await signUpAs("B");
    await verifyEmail(b.email);
    await invite(a.cookie, b.email);
    await accept(b.cookie, (await invitesOf(b.cookie))[0]!.id);
    expect((await invite(a.cookie, b.email)).status).toBe(409);
  });

  it("同じ枠に両方2品ずつあっても、招待した側の順 → 参加した側の順で並ぶ", async () => {
    const a = await signUpAs("A");
    const b = await signUpAs("B");
    const day = "2030-11-05";
    const a1 = await create(a.cookie, "A1");
    const a2 = await create(a.cookie, "A2");
    const b1 = await create(b.cookie, "B1");
    const b2 = await create(b.cookie, "B2");
    for (const r of [a1, a2]) await plan(a.cookie, day, r);
    for (const r of [b1, b2]) await plan(b.cookie, day, r);
    await verifyEmail(b.email);
    await invite(a.cookie, b.email);
    expect(
      (await accept(b.cookie, (await invitesOf(b.cookie))[0]!.id)).status,
    ).toBe(200);

    const read = async (cookie: string) =>
      (
        (await (await api(cookie, `/plans?from=${day}&to=${day}`)).json()) as {
          plans: { id: string; title: string }[];
        }
      ).plans;
    expect((await read(a.cookie)).map((p) => p.title)).toEqual([
      "A1",
      "A2",
      "B1",
      "B2",
    ]);
    expect((await read(b.cookie)).map((p) => p.title)).toEqual([
      "A1",
      "A2",
      "B1",
      "B2",
    ]);
    // 移ってきた品も、同じグループの品として並べ替えられる
    const b1Item = (await read(a.cookie)).find((p) => p.title === "B1")!;
    expect(
      (
        await api(a.cookie, `/plans/items/${b1Item.id}/move`, {
          method: "POST",
          body: { direction: "up" },
        })
      ).status,
    ).toBe(204);
    expect((await read(b.cookie)).map((p) => p.title)).toEqual([
      "A1",
      "B1",
      "A2",
      "B2",
    ]);
  });
});
