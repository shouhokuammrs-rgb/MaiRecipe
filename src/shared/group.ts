// グループ（いっしょに使う人）の招待で、画面と API が共有するもの。
import { z } from "zod";

/** 自分を含めたメンバー数 + 招待中の数の上限（自分以外4人。M5 の課金まではこの値で固定） */
export const GROUP_MAX_MEMBERS = 5;

/** 招待・照合のときのメールアドレスの形（前後の空白を除いて小文字） */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export const inviteSchema = z.object({
  email: z.string().transform(normalizeEmail).pipe(z.string().email().max(254)),
});
