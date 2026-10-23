import { describe, expect, it } from "vitest";
import { sourceKey } from "../../src/shared/source-key";

describe("sourceKey（同じレシピの URL か見分ける）", () => {
  it("YouTube は動画の ID でそろえる（watch・youtu.be・shorts・時刻つき）", () => {
    const k = sourceKey("https://www.youtube.com/watch?v=abcDEF12345");
    expect(k).toBe("yt:abcDEF12345");
    expect(sourceKey("https://youtu.be/abcDEF12345?t=30")).toBe(k);
    expect(sourceKey("https://www.youtube.com/shorts/abcDEF12345")).toBe(k);
    expect(
      sourceKey("https://m.youtube.com/watch?v=abcDEF12345&feature=share"),
    ).toBe(k);
  });

  it("ページは http/https・www・末尾の /・#・追跡用の値の違いを無視する", () => {
    const k = sourceKey("https://www.kurashiru.com/recipes/abc");
    expect(sourceKey("http://kurashiru.com/recipes/abc/")).toBe(k);
    expect(
      sourceKey("https://www.kurashiru.com/recipes/abc?utm_source=x#top"),
    ).toBe(k);
    expect(sourceKey("https://www.kurashiru.com/recipes/abd")).not.toBe(k);
  });

  it("意味のあるクエリは残す", () => {
    expect(sourceKey("https://example.com/r?id=1")).not.toBe(
      sourceKey("https://example.com/r?id=2"),
    );
  });

  it("URL でなければ null", () => {
    expect(sourceKey("あいう")).toBeNull();
    expect(sourceKey("")).toBeNull();
  });
});
