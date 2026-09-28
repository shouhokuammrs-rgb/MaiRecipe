# MaiRecipe

見つけたレシピを取り込み、自分好みに改良して、献立と買い物までつなげる Web アプリ（PWA）。
Cloudflare Workers 無料プラン + D1 で動く（カード登録なし・月0円）。

- 仕様（唯一の真実）: [`docs/spec.md`](docs/spec.md)
- 意思決定の記録: [`docs/decisions/`](docs/decisions/README.md)
- タスク・バグ・要望: [GitHub Issues](https://github.com/shouhokuammrs-rgb/MaiRecipe/issues) / フェーズは Milestones
- 移行前の旧ドキュメント（参照専用）: [`docs/archive/`](docs/archive/README.md)

## 手元で動かす

```bash
nvm use 22
npm install
cp .dev.vars.example .dev.vars     # ローカル用の設定。DEV_LOGIN=1 で Google なしでログインできる
npm run db:migrate:local           # ローカルの D1 にテーブルを作る
npm run dev                        # http://localhost:5173
```

ログイン画面の「ローカル開発用のログイン」に、好きなメールアドレスと8文字以上のパスワードを入れると入れます。

```bash
npm run lint && npm run typecheck && npm run test   # PR 前に通す
npm run e2e                                          # 画面の通しテスト（dev サーバーを自動で起動）
```

## 本番に公開する（Eiichi の作業・初回だけ）

1. **Cloudflare にログイン**（無料アカウント。カード登録は不要）
   ```bash
   npx wrangler login
   ```
2. **本番の D1 を作る**。表示された `database_id` を `wrangler.jsonc` の `REPLACE_WITH_REAL_D1_DATABASE_ID` に貼る
   ```bash
   npx wrangler d1 create mairecipe
   ```
3. **一度デプロイして URL を知る**（`https://mairecipe.<アカウント名>.workers.dev` のような URL が出る）
   ```bash
   npm run db:migrate:remote
   npm run deploy
   ```
4. **Google ログインの鍵を作る**（Google Cloud Console → API とサービス → 認証情報 → OAuth クライアント ID → ウェブアプリケーション）
   - 承認済みの JavaScript 生成元: `https://mairecipe.<アカウント名>.workers.dev`
   - 承認済みのリダイレクト URI: `https://mairecipe.<アカウント名>.workers.dev/api/auth/callback/google`
5. **秘密の値を登録**（1つずつ聞かれるので貼る）
   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put BETTER_AUTH_URL        # 手順3の URL（末尾の / なし）
   npx wrangler secret put BETTER_AUTH_SECRET     # openssl rand -base64 32 の出力
   ```
   `DEV_LOGIN` は本番に**入れない**。
   YouTube の概要欄から材料と作り方を読みたいときだけ、YouTube Data API v3 のキーも入れる（無ければ動画は題名だけ。DEC-014）
   ```bash
   npx wrangler secret put YOUTUBE_API_KEY
   ```
6. **もう一度デプロイ**して、スマホで URL を開き Google でログイン → 共有メニューから「ホーム画面に追加」
   ```bash
   npm run deploy
   ```

2回目以降は `npm run db:migrate:remote`（マイグレーションが増えたときだけ）と `npm run deploy` だけ。
マイグレーションの前には、本番 D1 のバックアップを取る（`npx wrangler d1 export mairecipe --remote --output=backup-<日付>.sql`。このファイルはコミットしない）。マイグレーションとデプロイの間は空けない。

## Claude Code で作業する場合

`CLAUDE.md` は `eiichi-core` プラグイン（`pm` / `reviewer` エージェントと `eiichi-rules` スキル）が
導入されている前提で書かれている。`vercel-react-best-practices` と `web-design-guidelines` はリポジトリ同梱（`.agents/skills/`）。
