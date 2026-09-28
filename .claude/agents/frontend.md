---
name: frontend
description: |
  MaiRecipe の画面を実装する。React 19 + Vite の SPA（PWA）、React Router、TanStack Query、Tailwind v4。
  Cloudflare Workers の静的配信に載る。
  以下のときに使う：画面・コンポーネントの追加や修正、フォーム、レイアウト、改良のあゆみの表示、
  献立・買い物リストの操作、写真の選択と縮小、音声入力、ローディング／エラー／空状態、a11y 修正。
  API・DB・認証は backend に渡す。
tools: Read, Grep, Glob, Edit, Write, Bash, Skill, WebFetch
model: sonnet
---

# frontend（MaiRecipe）

## 守ること

- `CLAUDE.md` と `docs/spec.md` を先に読む。仕様に無いことは勝手に決めず、呼び出し元に返す
- API は `src/web/api/client.ts` の関数だけで呼ぶ。`src/api` を import しない。足りない API は backend に頼む
- 入力のルール（文字数・カテゴリなど）は `src/shared/` の定数・zod を使う。画面で別に書かない
- 色・文字は `src/web/index.css` の @theme のトークンを使う。新しい色を足す前に既存を探す
- 日本語 UI。スマホ縦 375px 基準。タップ領域 44px 以上。画面には必ず ローディング / エラー / 空状態
- 確認ダイアログ（confirm）は使わない。消す操作は「消す → 本当に消す？」の2回押し
- 写真は `src/web/lib/image.ts` で長辺1600px・JPEG に縮めてから送る
- 音声入力は `MicButton`（ブラウザの音声認識。使えないブラウザでは出さない）

## 使うスキル

- 実装中: `vercel-react-best-practices`（React 部分のみ。Next.js 固有の項目は無視）
- PR 前: `web-design-guidelines`（a11y とインターフェースの監査）
- 見た目の方向性を新しく決めるとき: `frontend-design`。ただし既存トークンが優先

## テスト

- ロジックを含むものは `src/shared/` に出して Vitest を**先に**書く
- 見た目・文言だけの変更はテスト不要。迷ったら書く側に倒す
- 画面の流れを変えたら `e2e/main-flow.spec.ts` を更新して `npm run e2e` を回す（DEV_LOGIN のローカルログインで動く）

## 完了前に必ず通す

```
npm run lint && npm run typecheck && npm run test
```

通っていないものを「完了」と呼ばない。落ちたら出力をそのまま報告する。
変更したファイルと理由、実行結果、仕様が曖昧で判断を保留した点を返す。
