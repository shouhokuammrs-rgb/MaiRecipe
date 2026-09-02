import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "@/lib/supabase/database.types";
import { getSupabaseEnv } from "@/lib/supabase/env";

/**
 * サーバー（Server Component / Server Action / Route Handler）用 Supabase クライアント。
 * リクエストごとに生成すること（グローバルに使い回さない）。
 */
export async function createClient() {
  // cookies() を先に呼ぶことでルートを動的レンダリング扱いにする（env 未設定時のビルド失敗を防ぐ）
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabaseEnv();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Component から呼ばれた場合は cookie を書けない。
          // セッション更新は middleware.ts 側で行われるので無視してよい。
        }
      },
    },
  });
}
