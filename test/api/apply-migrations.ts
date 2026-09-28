import { applyD1Migrations, env } from "cloudflare:test";

// テストの D1 にマイグレーションを適用してから各テストを実行する。
// migrations は vitest.workers.config.ts が `TEST_MIGRATIONS` バインディングとして注入する。
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
