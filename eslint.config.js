import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

const DB_MSG =
  "DB（drizzle・スキーマ・env.DB）に触れるのは src/api/data/ の forCouple 経由だけです（db-schema.md §4）。";
const DB_PATHS = [{ name: "drizzle-orm", message: DB_MSG }];
const DB_BAN = {
  group: [
    "drizzle-orm/*",
    "**/data/schema",
    "**/data/schema.*",
    "**/data/schema/*",
  ],
  message: DB_MSG,
};
const WEB_BAN = {
  group: ["src/web", "src/web/*", "**/web", "**/web/*", "@/*"],
  message:
    "src/api は src/web を import できません（画面と API を分離する。CLAUDE.md）。",
};
const CF_BAN = {
  group: ["cloudflare:*"],
  message:
    "Cloudflare 固有の API は src/api/platform/ と src/api/data/ だけで使います（CLAUDE.md）。",
};
const ENV_DB_BAN = [
  { selector: "MemberExpression[property.name='DB']", message: DB_MSG },
  { selector: "ObjectPattern > Property[key.name='DB']", message: DB_MSG },
];

export default tseslint.config(
  {
    ignores: [
      "dist",
      "node_modules",
      ".wrangler",
      "drizzle",
      "worker-configuration.d.ts",
      "playwright-report",
      "test-results",
      ".claude",
      "apps",
      ".superpowers",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // API（src/api/**）: db-schema.md §4「1か所を通す」を lint で強制する。
  // DB（drizzle・スキーマ・env.DB）に触ってよいのは src/api/data/ と、Better Auth のアダプタが要る src/api/auth/ だけ。
  // Cloudflare 固有の API（cloudflare:*）は src/api/platform/ と src/api/data/ だけ（CLAUDE.md 移行しやすさの規約）。
  {
    files: ["src/api/**/*.{ts,tsx}"],
    ignores: ["src/api/data/**", "src/api/auth/**", "src/api/platform/**"],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: DB_PATHS, patterns: [WEB_BAN, DB_BAN, CF_BAN] },
      ],
      "no-restricted-syntax": ["error", ...ENV_DB_BAN],
    },
  },
  // platform: Cloudflare 固有 API は可。DB のスキーマ・drizzle は data/ に任せる
  {
    files: ["src/api/platform/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: DB_PATHS, patterns: [WEB_BAN, DB_BAN] },
      ],
    },
  },
  // data / auth: DB に触れてよい唯一の場所。web の import だけ禁止
  {
    files: ["src/api/data/**/*.{ts,tsx}", "src/api/auth/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "no-restricted-imports": ["error", { patterns: [WEB_BAN] }],
    },
  },

  // shared（src/shared/**）: Cloudflare・Hono・Drizzle・api/web への依存禁止
  {
    files: ["src/shared/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "hono",
              message: "src/shared は Cloudflare に依存できません。",
            },
            {
              name: "drizzle-orm",
              message: "src/shared は Cloudflare に依存できません。",
            },
          ],
          patterns: [
            {
              group: [
                "cloudflare:*",
                "drizzle-orm/*",
                "src/api/*",
                "src/api",
                "src/web/*",
                "src/web",
                "../api/*",
                "../../api/*",
                "../web/*",
                "../../web/*",
              ],
              message: "src/shared は Cloudflare・api・web に依存できません。",
            },
          ],
        },
      ],
    },
  },

  // 画面（src/web/**）: src/api への import 禁止（API は HTTP 経由でだけ呼ぶ）
  {
    files: ["src/web/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "src/api",
                "src/api/*",
                "**/src/api/*",
                "../api/*",
                "../../api/*",
              ],
              message:
                "src/web は src/api を直接 import できません。src/web/api/ の HTTP クライアント経由で呼んでください。",
            },
          ],
        },
      ],
    },
  },

  // テスト・設定ファイル: Node グローバルを許可
  {
    files: [
      "test/**/*.{ts,tsx}",
      "e2e/**/*.{ts,tsx}",
      "*.config.{ts,js}",
      "scripts/**/*.{ts,mjs,js}",
    ],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
