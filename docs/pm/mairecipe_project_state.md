# MaiRecipe — Project State (Single Source of Truth)

最終更新: 2026-09-02 / PM

## 0. プロダクト概要
- **名称**: MaiRecipe
- **一言で**: Web/SNS/料理本/自作レシピを1フォーマットで保存し、献立→買い物リストまで回すWebアプリ
- **方針**: レピッタ（repitta.com）を参考にした模倣。差別化は狙わない（学習目的）
- **Owner**: Eiichi（重要判断のみ）
- **PM**: Claude（コードは書かない）
- **スタック**: Next.js (App Router) + TypeScript + Tailwind / Supabase (Auth, Postgres, Storage, Edge Functions) / Claude API / Stripe / Vercel

## 1. 意思決定記録
| DEC# | 内容 | 決めた人 | 日付 |
|------|------|---------|------|
| DEC-001 | Webアプリとして開発（モバイルネイティブは作らない） | Eiichi | 2026-09-02 |
| DEC-002 | 差別化しない。レピッタの機能構成をそのまま踏襲 | Eiichi | 2026-09-02 |
| DEC-003 | 認証はメール+パスワードのみ。Google等のOAuthは不要 | Eiichi | 2026-09-02 |
| DEC-004 | データはクラウド保存、複数デバイスからログインすれば同じデータが見える（Supabase Postgresで自然に達成） | Eiichi | 2026-09-02 |
| DEC-005 | チーム運用はNudiと同じGitドキュメントベース。PM⇄Engineer⇄Designerの仲介はPM | PM | 2026-09-02 |
| DEC-006 | 課金はStripe（Web前提のためRevenueCat不要）。MVPでは課金なし、機能フラグで後付け | PM | 2026-09-02 |

## 2. 機能スコープ（プラン別）
### 無料
- レシピCRUD（タイトル/材料/手順/写真/タグ/出典URL/メモ）登録数無制限
- URL貼り付けでWebレシピ自動取り込み（AI抽出）
- 献立カレンダー（日付×朝昼晩にレシピ紐付け）
- 献立/レシピから買い物リスト自動生成（材料名寄せ・合算）
- クラウド同期（デバイス間共有）
### プレミアム
- レシピ名・材料名の検索
- 料理本の写真→レシピ化（Vision）
- パートナー1人と共同管理
- 食材入力→AIレシピ提案
- 登録レシピからAI献立提案
### プレミアムPro
- 共同管理を最大4人
- カテゴリ自動分類
- 1週間分の献立を一括AI提案

## 3. WBS
| ID | Phase | タスク | 担当 | 優先 | 状態 |
|----|-------|--------|------|------|------|
| M0-1 | M0 | Supabaseプロジェクト作成・URL/anon key発行 | Eiichi | 🔴 | 未着手 |
| M0-2 | M0 | Anthropic APIキー発行 | Eiichi | 🔴 | 未着手 |
| M0-3 | M0 | GitHubリポジトリ作成 | Eiichi | 🔴 | 未着手 |
| M0-4 | M0 | Next.jsプロジェクト初期化・Supabaseクライアント・環境変数 | Engineer | 🔴 | 未着手 |
| M0-5 | M0 | DBスキーマ v1 + RLS マイグレーション | Engineer | 🔴 | 未着手 |
| M0-6 | M0 | メール登録/ログイン/ログアウト/パスワードリセット | Engineer | 🔴 | 未着手 |
| M0-7 | M0 | Vercelデプロイ（Eiichiが連携、Engineerが設定） | Eiichi/Engineer | 🟡 | 未着手 |
| M1-1 | M1 | 画面設計（レシピ一覧/詳細/編集/献立/買い物） | Designer | 🟡 | 未着手 |
| M1-2 | M1 | レシピCRUD UI + Storage画像アップロード | Engineer | 🔴 | 未着手 |
| M1-3 | M1 | 材料マスタと名寄せロジック | Engineer | 🟡 | 未着手 |
| M2-1 | M2 | URL取り込みEdge Function（Claude構造化出力） | Engineer | 🔴 | 未着手 |
| M2-2 | M2 | レシピ検索（Postgres全文検索 + pg_trgm） | Engineer | 🟡 | 未着手 |
| M3-1 | M3 | 献立カレンダーUI + meal_plans | Engineer | 🔴 | 未着手 |
| M3-2 | M3 | 買い物リスト自動生成 | Engineer | 🔴 | 未着手 |
| M4-1 | M4 | 共有グループ・招待・RLS拡張 | Engineer | 🟡 | 未着手 |
| M5-1 | M5 | 写真OCR取り込み | Engineer | 🟡 | 未着手 |
| M5-2 | M5 | AIレシピ提案 / AI献立提案 | Engineer | 🟡 | 未着手 |
| M5-3 | M5 | Stripe課金 + プラン機能フラグ | Engineer | 🟢 | 未着手 |

## 4. オープン課題
| ISS# | 内容 | 優先 | 担当 | 状態 |
|------|------|------|------|------|
| ISS-001 | URL取り込み時の著作権/利用規約への配慮（本文丸コピーせず要約・構造化に留める方針で仮置き） | 🟡 | PM | Open |

## 5. Eiichi判断待ち
なし（M0はEiichi作業依頼のみ）
