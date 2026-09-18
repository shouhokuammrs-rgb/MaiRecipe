# 意思決定記録（ADR）

1 決定 = 1 ファイル。`DEC-XXX_<topic>.md`。番号は連番、既存の DEC 番号を引き継ぐ。
上書きしない。覆すときは新しい ADR を書き、古い方の Status を `Superseded by DEC-YYY` にする。

> **DEC-001〜006 について**: 2026-09-18 の体制移行（DEC-007）のとき、旧 SSOT の意思決定表を
> 1決定1ファイルに再構成したもの。決定内容と日付と決めた人は当時の記録どおりだが、
> 背景・別案・影響の各節は当時の文面ではなく、移行時に書き起こした。
> 原典は `docs/archive/pm/mairecipe_project_state.md` の §1。

## テンプレ

```markdown
# DEC-XXX: <タイトル：何を決めたか、一文で>

- Status: Accepted | Superseded by DEC-YYY
- Date: YYYY-MM-DD
- 決めた人: Eiichi | PM（Eiichi 承認済み）
- 関連: Issue #N / docs/spec.md §X / docs/meetings/YYYY-MM-DD_xxx.md

## 背景（なぜこの判断が必要になったか）
3〜5行。ユーザー視点で。

## 決定
何をするか。1〜3行。

## 検討した別案と、選ばなかった理由
- 案B: … → 理由
- 案C: … → 理由

## 影響
- ユーザーにはこう見える
- 開発・運用でこう変わる
- 将来こうなったら見直す
```
