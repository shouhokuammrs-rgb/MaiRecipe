# MaiRecipe — Claude Code 共通設定（Cloudflare Workers 無料プラン + D1）

## まず読むもの
- `eiichi-rules` スキル（eiichi-core プラグイン）— 人間への伝え方はすべてこれに従う
- `docs/spec.md` — 仕様の正
- `docs/decisions/` — 過去の決定。覆すなら新しい ADR（DEC-008〜013 が今の構成と方針）
- セッション開始時は `pm` サブエージェントに 3 点報告させる

## プロダクト
- 見つけたレシピを取り込み、自分好みに改良して、献立と買い物までつなげる PWA
- 基本の流れ：探して取り込む → 改良する（版を積む）→ 献立 → 買い物（DEC-010）
- 自分と一緒に使う人が使いたい機能は足してよい。将来はレシピ SNS。今は SNS を作らない
- **AI が無くても全部使えること**。AI は押した時だけ・既定オフ・答えは出典あり / なしを分ける（DEC-012）
- 取り込みは材料と手順だけ。元の文章・写真はコピーしない。出典は消せない（DEC-011）
- 迷ったらシンプルな方を選ぶ

## 技術スタック（DEC-008）
- Cloudflare Workers **無料プラン**1つ。`/api/*` は Hono、それ以外は Workers Static Assets で PWA を配信
- 画面: React 19 + Vite（`@cloudflare/vite-plugin`）+ React Router + TanStack Query + Tailwind v4 + `vite-plugin-pwa`
- DB: D1 + Drizzle ORM。写真も当面 D1（`recipe_images`、1枚 1MB 以下）
- 認証: Better Auth の Google ログインのみ（DEC-009）。`DEV_LOGIN=1` のときだけローカル用のメールログイン
- 入力検証: zod（`src/shared/recipe.ts` を API と画面で共有）
- テスト: Vitest（`test/shared` は Node、`test/api` は `@cloudflare/vitest-pool-workers` でローカル D1）、Playwright（`e2e/`）

## コマンド（リポジトリ直下で実行）
| 目的 | コマンド |
|---|---|
| 開発サーバー（画面 + API + ローカル D1） | `npm run dev`（先に `.dev.vars` を作る。README） |
| ビルド | `npm run build` |
| 型チェック | `npm run typecheck` |
| Lint + フォーマット確認 | `npm run lint`（直すのは `npm run format`） |
| ユニット・API テスト | `npm run test` |
| E2E | `npm run e2e` |
| マイグレーション生成 | `npm run db:generate` |
| ローカル D1 に適用 | `npm run db:migrate:local` |
| 本番 D1 に適用 | `npm run db:migrate:remote`（Eiichi の確認後のみ） |
| Workers の型生成 | `npm run cf-typegen` |
| デプロイ | `npm run deploy`（Eiichi の確認後のみ） |

PR 前は最低限 `npm run lint && npm run typecheck && npm run test` を通す。

## ディレクトリ
```
src/web/          画面。API は src/web/api/client.ts 経由でだけ呼ぶ
  pages/          画面ごと（Recipes / RecipeDetail / RecipeEdit / Import / Find / Plan / Shopping / Settings / Login）
  components/     共通部品（RecipeEditor・MicButton・VideoEmbed など）
src/api/          API（Hono）。src/web を import しない
  routes/         エンドポイント。DB を直接触らない（ESLint で禁止）
  data/           forGroup(db, groupId) — DB に触れる唯一の場所。schema.ts もここ
  auth/           Better Auth の設定と、セッション → グループの解決（requireUser）
  platform/       Cloudflare 専用の部品（取り込みのページ取得・HTMLRewriter）
src/shared/       画面と API で共有する純粋な関数・定数・zod（Cloudflare に依存しない）
drizzle/          マイグレーション SQL
test/shared, test/api, e2e/
docs/             spec / decisions / meetings / archive
```

## 開発ルール（Superpowers に加えて）
- feature ブランチ + PR のみ。main 直 push・force push 禁止。**マージは Eiichi**
- TDD: `src/shared/` / `src/api/` / マイグレーション / バグ修正は必須。画面の見た目は例外
- **グループの判定はセッションからだけ**。クライアントから来た group_id を使わない。DB は `forGroup` 経由でだけ触る。
  新しいテーブル・API を足したら `test/api` の「グループをまたいだ漏れがないこと」に項目を足す。これを崩す変更はレビューで Critical
  例外：招待への参加（グループをまたぐ）は `src/api/data/membership.ts` だけで行う。宛先は確認済みのメールだけで決める
- UI ガイダンスの優先順位: ①既存のトークン（`src/web/index.css` の @theme）→ ②`vercel-react-best-practices`（React 部分のみ）
  → ③`web-design-guidelines`（PR 前の a11y 監査）→ ④`frontend-design`（方向性を新しく決めるときだけ）
- モデル割り当ては eiichi-rules §10 に従う

## 無料プランの規約（DEC-008）
- Worker の1回の処理は CPU 10ms まで。**重い処理を API に置かない**：画像の縮小・パスワード処理・大きな HTML の正規表現処理はしない
- 写真は画面で長辺1600px・JPEG に縮めてから送る。API は受け取って保存するだけ
- 上限に当たったら黙って直さず、Eiichi に「有料プランにするか、処理を端末に移すか」を推奨つきで聞く

## 移行しやすさの規約
- Cloudflare 固有の API を触ってよいのは `src/api/platform/`・`src/api/data/`・`src/api/auth/` だけ
- SQL は普通の書き方にする。SQLite 独自関数を検索条件・集計に使わない
- 画面は API を HTTP で呼ぶだけ

## UI 規約
- 日本語 UI。文言はハードコードでよい
- スマホ縦 375px 基準。タップ領域 44px 以上。画面には必ず ローディング / エラー / 空状態
- 確認ダイアログ（confirm）は使わない。消す操作は「消す → 本当に消す？」の2回押し
- 色・文字はトークン（paper / ink / sub / accent / herb / memo …）を使う

## Eiichi 本人にしかできない作業（依頼の型は eiichi-rules §4）
- Cloudflare アカウント（無料・カード登録なし）と `wrangler login`、本番 D1 の作成
- Google Cloud での OAuth クライアント作成と `wrangler secret put`
- 本番 D1 へのマイグレーション適用とデプロイの最終 OK（Claude はローカルで検証してから、コピペできる手順で渡す）
- PR のマージ

## 秘密情報
ローカルは `.dev.vars`（コミットしない。ひな形は `.dev.vars.example`）、本番は `wrangler secret put`。
```
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
YOUTUBE_API_KEY=     # 任意。Eiichi 個人のキー（DEC-014）。使うのは src/api/platform/ だけ
DEV_LOGIN=1   # ローカルだけ。本番には絶対に入れない
```

## 課題管理
- タスク・バグ・要望 → **GitHub Issues**（ラベル: bug / feedback / idea / workflow / needs-eiichi / ready-for-agent）
- フェーズ → **GitHub Milestones**（M0 基盤 / M1 レシピ管理 / M2 取り込みと検索 / M3 献立と買い物 / M4 AI オプション / M5 共有と課金）
- md の WBS は持たない。会議 → `docs/meetings/`、意思決定 → `docs/decisions/`

## 前提
`eiichi-core`（`pm` / `reviewer` / `eiichi-rules`）、`superpowers`、`frontend-design` のプラグインが導入されていること。
`vercel-react-best-practices` と `web-design-guidelines` はリポジトリ同梱（`.agents/skills/`）。
reviewer の観点に Supabase 前提の部分があるので、MaiRecipe では RLS の代わりに「forGroup 経由・セッションからの判定・漏れのテスト」の3点を確認させる。
