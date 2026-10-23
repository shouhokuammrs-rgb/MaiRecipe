import { describe, expect, it } from "vitest";
import {
  cleanImageUrl,
  jsonLdImage,
  pickCover,
  youtubeThumb,
} from "../../src/shared/cover";

describe("cleanImageUrl（ページの共有用の画像）", () => {
  it("https の画像だけ。相対の URL はページの URL から直す", () => {
    expect(
      cleanImageUrl("https://img.example.com/a.jpg", "https://example.com/r/1"),
    ).toBe("https://img.example.com/a.jpg");
    expect(cleanImageUrl("/img/a.jpg", "https://example.com/r/1")).toBe(
      "https://example.com/img/a.jpg",
    );
    expect(
      cleanImageUrl("//cdn.example.com/a.jpg", "https://example.com/r/1"),
    ).toBe("https://cdn.example.com/a.jpg");
  });
  it("http・data・長すぎる URL・空は使わない", () => {
    expect(
      cleanImageUrl("http://example.com/a.jpg", "https://example.com"),
    ).toBeNull();
    expect(
      cleanImageUrl("data:image/png;base64,AAAA", "https://example.com"),
    ).toBeNull();
    expect(
      cleanImageUrl(
        `https://example.com/${"a".repeat(2100)}`,
        "https://example.com",
      ),
    ).toBeNull();
    expect(cleanImageUrl("", "https://example.com")).toBeNull();
  });
});

describe("youtubeThumb", () => {
  it("動画・Shorts のサムネイル", () => {
    expect(youtubeThumb("https://www.youtube.com/watch?v=abcDEF12345")).toBe(
      "https://i.ytimg.com/vi/abcDEF12345/hqdefault.jpg",
    );
    expect(youtubeThumb("https://www.youtube.com/shorts/abcDEF12345")).toBe(
      "https://i.ytimg.com/vi/abcDEF12345/hqdefault.jpg",
    );
    expect(youtubeThumb("https://example.com/")).toBeNull();
  });
});

describe("pickCover（どの表紙を出すか）", () => {
  it("自分の写真 → 出典の画像 → 動画のサムネイル → なし", () => {
    expect(
      pickCover({
        hasImage: true,
        coverUrl: "https://x/a.jpg",
        videoUrl: null,
      }),
    ).toEqual({
      kind: "own",
    });
    expect(
      pickCover({
        hasImage: false,
        coverUrl: "https://x/a.jpg",
        videoUrl: null,
      }),
    ).toEqual({ kind: "source", url: "https://x/a.jpg" });
    expect(
      pickCover({
        hasImage: false,
        coverUrl: null,
        videoUrl: "https://www.youtube.com/watch?v=abcDEF12345",
      }),
    ).toEqual({
      kind: "source",
      url: "https://i.ytimg.com/vi/abcDEF12345/hqdefault.jpg",
    });
    expect(
      pickCover({ hasImage: false, coverUrl: "", videoUrl: null }),
    ).toEqual({
      kind: "none",
    });
  });
});

describe("jsonLdImage", () => {
  it("Recipe の image（文字・配列・url つき）を使う", () => {
    const page = "https://example.com/r/1";
    expect(
      jsonLdImage(['{"@type":"Recipe","image":"https://x.com/a.jpg"}'], page),
    ).toBe("https://x.com/a.jpg");
    expect(
      jsonLdImage(['{"@type":"Recipe","image":["https://x.com/b.jpg"]}'], page),
    ).toBe("https://x.com/b.jpg");
    expect(
      jsonLdImage(
        [
          '{"@type":"Recipe","image":{"@type":"ImageObject","url":"https:\\/\\/x.com\\/c.jpg"}}',
        ],
        page,
      ),
    ).toBe("https://x.com/c.jpg");
    expect(
      jsonLdImage(
        ['{"@type":"Organization","image":"https://x.com/logo.png"}'],
        page,
      ),
    ).toBeNull();
  });
});
