# MaiRecipe — CLAUDE.md

## プロダクト
レシピ保存・献立・買い物リストを一気通貫で管理するWebアプリ。レピッタ（repitta.com）の機能構成を踏襲。
詳細は `docs/pm/mairecipe_project_state.md`（SSOT）を参照。

## 役割分担
- **PM**: Claude（Web版Claude.ai）。指示書は `docs/engineering/instructions/`
- **Engineer**: Claude Code（あなた）。完了報告は `docs/engineering/handoffs/YYYY-MM-DD_<topic>.md`
- **Designer**: Web版Claude.ai。仕様は `docs/design/specs/`
- **Eiichi**: 意思決定のみ。Eiichiに技術的な作業を頼まない（アカウント作成・キー発行を除く）

## 作業ルール
1. 作業開始時に `docs/engineering/instructions/` の最新未対応ファイルを読む
2. 指示書の「受け入れ条件」を全て満たしてから handoff を書く
3. 指示書にない仕様判断が必要なら、勝手に決めず handoff の「PM確認事項」に書く
4. 完了時に `docs/pm/mairecipe_project_state.md` のWBS該当行を「完了」に更新してよい

## 技術スタック（固定）
- Next.js 15 (App Router) / TypeScript strict / Tailwind CSS / shadcn/ui
- Supabase: Auth（メール+パスワードのみ）, Postgres, Storage, Edge Functions (Deno)
- `@supabase/ssr` でサーバー/クライアント両対応。Server Actionsを基本とする
- AI: Anthropic SDK。呼び出しはEdge FunctionまたはRoute Handler経由のみ。クライアントにAPIキーを置かない
- 決済: Stripe（M5まで実装しない）
- テスト: Vitest（ユニット）, Playwright（E2E）
- Lint/Format: ESLint + Prettier

## ディレクトリ
```
apps/web/              Next.jsアプリ
  app/                 ルート（(auth)/ (app)/ でグループ化）
  components/          UIコンポーネント
  lib/supabase/        client.ts / server.ts / middleware.ts
  lib/ai/              プロンプトとスキーマ
supabase/
  migrations/          SQLマイグレーション（timestamp_name.sql）
  functions/           Edge Functions
docs/                  PM/Engineer/Designer共有ドキュメント
```

## コーディング規約
- DBアクセスは必ずRLS前提。service_role keyはEdge Function内のみ
- 全テーブルに `created_at`, `updated_at`（トリガー更新）
- IDはuuid。ユーザー所有物は `owner_id` ではなく `group_id` で持つ（将来の共有対応のため。個人利用時は1人グループ）
- 型は `supabase gen types typescript` で生成し `lib/supabase/database.types.ts` に置く
- 日本語UI。文言はハードコードでよい（i18n不要）
- レスポンシブ必須（スマホ縦・PC）。PWA対応はM3以降に検討

## 環境変数（apps/web/.env.local）
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=   # サーバーのみ
ANTHROPIC_API_KEY=            # サーバーのみ
```

## やらないこと
- OAuthログイン（Google等）
- ネイティブアプリ
- 差別化機能の提案（模倣が目的）
