# 同梱スキルの出典

`.agents/skills/` 配下は外部リポジトリから取り込んだもの。手で編集しない。
更新するときは `npx skills add` で取り直し、`skills-lock.json` の差分を確認する。

| スキル | 出典 | 宣言ライセンス |
|---|---|---|
| `vercel-react-best-practices` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) `skills/react-best-practices` | MIT（各 SKILL.md の frontmatter で宣言） |
| `web-design-guidelines` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) `skills/web-design-guidelines` | MIT（同上） |

取り込み日: 2026-09-18。`skills-lock.json` の `computedHash` は取得後の中身の検証用で、
出典側のコミットは記録されない。同じ版に戻したいときは上の取り込み日を手がかりにする。

**注意**: 出典リポジトリには 2026-09-18 時点で LICENSE ファイルが置かれていない。
MIT はライセンス本文の同梱を条件とするため、本来はここに本文を置くべきだが、
原典が存在しないため出典の記録にとどめている。
このリポジトリを公開する前に、出典側の LICENSE 整備状況を確認すること。
