// 動画の場面（手順ごとに、動画のどこから始まるか）。料理モードから、その場面を再生する。
import { z } from "zod";
import { LIMITS } from "./constants";

/** 動画の長さの上限（秒）。これを超える時刻は読み違いとみなす */
const SCENE_MAX = 6 * 60 * 60;

/** 手順ごとの開始の秒。分からない手順は null。手順が無ければ空の配列 */
export const stepTimesSchema = z
  .array(z.number().int().min(0).max(SCENE_MAX).nullable())
  .max(LIMITS.stepsMax);

/** "1:23" "01:02:03" "1分23秒" 83 を秒にする。読めなければ null */
export function parseSceneTime(raw: unknown): number | null {
  let n: number | null = null;
  if (typeof raw === "number")
    n = Number.isFinite(raw) ? Math.floor(raw) : null;
  else if (typeof raw === "string") {
    const s = raw.normalize("NFKC").trim();
    let m = s.match(/^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})$/);
    if (m) {
      const sec = Number(m[3]);
      if (sec >= 60 || (m[1] !== undefined && Number(m[2]) >= 60)) return null;
      n = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + sec;
    } else if ((m = s.match(/^(?:(\d{1,3})分)?(?:(\d{1,5})秒)?$/)) && s)
      n = Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
    else if (/^\d{1,5}$/.test(s)) n = Number(s);
  }
  if (n === null || !Number.isInteger(n) || n < 0 || n > SCENE_MAX) return null;
  return n;
}

/** 時刻が1つも無ければ空の配列にそろえる（保存の形） */
export function tidyStepTimes(times: (number | null)[]): (number | null)[] {
  return times.some((t) => t !== null) ? times : [];
}

/** 手順の数と合わない時刻は使わない（並びがずれた時刻で別の場面に飛ばないように） */
export function fitStepTimes(
  times: (number | null)[] | undefined,
  stepCount: number,
): (number | null)[] {
  if (!times || times.length !== stepCount) return [];
  return tidyStepTimes(times);
}
