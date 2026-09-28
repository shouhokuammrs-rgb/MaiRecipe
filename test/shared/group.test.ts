import { describe, expect, it } from "vitest";
import {
  GROUP_MAX_MEMBERS,
  inviteSchema,
  normalizeEmail,
  planSlotLabel,
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

describe("planSlotLabel", () => {
  it("日付と食事を日本語にする", () => {
    expect(planSlotLabel("2026-10-03", "dinner")).toBe("10月3日の夜");
    expect(planSlotLabel("2026-01-15", "breakfast")).toBe("1月15日の朝");
    expect(planSlotLabel("2026-12-01", "lunch")).toBe("12月1日の昼");
  });
});

it("上限は自分を含めて5人", () => {
  expect(GROUP_MAX_MEMBERS).toBe(5);
});
