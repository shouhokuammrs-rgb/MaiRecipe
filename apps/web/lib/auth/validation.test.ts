import { describe, expect, it } from "vitest";

import {
  PASSWORD_MIN_LENGTH,
  validateDisplayName,
  validateEmail,
  validatePassword,
  validatePasswordConfirmation,
} from "@/lib/auth/validation";

describe("validateEmail", () => {
  it("正しい形式は null", () => {
    expect(validateEmail("user@example.com")).toBeNull();
    expect(validateEmail("  user@example.com  ")).toBeNull();
  });

  it("空・不正形式はメッセージ", () => {
    expect(validateEmail("")).toMatch(/入力してください/);
    expect(validateEmail("   ")).toMatch(/入力してください/);
    expect(validateEmail("not-an-email")).toMatch(/形式/);
    expect(validateEmail("a@b")).toMatch(/形式/);
  });
});

describe("validatePassword", () => {
  it(`${PASSWORD_MIN_LENGTH}文字以上なら null`, () => {
    expect(validatePassword("a".repeat(PASSWORD_MIN_LENGTH))).toBeNull();
  });

  it("空・短すぎる場合はメッセージ", () => {
    expect(validatePassword("")).toMatch(/入力してください/);
    expect(validatePassword("a".repeat(PASSWORD_MIN_LENGTH - 1))).toMatch(
      new RegExp(`${PASSWORD_MIN_LENGTH}文字以上`),
    );
  });
});

describe("validatePasswordConfirmation", () => {
  it("一致すれば null、不一致ならメッセージ", () => {
    expect(validatePasswordConfirmation("password1", "password1")).toBeNull();
    expect(validatePasswordConfirmation("password1", "password2")).toMatch(/一致しません/);
  });
});

describe("validateDisplayName", () => {
  it("通常の名前は null", () => {
    expect(validateDisplayName("えいいち")).toBeNull();
  });

  it("空白のみ・長すぎる場合はメッセージ", () => {
    expect(validateDisplayName("   ")).toMatch(/入力してください/);
    expect(validateDisplayName("あ".repeat(51))).toMatch(/50文字以内/);
  });
});
