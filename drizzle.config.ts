import { defineConfig } from "drizzle-kit";

// マイグレーションの生成だけをここで行う（`npm run db:generate`）。
// 適用は Drizzle Kit ではなく `wrangler d1 migrations apply`（db:migrate:local /
// db:migrate:remote）で行うため、DB 接続情報（driver/credentials）はここに置かない。
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/api/data/schema.ts",
  out: "./drizzle",
});
