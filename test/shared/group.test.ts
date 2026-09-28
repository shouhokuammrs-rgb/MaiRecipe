import { describe, expect, it } from "vitest";
import {
  GROUP_MAX_MEMBERS,
  inviteSchema,
  normalizeEmail,
} from "../../src/shared/group";

describe("normalizeEmail", () => {
  it("前後の空白を除いて小文字にする", () => {
    expect(normalizeEmail("  Hanako@Example.COM ")).toBe("hanako@example.com");
  });
});

describe("inviteSchema", () => {
  it("正規化してから検証する", () => {
    expect(inviteSchema.parse({ email: " A@B.jp " })).toEqual({
      email: "a@b.jp",
    });
  });
  it("メールでなければ失敗", () => {
    expect(inviteSchema.safeParse({ email: "abc" }).success).toBe(false);
    expect(inviteSchema.safeParse({}).success).toBe(false);
  });
});

it("上限は自分を含めて5人", () => {
  expect(GROUP_MAX_MEMBERS).toBe(5);
});
