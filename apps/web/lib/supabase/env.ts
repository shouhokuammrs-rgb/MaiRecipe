/**
 * Supabase 接続情報。NEXT_PUBLIC_ 変数は Next.js がビルド時にインライン展開するため、
 * `process.env.NEXT_PUBLIC_...` をリテラルで参照する必要がある。
 */
export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が設定されていません。apps/web/.env.local を確認してください。",
    );
  }

  return { url, anonKey };
}
