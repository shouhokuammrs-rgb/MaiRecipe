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
**テスト → 本番 D1 の用意（無ければ作る）→ マイグレーション → デプロイ → 秘密の値の登録 → 動作確認** まで自動で行う。
手で動かすときは GitHub の Actions タブ → deploy → Run workflow。

### 初回だけ Eiichi がやること（鍵は GitHub の Secrets にだけ置く。チャットやファイルには書かない）

GitHub のリポジトリ → Settings → Secrets and variables → Actions → New repository secret で、次の3つを登録する。

| 名前 | 中身 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare の API トークン（My Profile → API Tokens。権限は Workers Scripts:Edit と D1:Edit、対象はこのアカウントだけ） |
| `GOOGLE_CLIENT_ID` | Google Cloud Console の OAuth クライアント ID（ウェブアプリケーション） |
| `GOOGLE_CLIENT_SECRET` | 同じクライアントのシークレット |

Google の OAuth クライアントには次を設定する（`<サブドメイン>` は Actions のログの「本番 URL」に出る）。
- 承認済みの JavaScript 生成元: `https://mairecipe.<サブドメイン>.workers.dev`
- 承認済みのリダイレクト URI: `https://mairecipe.<サブドメイン>.workers.dev/api/auth/callback/google`

`BETTER_AUTH_SECRET` と `BETTER_AUTH_URL` はワークフローが自動で登録する。`DEV_LOGIN` は本番に**入れない**。

## Claude Code で作業する場合

`CLAUDE.md` は `eiichi-core` プラグイン（`pm` / `reviewer` エージェントと `eiichi-rules` スキル）が
導入されている前提で書かれている。`vercel-react-best-practices` と `web-design-guidelines` はリポジトリ同梱（`.agents/skills/`）。
