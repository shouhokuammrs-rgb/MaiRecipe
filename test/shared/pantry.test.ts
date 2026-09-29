import { describe, expect, it } from "vitest";
import { LIMITS } from "../../src/shared/constants";
import {
  addedLabel,
  isExpiringSoon,
  isSeasoning,
  pantryAddSchema,
  pantryPatchSchema,
  shoppingHaveSchema,
  sortPantry,
  splitPantryInput,
} from "../../src/shared/pantry";

describe("冷蔵庫に入れる名前の分割", () => {
  it("スペース（全角も）・読点・カンマで区切り、名寄せして重複を消す", () => {
    expect(splitPantryInput("たまねぎ　にんじん、豚こま肉,玉葱 ")).toEqual([
      "玉ねぎ",
      "にんじん",
      "豚こま肉",
    ]);
  });
  it("空なら空の配列", () => {
    expect(splitPantryInput("  、 ")).toEqual([]);
  });
});

describe("調味料の判定", () => {
  it("名寄せしてから売り場で判定する", () => {
    expect(isSeasoning("しょうゆ")).toBe(true);
    expect(isSeasoning("玉ねぎ")).toBe(false);
  });
});

describe("入れた日と期限", () => {
  it("◯日前", () => {
    expect(addedLabel("2026-09-30", "2026-09-30")).toBe("今日入れた");
    expect(addedLabel("2026-09-29", "2026-09-30")).toBe("昨日入れた");
    expect(addedLabel("2026-09-25", "2026-09-30")).toBe("5日前に入れた");
  });
  it("期限が3日以内（過ぎたものも）なら近い", () => {
    expect(isExpiringSoon("2026-10-03", "2026-09-30")).toBe(true);
    expect(isExpiringSoon("2026-10-04", "2026-09-30")).toBe(false);
    expect(isExpiringSoon("2026-09-28", "2026-09-30")).toBe(true);
    expect(isExpiringSoon(null, "2026-09-30")).toBe(false);
  });
  it("期限が近い順（期限なしは後ろ）→ 入れた日が新しい順 → 名前", () => {
    const items = [
      { name: "卵", expiresOn: null, addedOn: "2026-09-20" },
      { name: "しめじ", expiresOn: "2026-10-02", addedOn: "2026-09-26" },
      { name: "大根", expiresOn: null, addedOn: "2026-09-28" },
      { name: "鶏むね肉", expiresOn: "2026-10-01", addedOn: "2026-09-27" },
      { name: "あじ", expiresOn: null, addedOn: "2026-09-28" },
    ];
    expect(sortPantry(items).map((i) => i.name)).toEqual([
      "鶏むね肉",
      "しめじ",
      "あじ",
      "大根",
      "卵",
    ]);
  });
});

describe("入力の検証", () => {
  it("追加は1〜30個", () => {
    expect(pantryAddSchema.safeParse({ names: [] }).success).toBe(false);
    expect(
      pantryAddSchema.safeParse({ names: Array(31).fill("卵") }).success,
    ).toBe(false);
    expect(pantryAddSchema.safeParse({ names: ["卵"] }).success).toBe(true);
  });
  it("直すのは量か期限のどちらか。空の量は null、期限は日付か null", () => {
    expect(pantryPatchSchema.safeParse({}).success).toBe(false);
    expect(pantryPatchSchema.parse({ amount: "  " })).toEqual({ amount: null });
    expect(pantryPatchSchema.parse({ expiresOn: null })).toEqual({
      expiresOn: null,
    });
    expect(pantryPatchSchema.safeParse({ expiresOn: "10/3" }).success).toBe(
      false,
    );
  });
  it("買い物のチェック", () => {
    expect(
      shoppingHaveSchema.safeParse({ name: " ", value: true }).success,
    ).toBe(false);
    expect(shoppingHaveSchema.parse({ name: " 卵 ", value: true })).toEqual({
      name: "卵",
      value: true,
    });
  });
  it("名前の上限はレシピの材料名と同じ（60文字）", () => {
    const ok = "あ".repeat(LIMITS.ingredientNameMax);
    const tooLong = "あ".repeat(LIMITS.ingredientNameMax + 1);
    expect(pantryAddSchema.safeParse({ names: [ok] }).success).toBe(true);
    expect(pantryAddSchema.safeParse({ names: [tooLong] }).success).toBe(false);
    expect(
      shoppingHaveSchema.safeParse({ name: ok, value: true }).success,
    ).toBe(true);
    expect(
      shoppingHaveSchema.safeParse({ name: tooLong, value: true }).success,
    ).toBe(false);
  });
});
