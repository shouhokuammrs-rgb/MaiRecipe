# DEC-008: Cloudflare Workers 無料プラン + D1 で作り直す（Tandem と同じ構成）

- Status: Accepted
- Date: 2026-09-28
- 決めた人: Eiichi
- 関連: docs/spec.md §5・§6 / Tandem DEC-006 / docs/meetings/2026-09-28_design-review.md

## 背景
M0 は Next.js + Supabase + Vercel で作ったが、本番に出す前（Issue #1〜#5 が残った状態）で止まっていた。
並行して進めている Tandem を Cloudflare で作り始め、同じ構成に揃えたほうが作りやすく、学びも共有できると判断した。
M0 の中身はログインと DB 設計だけなので、作り直しのコストは小さい。

## 決定
- Workers 1つに画面（React + Vite の PWA）と API（Hono、`/api/*`）を載せる。DB は D1 + Drizzle
- **無料プラン・カード登録なし**で始める。1回の処理の CPU は 10ms まで。重い処理（画像の縮小など）は端末でやる
- 写真は当面 D1 に保存（1枚 1MB 以下に縮めてから）。R2 はカード登録が要るので一般公開時か容量が要る時に移す
- D1 には RLS が無いので、グループの判定をセッションからだけ行い、DB へのアクセスを `src/api/data/` の `forGroup` 1か所に集める。漏れはテスト（test/api の「グループをまたいだ漏れ」）で毎回確かめる
- API は画面から独立させる（将来スマホアプリにしても同じ API を使える）

## 検討した別案と、選ばなかった理由
- 案B: Supabase のまま M0 を仕上げる → RLS・ログインが揃っていて早いが、Tandem と構成がばらばらになり、無料枠（2プロジェクト）も取り合う
- 案C: 最初から有料プラン（月 $5）→ 「まず無料で」の方針に合わない。上限に当たったら検討する

## 影響
- 旧 Next.js / Supabase のコード（apps/web, supabase/）は削除した。Issue #1〜#5 は Supabase 前提なので閉じる
- 本番の準備は Eiichi の作業：Cloudflare アカウント、D1 作成、Google OAuth の鍵、デプロイ（README の手順）
- 一般公開を決めたら、サーバー構成（Cloudflare のままか）を見直す
