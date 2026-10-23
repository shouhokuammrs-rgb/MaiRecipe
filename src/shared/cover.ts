// レシピの表紙。自分で入れた写真が無いときは、出典の画像を出す（DEC-023）。
// 出典の画像はこちらに保存しない（DEC-011：元の写真はコピーしない）。元のサイト・YouTube にある画像を、
// リンクプレビューと同じように、その場所から表示するだけ。URL だけを覚える
import { LIMITS } from "./constants";
import { parseVideoUrl } from "./importer";

/** ページの共有用の画像（og:image）を、https の絶対 URL にする。使えなければ null */
export function cleanImageUrl(raw: string, pageUrl: string): string | null {
  const s = raw.trim();
  if (!s || s.startsWith("data:")) return null;
  let u: URL;
  try {
    u = new URL(s, pageUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const href = u.href;
  return href.length <= LIMITS.urlMax ? href : null;
}

/** YouTube の動画・Shorts のサムネイル（YouTube にある画像をそのまま表示する） */
export function youtubeThumb(
  videoUrl: string | null | undefined,
): string | null {
  const v = videoUrl ? parseVideoUrl(videoUrl) : null;
  return v ? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg` : null;
}

export type Cover =
  { kind: "own" } | { kind: "source"; url: string } | { kind: "none" };

/**
 * どの表紙を出すか：自分の写真 → 出典の画像 → 動画のサムネイル → なし。
 * coverUrl の "" は「探したが無かった」の印
 */
export function pickCover(r: {
  hasImage: boolean;
  coverUrl: string | null;
  videoUrl: string | null;
}): Cover {
  if (r.hasImage) return { kind: "own" };
  if (r.coverUrl) return { kind: "source", url: r.coverUrl };
  const thumb = youtubeThumb(r.videoUrl);
  return thumb ? { kind: "source", url: thumb } : { kind: "none" };
}

/** 出典の画像を出しているときの、小さな出典の表示（どこの画像か分かるように） */
export function coverCredit(r: {
  hasImage: boolean;
  coverUrl: string | null;
  videoUrl: string | null;
  sourceUrl: string | null;
}): string | null {
  if (pickCover(r).kind !== "source") return null;
  if (!r.coverUrl && r.videoUrl) return "YouTube";
  try {
    return new URL(r.sourceUrl ?? r.coverUrl ?? "").hostname.replace(
      /^www\./,
      "",
    );
  } catch {
    return null;
  }
}
