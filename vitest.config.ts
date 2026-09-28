import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["./vitest.shared.config.ts", "./vitest.workers.config.ts"],
  },
});
