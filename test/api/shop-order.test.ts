import { describe, expect, it } from "vitest";
import { SHOP_SECTIONS } from "../../src/shared/constants";
import { api, signUp } from "./helpers";

// 買い物リストの売り場の並び（DEC-032）。家ごとに保存し、ほかの家には影響しない
type Shopping = { sections: string[] };

describe("売り場の並び", () => {
  it("はじめはおすすめの並び。保存すると買い物リストがその並びになる", async () => {
    const a = await signUp();
    const first = await (await api(a, "/shopping?days=3")).json<Shopping>();
    expect(first.sections).toEqual([...SHOP_SECTIONS]);

    const mine = [...SHOP_SECTIONS].reverse();
    const put = await api(a, "/group/shop-order", {
      method: "PUT",
      body: { order: mine },
    });
    expect(put.status).toBe(200);
    const after = await (await api(a, "/shopping?days=3")).json<Shopping>();
    expect(after.sections).toEqual(mine);

    const reset = await api(a, "/group/shop-order", {
      method: "PUT",
      body: { order: null },
    });
    expect(reset.status).toBe(200);
    const back = await (await api(a, "/shopping?days=3")).json<Shopping>();
    expect(back.sections).toEqual([...SHOP_SECTIONS]);
  });

  it("ほかの家の並びは変わらない", async () => {
    const a = await signUp();
    const b = await signUp();
    await api(a, "/group/shop-order", {
      method: "PUT",
      body: { order: [...SHOP_SECTIONS].reverse() },
    });
    const other = await (await api(b, "/shopping?days=3")).json<Shopping>();
    expect(other.sections).toEqual([...SHOP_SECTIONS]);
  });

  it("全部の売り場がそろっていない並びは保存できない", async () => {
    const a = await signUp();
    const r = await api(a, "/group/shop-order", {
      method: "PUT",
      body: { order: ["魚", "肉"] },
    });
    expect(r.status).toBe(400);
  });
});
