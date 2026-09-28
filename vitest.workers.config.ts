import path from "node:path";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const migrationsPath = path.join(import.meta.dirname, "drizzle");
const migrations = await readD1Migrations(migrationsPath);

export default defineConfig({
  test: {
    name: "api",
    include: ["test/api/**/*.test.ts"],
    setupFiles: ["./test/api/apply-migrations.ts"],
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-000",
          BETTER_AUTH_URL: "http://localhost",
          DEV_LOGIN: "1",
          YOUTUBE_API_KEY: "test-youtube-key",
        },
      },
    }),
  ],
});
