// 同じレシピの出典か見分けるための鍵（二重の取り込みを知らせる）。
// YouTube は動画の ID、ページは表記の揺れ（http/https・www・末尾の /・#・追跡用の値）をそろえた URL
import { parseVideoUrl } from "./importer";

const TRACKING = /^utm_|^(?:fbclid|gclid|yclid|ref|ref_src|from|feature)$/i;

export function sourceKey(raw: string): string | null {
  if (!raw) return null;
  const video = parseVideoUrl(raw);
  if (video) return `yt:${video.id}`;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !TRACKING.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${new URLSearchParams(params)}` : "";
  const path = u.pathname.replace(/\/+$/, "") || "/";
  return `${host}${path}${query}`;
}
