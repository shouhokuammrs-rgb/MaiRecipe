/**
 * ルート保護の判定ロジック（middleware.ts から利用。ユニットテスト対象）
 */

/** 未ログインでもアクセスできるパス */
export const GUEST_ONLY_PATHS = ["/login", "/signup", "/reset-password"] as const;

/** ログイン済みユーザーがアクセスした場合に `/` へ戻すパス */
export function isGuestOnlyPath(pathname: string): boolean {
  return GUEST_ONLY_PATHS.some((p) => pathname === p);
}

/**
 * 未ログインでアクセス可能なパスか。
 * `/auth/*`（メール確認・パスワードリセットのコールバック）も含む。
 * `/update-password` はリカバリーセッションが必要なので保護対象。
 */
export function isPublicPath(pathname: string): boolean {
  if (isGuestOnlyPath(pathname)) return true;
  if (pathname === "/auth" || pathname.startsWith("/auth/")) return true;
  return false;
}

/**
 * `?next=` で受け取ったリダイレクト先を安全な相対パスに正規化する。
 * 外部URL（`//evil.com`, `https://...`）やプロトコル相対は `/` に落とす。
 */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\r\n]/.test(next)) return fallback;
  return next;
}
