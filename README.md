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

## 本番に公開する（GitHub Actions で自動）

`main` にマージされると `.github/workflows/deploy.yml` が
**チェック → （マイグレーションがあれば）バックアップと件数確認 → 本番 D1 に適用 → デプロイ → 動作確認** まで自動で行う。
件数が減ったらそこで止まる。バックアップは Actions の artifact に 30 日残る。手で動かすときは Actions タブ → deploy → Run workflow。

### 初回だけ Eiichi がやること
Cloudflare の API トークンを作り、GitHub の Secrets に `CLOUDFLARE_API_TOKEN` として登録する（チャットやファイルには書かない）。

- Cloudflare：My Profile → API Tokens → Create Token →「Edit Cloudflare Workers」テンプレート
  - 権限に **D1:Edit** と **Workers AI:Read** を足す。対象は自分のアカウントだけ
- GitHub：Settings → Secrets and variables → Actions → New repository secret → 名前 `CLOUDFLARE_API_TOKEN`

Worker の秘密の値（`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` / `YOUTUBE_API_KEY`）は
`wrangler secret put` で登録済みのものをそのまま使う。`DEV_LOGIN` は本番に**入れない**。

## Claude Code で作業する場合

`CLAUDE.md` は `eiichi-core` プラグイン（`pm` / `reviewer` エージェントと `eiichi-rules` スキル）が
導入されている前提で書かれている。`vercel-react-best-practices` と `web-design-guidelines` はリポジトリ同梱（`.agents/skills/`）。
