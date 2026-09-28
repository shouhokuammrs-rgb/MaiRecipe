import type { D1Migration } from "@cloudflare/vitest-pool-workers";

// `cloudflare:test` の `env`（型は `Cloudflare.Env`）にテスト専用のマイグレーション
// バインディングを足す。アプリ本体が使うグローバル `Env`（worker-configuration.d.ts）
// とは別の名前空間なので、本番コードの型には影響しない。
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
