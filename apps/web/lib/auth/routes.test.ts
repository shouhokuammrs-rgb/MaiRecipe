import { describe, expect, it } from "vitest";

import { isGuestOnlyPath, isPublicPath, safeNextPath } from "@/lib/auth/routes";

describe("isPublicPath", () => {
  it("認証系ページは未ログインでも公開", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/signup")).toBe(true);
    expect(isPublicPath("/reset-password")).toBe(true);
    expect(isPublicPath("/auth/confirm")).toBe(true);
    expect(isPublicPath("/auth")).toBe(true);
  });

  it("(app) 配下は保護対象", () => {
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/settings/profile")).toBe(false);
    expect(isPublicPath("/recipes/123")).toBe(false);
  });

  it("/update-password はセッション必須なので保護対象", () => {
    expect(isPublicPath("/update-password")).toBe(false);
  });

  it("前方一致で誤って公開しない", () => {
    expect(isPublicPath("/login-history")).toBe(false);
    expect(isPublicPath("/authors")).toBe(false);
  });
});

describe("isGuestOnlyPath", () => {
  it("ログイン済みなら / へ戻すページ", () => {
    expect(isGuestOnlyPath("/login")).toBe(true);
    expect(isGuestOnlyPath("/signup")).toBe(true);
    expect(isGuestOnlyPath("/reset-password")).toBe(true);
  });

  it("コールバックと更新ページは対象外", () => {
    expect(isGuestOnlyPath("/auth/confirm")).toBe(false);
    expect(isGuestOnlyPath("/update-password")).toBe(false);
    expect(isGuestOnlyPath("/")).toBe(false);
  });
});

describe("safeNextPath", () => {
  it("相対パスはそのまま", () => {
    expect(safeNextPath("/settings/profile")).toBe("/settings/profile");
    expect(safeNextPath("/recipes?tab=all")).toBe("/recipes?tab=all");
  });

  it("空・未指定はフォールバック", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath("")).toBe("/");
    expect(safeNextPath("", "/login")).toBe("/login");
  });

  it("外部URL・プロトコル相対・改行はフォールバック（オープンリダイレクト対策）", () => {
    expect(safeNextPath("https://evil.example.com")).toBe("/");
    expect(safeNextPath("//evil.example.com")).toBe("/");
    expect(safeNextPath("/\\evil.example.com")).toBe("/");
    expect(safeNextPath("javascript:alert(1)")).toBe("/");
    expect(safeNextPath("/ok\r\nLocation: x")).toBe("/");
  });
});
