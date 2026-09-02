# MaiRecipe — Web (apps/web)

Next.js 15 (App Router) / TypeScript strict / Tailwind CSS v4 / shadcn/ui / Supabase (`@supabase/ssr`)

## 1. ローカル開発のセットアップ

前提: Node.js 20 以上（推奨 22）、npm。

```bash
cd apps/web
cp .env.example .env.local   # 値を埋める（下記「環境変数」参照）
npm install
npm run dev                  # http://localhost:3000
```

### 環境変数（`apps/web/.env.local`）

| 変数名                          | 用途                                             | 公開範囲     |
| ------------------------------- | ------------------------------------------------ | ------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase Project URL                             | ブラウザ可   |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon (public) key                       | ブラウザ可   |
| `SUPABASE_SERVICE_ROLE_KEY`     | service_role key。E2E テストのユーザー作成に使用 | サーバーのみ |
| `ANTHROPIC_API_KEY`             | Claude API（M2 以降）                            | サーバーのみ |

Supabase ダッシュボード → Project Settings → API から取得できます。

## 2. Supabase 側の設定（初回のみ）

### 2-1. マイグレーション適用

リポジトリ直下で:

```bash
npx supabase login                       # ブラウザが開くので承認
npx supabase link --project-ref <ref>    # ref は Project URL の https://<ref>.supabase.co の部分
npx supabase db push                     # supabase/migrations/*.sql を適用
```

### 2-2. Auth の設定（ダッシュボード → Authentication）

- **Sign In / Providers → Email**: `Confirm email` を **ON**
- **URL Configuration**
  - Site URL: `http://localhost:3000`（Vercel デプロイ後は本番 URL に変更）
  - Redirect URLs に追加: `http://localhost:3000/**`、`https://<vercelのドメイン>/**`
- **Email Templates**（推奨・任意）: リンクを別ブラウザで開いても動くように、
  `Confirm signup` / `Reset password` の本文リンクを次に置き換える
  - Confirm signup: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/`
  - Reset password: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/update-password`
  - 置き換えない場合は既定の `{{ .ConfirmationURL }}` でも動作する（同じブラウザで開く必要あり）

### 2-3. 型の再生成（スキーマ変更時）

```bash
npx supabase gen types typescript --linked --schema public > apps/web/lib/supabase/database.types.ts
```

## 3. コマンド

```bash
npm run dev         # 開発サーバー
npm run build       # 本番ビルド
npm run lint        # ESLint + Prettier チェック
npm run format      # Prettier で整形
npm run typecheck   # tsc --noEmit
npm run test        # Vitest（ユニット）
npm run e2e         # Playwright（E2E）。.env.local の Supabase プロジェクトに接続する
```

E2E の初回は `npx playwright install chromium` でブラウザを入れてください。
E2E はテスト用ユーザー（`@e2e.mairecipe.test`）を service_role key で作成し、終了時に削除します。

## 4. Vercel へのデプロイ（Eiichi 向け手順）

1. https://vercel.com にログイン → **Add New… → Project**
2. GitHub の `MaiRecipe` リポジトリを **Import**
3. **Root Directory** で `apps/web` を選ぶ（Edit → `apps/web` を選択）
   - Framework Preset は自動で **Next.js** になる。Build/Output はデフォルトのまま
4. **Environment Variables** に以下を追加（`.env.local` と同じ値）
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ANTHROPIC_API_KEY`
5. **Deploy** を押す
6. デプロイ後に表示される URL（例: `https://mairecipe.vercel.app`）を
   Supabase → Authentication → URL Configuration の **Site URL** と **Redirect URLs**（`/**` 付き）に追加

以降は `main` に push するたびに自動デプロイされます。`vercel.json` は不要です。

## 5. ディレクトリ

```
app/
  (auth)/         ログイン / 新規登録 / パスワード再設定 / 新パスワード設定
  (app)/          ログイン後の画面（レシピ一覧・プロフィール設定）
  auth/confirm/   メール内リンクの着地点（セッション確立）
components/
  ui/             shadcn/ui
  auth/ layout/ recipes/ settings/
lib/
  supabase/       client.ts / server.ts / middleware.ts / database.types.ts
  auth/           ルート保護・バリデーション
e2e/              Playwright
middleware.ts     未ログイン時の /login リダイレクト
```
