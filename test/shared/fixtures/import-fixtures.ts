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
