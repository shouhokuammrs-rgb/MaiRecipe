# DEC-007: 課題管理を GitHub Issues / Milestones に移し、eiichi-core の共通体制に揃える

- Status: Accepted
- Date: 2026-09-18
- 決めた人: Eiichi
- 関連: DEC-005（この決定により Superseded）

## 背景

進行表・指示書・完了報告をすべて Git 上の md で回していたが、
タスクの状態が表の中の文字列でしか分からず、他プロジェクトと運用がバラバラだった。
どれが最新の課題で、何が Eiichi の判断待ちなのかを毎回読み直す必要があった。

## 決定

Eiichi の全プロジェクト共通の体制（eiichi-core）に揃える。
タスク・バグ・要望は GitHub Issues、フェーズは GitHub Milestones で管理し、md の進行表は持たない。
仕様は `docs/spec.md`、決定は `docs/decisions/`、議事録は `docs/meetings/` に分ける。
プロジェクト専属の PM スキルは廃止し、共通の `pm` / `reviewer` エージェントを使う。

## 検討した別案と、選ばなかった理由

- 案B: 今の md ベースを続ける → プロジェクトごとに運用が違い、毎回思い出すコストがかかる
- 案C: 外部のタスク管理ツールを導入 → コードと課題が離れ、Git 以外に真実が増える

## 影響

- 「次に何をやるか」「Eiichi の判断待ち」は GitHub の Issue 一覧を見れば分かる
- 旧ドキュメント（進行表・指示書・完了報告・PM スキル）は `docs/archive/` に残す。参照専用で更新しない
- 新しい仕様判断は ADR、会議は議事録、それ以外の課題は Issue、と置き場が分かれる
