/* eslint-disable no-irregular-whitespace -- 実際のページ・概要欄にある全角スペースを再現するため */
// 取り込みテスト用のダミー。実在ページの本文はコミットしない（DEC-011）。
// 構造だけを真似て、料理名・材料・手順は架空のものにしている。

/**
 * ニップン型：JSON-LD に Recipe が無く、
 * 材料は h2「材料」の後の dl（dt=名前, dd=分量）、作り方は h3「作り方」の後の ol > li。
 * その後ろに別の見出し（ポイント）と、サイト共通の li（関連リンク）が続く。
 */
export const NIPPN_LIKE_HTML = `<!DOCTYPE html>
<html lang="ja"><head>
<meta charset="utf-8">
<title>ダミーきのこのスパゲッティ｜テスト食品</title>
<meta property="og:title" content="ダミーきのこのスパゲッティ｜テスト食品">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[]}</script>
</head><body>
<header class="l-header"><nav><ul><li><a href="/">ホーム</a></li><li><a href="/recipe/">材料から探す</a></li></ul></nav></header>
<main>
<h1 class="p-recipeTitle">ダミーきのこのスパゲッティ</h1>
<div class="recipeDetail__textArea">
  <h2 class="c-title__mark2"><span>材料<span class="volume">（2人分）</span></span></h2>
  <dl class="recipeDetail__info">
    <div class="recipeDetail__infoItem">
      <dt>スパゲッティ
</dt>
      <dd>200g</dd>
    </div>
    <div class="recipeDetail__infoItem">
      <dt>しめじ　</dt>
      <dd>1パック</dd>
    </div>
    <div class="recipeDetail__infoItem">
      <dt>塩・こしょう</dt>
      <dd>少々</dd>
    </div>
  </dl>
</div>
<div class="p-recipeMake">
  <h3 class="p-recipeMake__head"><span class="icon"></span><span class="text">作り方</span></h3>
  <ol class="p-recipeMake__list">
    <li class="p-recipeMake__item">しめじをほぐす。
    </li>
    <li class="p-recipeMake__item">スパゲッティを&amp;ゆでる。
    </li>
    <li class="p-recipeMake__item">①と②を炒め合わせ、<b>塩・こしょう</b>で味を調える。
    </li>
  </ol>
</div>
<div class="p-point">
  <h2 class="p-point__title"><span class="text">ポイント</span></h2>
  <div class="p-point__contents">この文章は出典の説明文なので取り込まない。</div>
</div>
</main>
<footer><ul><li><a href="/company/">会社情報</a></li><li><a href="/privacy/">プライバシー</a></li></ul></footer>
</body></html>`;

/** JSON-LD に Recipe があるが、JSON の中に // コメントが書かれていて JSON.parse できないサイト */
export const JSONLD_WITH_COMMENTS = `
  {
   "@context": "http://schema.org/",	//固定値
   "@type": "Recipe",	//固定値
   "name": "ダミーのクリームパスタ",
   "url": "https://example.com/a//b",
   "totalTime": "PT20M",	//全体の調理時間
   "recipeIngredient": [	//材料（1材料につき1行）
     "スパゲッティ　200g",
     "牛乳　300cc"
   ],
   /* 作り方 */
   "recipeInstructions": [ //作り方（1手順につき1行）
     "ゆでる。",
     "ソースと和える。"
   ]
}`;

/** YouTube 概要欄：【材料】【作り方】の区切りがあるもの */
export const DESCRIPTION_WITH_RECIPE = `今日はフライパンひとつでできる、ダミーの照り焼きチキンを作ります！
チャンネル登録よろしくお願いします🙌

【材料】2人分
・鶏もも肉　1枚（300g）
・片栗粉 大さじ1
＜タレ＞
・しょうゆ 大さじ2
・みりん　大さじ2

【作り方】
1. 鶏肉に片栗粉をまぶす。
2. フライパンで皮目から焼く。
ふたをして3分蒸し焼きにする。
3. タレを加えて煮からめる。

【ポイント】
焦げやすいので弱火で。

▼Instagram
https://www.instagram.com/example_cook/
#照り焼き #簡単レシピ`;

/** YouTube 概要欄：材料は無く、レシピページの URL が貼ってあるもの */
export const DESCRIPTION_WITH_LINKS = `ダミーのきのこパスタを作ってみました。
詳しいレシピはこちら👇
https://www.instagram.com/example_cook/
https://youtu.be/abcDEF12345
https://recipe.example.com/recipes/123?utm_source=youtube
https://recipe.example.com/recipes/123?utm_source=youtube
https://other.example.org/r/9
https://third.example.net/x
https://fourth.example.net/y

#パスタ`;

/**
 * 見出しの誤判定・読みすぎを確かめるページ。
 * - ヘッダーのメニューに class=gnav-title「材料から探す」と、その後の li
 * - li の中に class=step-head の番号
 * - 材料の途中に h4 の小見出し（タレ）
 * - 作り方の後に見出しの無いコツ欄とフッター
 */
export const TRICKY_HTML = `<!DOCTYPE html><html><head><title>ダミーの照り焼き | サイト</title></head><body>
<div class="gnav"><p class="gnav-title">材料から探す</p><ul><li>野菜</li><li>肉</li></ul></div>
<h1>ダミーの照り焼き</h1>
<h2>材料 <span>2人分</span></h2>
<ul class="ingredients">
  <li>鶏もも肉 1枚</li>
  <li>片栗粉 大さじ1</li>
</ul>
<h4>タレ</h4>
<ul class="ingredients">
  <li>しょうゆ 大さじ2</li>
</ul>
<h2>作り方</h2>
<ol>
  <li><span class="step-head">1</span><p>鶏肉に粉をまぶす。</p></li>
  <li><span class="step-head">2</span><p>2、3分焼く。</p></li>
</ol>
<div class="tips"><ul><li>コツの説明文は取り込まない。</li></ul></div>
<footer><ul><li>会社情報</li></ul></footer>
</body></html>`;

/** 表で材料が書かれたページ（見出し行 th は材料にしない）と、閉じタグを省いた li */
export const TABLE_HTML = `<!DOCTYPE html><html><head><title>ダミーの煮物</title></head><body>
<h2>材料（4人分）</h2>
<table><thead><tr><th>材料</th><th>分量</th></tr></thead>
<tbody><tr><td>大根</td><td>1/2本</td></tr><tr><th>だし</th><td>400ml</td></tr></tbody></table>
<h2>作り方</h2>
<ol><li>大根を切る。<li>だしで煮る。</ol>
<p>おわり</p>
</body></html>`;

/** 材料の見出しが無い商品ページ（原材料名）。概要欄のリンク先でありがち */
export const PRODUCT_HTML = `<!DOCTYPE html><html><head><title>ダミー商品</title></head><body>
<h2>原材料名</h2><table><tr><td>小麦粉</td><td>国内製造</td></tr></table>
<h2>レビュー</h2><ul><li>おいしい</li></ul>
</body></html>`;

/**
 * YouTube 概要欄：「材料」「作り方」の見出しが無いもの（ダミー。本物の文章ではない）。
 * - 「★レシピはこちら↓」と罫線で囲まれた区間にレシピ
 * - 材料は「名前...分量」。最初に全体の量、その後に ＝〇〇＝ ごとの内訳
 * - 手順は番号なしの文章
 * - 罫線の外にタイムスタンプ・URL・ハッシュタグ
 */
export const DESCRIPTION_LOOSE = `ダミーの魚で2品つくる動画です。今日も最高にうまい。
★今回のレシピはこちら↓
ーーーーーーーーーーーーーーー
【ダミー魚の混ぜご飯＆塩焼き】
ダミー魚...4尾（500g）
＝塩焼き＝
ダミー魚...2尾
塩...小さじ1/2
すだち...適量
＝混ぜご飯＝
ダミー魚...2尾
米...2合
醤油...大さじ2
酒...大さじ1
しょうが...1かけ
魚に塩をふって10分おく
グリルで両面をこんがり焼く
身をほぐして炊いたご飯に混ぜる
ーーーーーーーーーーーーーーー
00:00 オープニング
03:15 実食
▼ダミーのレシピ本
https://example.com/book
#ダミー魚 #混ぜご飯`;

/**
 * YouTube 概要欄：本番で読めなかった形を真似たダミー（本物の文章ではない）。
 * - 先頭の【料理名】のまとまりは下ごしらえの材料（全体の量のダミー魚4尾と、調味料）
 * - 材料の途中に「⭐︎お好みで…」の注記の行
 * - 見出しは半角・全角が混ざる（=塩焼き＝）。まとまりの間に空行
 * - 手順の前に料理名だけの行、手順の間に空行
 */
export const DESCRIPTION_LOOSE_REAL_SHAPE = `高評価お願いします！

★今回のレシピはこちら↓
ーーーーーーーーーーーーーー
【ダミー魚の混ぜご飯＆塩焼き】
ダミー魚...4尾（500g）
塩...5g強
砂糖...2つまみ（2g）
⭐︎お好みで塩
油...大さじ1

=塩焼き＝
ダミー魚...2尾
すだち...2切れ
⭐︎お好みで大根おろし

＝混ぜご飯＝
ダミー魚...2尾
ご飯...400g
ごま...3つまみ

ダミー魚の混ぜご飯&塩焼き

魚に塩と砂糖をふって10分おく
水気をふく

油で2尾を両面焼く
残りも焼いて骨を取り、ご飯と混ぜる
ーーーーーーーーーーーーーー
◆ダミーアプリ
ダウンロードはこちら⇒　https://example.com/app`;
