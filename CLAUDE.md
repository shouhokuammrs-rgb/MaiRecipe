# MaiRecipe — Claude Code 共通設定（Next.js + Supabase）

## まず読むもの
- `eiichi-rules` スキル（eiichi-core プラグイン）— 人間への伝え方はすべてこれに従う
- `docs/spec.md` — 仕様の正
- `docs/decisions/` — 過去の決定。覆すなら新しい ADR
- セッション開始時は `pm` サブエージェントに 3 点報告させる

## プロダクト
- レシピ保存・献立・買い物リストを一気通貫で管理する Web アプリ
- レピッタ（repitta.com）の機能構成を踏襲。**差別化機能を提案しない**（模倣が目的）
- 目的は Eiichi の学習・制作。収益化は現時点の目標ではない
- 採用可否の第一基準は「レピッタにある機能か」。なければ優先度を下げる
- 迷ったらシンプルな方を選ぶ。学習目的なので過剰設計しない

## 技術スタック
- Next.js 15（App Router）+ React 19 + TypeScript strict
- Supabase（Auth / Postgres / Storage / Edge Functions）。認証は **メール + パスワードのみ**
- Tailwind CSS v4 + shadcn/ui
- AI: Anthropic SDK。呼び出しは Edge Function か Route Handler 経由のみ
- 決済: Stripe（M5 まで実装しない）
- Vercel にデプロイ（Root Directory = `apps/web`）
- テスト: Vitest（ロジック）+ Playwright（E2E）
- Lint/Format: ESLint + Prettier

## コマンド（リポジトリ直下で実行）
| 目的 | コマンド |
|---|---|
| 開発サーバー | `npm run dev` |
| ビルド | `npm run build` |
| 型チェック | `npm run typecheck` |
| Lint + フォーマット確認 | `npm run lint` |
| ユニットテスト | `npm run test` |
| E2E | `npm run e2e` |
| DB マイグレーション適用 | `npm run db:push` |
| DB リセット | `npm run db:reset` |
| Supabase 型生成 | `npm run db:types` |

PR 前は最低限 `npm run lint && npm run typecheck && npm run test` を通す。

## ディレクトリ
今あるもの:
```
apps/web/
  app/            App Router。(auth)/ と (app)/ でグループ化
  components/     UI。ui/ は shadcn/ui
  lib/supabase/   client.ts / server.ts / middleware.ts / database.types.ts
  lib/auth/       ルート判定とバリデーション
  e2e/            Playwright
supabase/migrations/   timestamp_name.sql
docs/             spec.md / decisions/ / meetings/ / archive/
.claude/agents/   frontend / backend
.agents/skills/   同梱スキル（vercel-react-best-practices / web-design-guidelines）
```

必要になったら作る場所（eiichi-rules §7）:
`apps/web/lib/ai/`（M2 以降）、`supabase/functions/`（M2 以降）、
`docs/materials/`（説明資料）、`docs/decisions-needed/`（Eiichi 判断待ちの資料）

## 開発ルール（Superpowers に加えて）
- feature ブランチ + PR のみ。main 直 push・force push 禁止。**マージは Eiichi**
- TDD: `lib/` / Server Actions / Route Handler / migration / バグ修正は必須。画面の見た目は例外
- Server Component を優先。Server Actions を基本とする。`@supabase/ssr` でサーバー/クライアント両対応
- Supabase はコンポーネントから直接呼ばず `lib/supabase/` 経由
- UI ガイダンスの優先順位: ①既存トークンと shadcn/ui の実物 → ②`vercel-react-best-practices`（実装作法）
  → ③`web-design-guidelines`（PR 前の a11y 監査）→ ④`frontend-design`（方向性を新しく決めるときだけ）
- モデル割り当ては eiichi-rules §10 に従う

## DB・セキュリティ規約
- DB アクセスは必ず RLS 前提。`service_role` key は Edge Function / サーバーのみ。クライアントに API キーを置かない
- ID は uuid。全テーブルに `created_at` / `updated_at`（トリガー更新）
- ユーザー所有物は `owner_id` ではなく `group_id` で持つ（将来の共有対応。個人利用時は 1 人グループ）
- 型は `npm run db:types` で生成する。手書きしない。生成に失敗したら既存ファイルは変更されない
- 個人データ・`.env.local` はコミットしない

## UI 規約
- 日本語 UI。文言はハードコードでよい（i18n 不要）
- レスポンシブ必須（スマホ縦・PC）。PWA 対応は M3 以降に検討
- 小さな UI は `frontend-design` スキルに従うが、既存トークン・shadcn/ui コンポーネントを優先する

## Eiichi 本人にしかできない作業（依頼の型は eiichi-rules §4）
- Supabase の本番適用（`db push` / ダッシュボード設定）。SQL は Claude がローカル検証してから渡す
- Vercel の環境変数・ドメイン設定
- 外部サービスのアカウント作成・キー発行
- PR のマージ

## 環境変数（`apps/web/.env.local`）
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=   # サーバーのみ
ANTHROPIC_API_KEY=            # サーバーのみ
```

## 課題管理
- タスク・バグ・要望・ユーザーの声 → **GitHub Issues**（ラベル: bug / feedback / idea / workflow / needs-eiichi / ready-for-agent）
- フェーズ・リリース → **GitHub Milestones**
- md の WBS は持たない。Notion 等にコピーを作らない
- 会議の議事録 → `docs/meetings/`、意思決定 → `docs/decisions/`

## やらないこと
- OAuth ログイン（Google 等）
- ネイティブアプリ
- 差別化機能の提案

## 前提
`eiichi-core` プラグイン（`pm` / `reviewer` エージェント、`eiichi-rules` スキル）が導入されていること。
未導入だとこのファイルの指示の一部が機能しない。モデル割り当てと Superpowers の tier 対応は
eiichi-rules §10 に従う（ここには複製しない）。
