import { describe, expect, it } from "vitest";
import { api, signUpAs } from "./helpers";

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
