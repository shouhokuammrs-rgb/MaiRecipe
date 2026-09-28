# DEC-009: ログインは Google のみにする

- Status: Accepted
- Date: 2026-09-28
- 決めた人: Eiichi
- 関連: DEC-003（この決定により Superseded）/ DEC-008

## 背景
Workers 無料プランは1回の処理の CPU が 10ms までで、パスワードのハッシュ計算が上限に当たる（Tandem でも同じ判断）。
将来 SNS にするなら、Google で登録できたほうが始めてもらいやすい。

## 決定
- Better Auth の Google ログインだけを使う
- ローカル開発とテストのためだけに、`DEV_LOGIN=1` のときメール + パスワードを出す。本番の設定には入れない

## 検討した別案と、選ばなかった理由
- メール + パスワードのまま → 無料プランで動く方式の検証が要る。今は優先しない
- 両方 → パスワード側に同じ問題が残る

## 影響
- 使う人は Google アカウントが要る
- Eiichi が Google Cloud で OAuth クライアント（無料）を作り、`wrangler secret put` で登録する
