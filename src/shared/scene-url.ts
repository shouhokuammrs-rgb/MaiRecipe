// 動画の場面を再生する URL（importer に依存するので scenes.ts と分ける：循環を避ける）
import { parseVideoUrl } from "./importer";

/** YouTube の埋め込みを、その秒から再生する URL。YouTube でなければ null */
export function sceneUrl(videoUrl: string, seconds: number): string | null {
  const v = parseVideoUrl(videoUrl);
  if (!v) return null;
  return `${v.embedUrl}?rel=0&playsinline=1&start=${Math.max(0, Math.floor(seconds))}&autoplay=1`;
}
