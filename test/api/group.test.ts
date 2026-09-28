import { describe, expect, it } from "vitest";
import { api, signUpAs, verifyEmail } from "./helpers";

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
    await invite(a.cookie, ` ${b.email.toUpperCase()} `);
    const inviteId = (await info(a.cookie)).invites[0]!.id;

    // 未確認のメールでは招待が見えず、参加もできない
    expect(await invitesOf(b.cookie)).toEqual([]);
    expect((await accept(b.cookie, inviteId)).status).toBe(404);

    await verifyEmail(b.email);
    expect(await invitesOf(b.cookie)).toEqual([
      { id: inviteId, groupName: expect.any(String), invitedBy: "A" },
    ]);

    // 参加前：お互いに見えない
    expect(await titles(b.cookie)).toEqual(["Bのサラダ"]);
    expect(await titles(a.cookie)).toEqual(["Aの煮物"]);

    // 招待されていない C は、確認済みでも参加できない
    await verifyEmail(c.email);
    expect(await invitesOf(c.cookie)).toEqual([]);
    expect((await accept(c.cookie, inviteId)).status).toBe(404);

    const res = await accept(b.cookie, inviteId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      movedRecipes: 1,
      keptPlans: [{ date: "2030-10-03", meal: "dinner" }],
    });

    // 参加後：同じものが見える。ぶつかった枠は A の献立、ぶつからない B の献立は移る
    expect(await titles(a.cookie)).toEqual(["Aの煮物", "Bのサラダ"]);
    expect(await titles(b.cookie)).toEqual(["Aの煮物", "Bのサラダ"]);
    const plans = (
      (await (
        await api(a.cookie, "/plans?from=2030-10-01&to=2030-10-31")
      ).json()) as {
        plans: { date: string; title: string }[];
      }
    ).plans;
    expect(plans.map((p) => `${p.date}:${p.title}`)).toEqual([
      "2030-10-03:Aの煮物",
      "2030-10-04:Bのサラダ",
    ]);
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
});
