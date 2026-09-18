# MaiRecipe

レシピ保存・献立・買い物リストを一気通貫で管理する Web アプリ（レピッタの機能構成を踏襲）。

- アプリ本体: [`apps/web`](apps/web/README.md)（Next.js 15 / Supabase）— セットアップと Vercel デプロイ手順はこちら
- DB マイグレーション: `supabase/migrations`
- 仕様（唯一の真実）: [`docs/spec.md`](docs/spec.md)
- 意思決定の記録: [`docs/decisions/`](docs/decisions/README.md)
- タスク・バグ・要望: [GitHub Issues](https://github.com/shouhokuammrs-rgb/MaiRecipe/issues) / フェーズは Milestones
- 移行前の旧ドキュメント（参照専用）: [`docs/archive/`](docs/archive/README.md)

## Claude Code で作業する場合

`CLAUDE.md` は `eiichi-core` プラグイン（`pm` / `reviewer` エージェントと `eiichi-rules` スキル）が
導入されている前提で書かれている。未導入だと CLAUDE.md の指示の一部が機能しない。
`vercel-react-best-practices` と `web-design-guidelines` はリポジトリに同梱済み（`.agents/skills/`）。
