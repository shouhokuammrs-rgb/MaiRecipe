// URL 取り込みの解釈部分（AI なし）。HTML の取得は API 側、ここは純粋な変換だけ。
// サイトは schema.org の Recipe（JSON-LD）から、無ければ「材料」「作り方」の見出しの後から、
// YouTube は概要欄の【材料】【作り方】から、材料と手順だけを取り出す。
// 元の文章・写真はコピーしない（材料と手順は事実として扱う。docs/decisions/DEC-011）。
import type { Category, Genre } from "./constants";
import type { Ingredient } from "./recipe";
import { splitIngredientLine } from "./recipe";

export type ImportedRecipe = {
  title: string;
  ingredients: Ingredient[];
  steps: string[];
  timeLabel: string;
  category: Category;
  genre: Genre;
  videoUrl: string | null;
};

export type VideoRef = {
  provider: "youtube";
  id: string;
  embedUrl: string;
  watchUrl: string;
};

export function parseVideoUrl(raw: string): VideoRef | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0] ?? null;
  else if (host === "youtube.com" || host === "music.youtube.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else {
      const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/);
      id = m?.[1] ?? null;
    }
  }
  if (!id || !/^[A-Za-z0-9_-]{6,20}$/.test(id)) return null;
  return {
    provider: "youtube",
    id,
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
    watchUrl: `https://www.youtube.com/watch?v=${id}`,
  };
}

type Json = unknown;

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function isRecipe(node: Json): node is Record<string, Json> {
  if (!node || typeof node !== "object") return false;
  const t = (node as Record<string, Json>)["@type"];
  return asArray(t as string | string[]).some(
    (x) => typeof x === "string" && x.toLowerCase() === "recipe",
  );
}

function findRecipeNode(node: Json, depth = 0): Record<string, Json> | null {
  if (depth > 6 || !node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findRecipeNode(n, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (isRecipe(node)) return node as Record<string, Json>;
  const obj = node as Record<string, Json>;
  for (const key of ["@graph", "mainEntity", "itemListElement", "item"]) {
    const r = findRecipeNode(obj[key], depth + 1);
    if (r) return r;
  }
  return null;
}

function text(v: Json): string {
  if (typeof v === "string")
    return decodeEntities(v)
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim();
  if (typeof v === "number") return String(v);
  return "";
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)));
}

function collectSteps(v: Json, out: string[], depth = 0) {
  if (depth > 5) return;
  if (typeof v === "string") {
    // 1つの文字列に改行区切りで手順が入っているサイトもある
    for (const line of v.replace(/<br\s*\/?>/gi, "\n").split(/\n+/)) {
      const t = text(line);
      if (t) out.push(t);
    }
    return;
  }
  if (Array.isArray(v)) {
    v.forEach((x) => collectSteps(x, out, depth + 1));
    return;
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, Json>;
    if (o.itemListElement) collectSteps(o.itemListElement, out, depth + 1);
    else if (o.text) collectSteps(o.text, out, depth + 1);
    else if (o.name) collectSteps(o.name, out, depth + 1);
  }
}

/** ISO 8601 の期間（PT1H20M）を「1時間20分」に */
export function durationLabel(v: Json): string {
  const s = typeof v === "string" ? v : "";
  const m = s.match(/^P(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!m || (!m[1] && !m[2])) return "";
  const h = Number(m[1] ?? 0);
  const min = Number(m[2] ?? 0);
  if (h && min) return `${h}時間${min}分`;
  return h ? `${h}時間` : `${min}分`;
}

export function guessCategory(hints: string[]): Category {
  const s = hints.join(" ");
  if (
    /デザート|スイーツ|お菓子|おやつ|ケーキ|プリン|クッキー|dessert|sweet/i.test(
      s,
    )
  )
    return "デザート";
  if (
    /丼|どんぶり|カレー|チャーハン|炒飯|オムライス|ご飯もの|パスタ|麺|うどん|そば|ラーメン/i.test(
      s,
    )
  )
    return "丼";
  if (/汁|スープ|味噌汁|みそ汁|ポタージュ|soup/i.test(s)) return "汁物";
  if (/副菜|サラダ|和え|おひたし|小鉢|漬け|salad|side/i.test(s)) return "副菜";
  if (/主菜|メイン|main/i.test(s)) return "主菜";
  return "主菜";
}

export function guessGenre(hints: string[]): Genre {
  const s = hints.join(" ");
  if (/韓国|korean|キムチ|チヂミ|ナムル|ビビンバ|コチュジャン|チゲ/i.test(s))
    return "韓国";
  if (
    /中華|chinese|麻婆|回鍋肉|酢豚|餃子|春巻|青椒|チャーハン|炒飯|甘酢/i.test(s)
  )
    return "中華";
  if (
    /エスニック|タイ|ベトナム|インド|thai|vietnam|indian|ガパオ|フォー|ナンプラー|スパイス/i.test(
      s,
    )
  )
    return "エスニック";
  if (
    /洋食|イタリア|フレンチ|western|italian|french|パスタ|グラタン|シチュー|ハンバーグ|ミネストローネ|トマト缶/i.test(
      s,
    )
  )
    return "洋食";
  if (/和食|japanese|味噌|みそ|醤油|だし|煮物|照り焼き|丼/i.test(s))
    return "和食";
  return "その他";
}

// JSON.parse。失敗したら、文字列の外にある行コメント（//）とブロックコメントを消してもう一度だけ試す
function parseJsonLoose(raw: string): Json | undefined {
  try {
    return JSON.parse(raw);
  } catch {
    // 続けて下で試す
  }
  let out = "";
  let inString = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += raw[i + 1] ?? "";
        i++;
      } else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "/" && raw[i + 1] === "/") {
      while (i < raw.length && raw[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && raw[i + 1] === "*") {
      const end = raw.indexOf("*/", i + 2);
      i = end === -1 ? raw.length : end + 1;
    } else out += ch;
  }
  try {
    return JSON.parse(out);
  } catch {
    return undefined;
  }
}

/** 取り出した材料・手順を、保存できる長さと件数にそろえる */
function finishRecipe(input: {
  title: string;
  ingredients: Ingredient[];
  steps: string[];
  timeLabel: string;
  hints: string[];
  videoUrl: string | null;
}): ImportedRecipe {
  const hints = [
    ...input.hints,
    input.title,
    ...input.ingredients.map((i) => i.name),
  ];
  return {
    title: input.title.slice(0, 100) || "取り込んだレシピ",
    ingredients: input.ingredients.slice(0, 60).map((i) => ({
      name: i.name.slice(0, 60),
      amount: i.amount.slice(0, 30),
    })),
    steps: input.steps.slice(0, 40).map((s) => s.slice(0, 500)),
    timeLabel: input.timeLabel,
    category: guessCategory(hints),
    genre: guessGenre(hints),
    videoUrl: input.videoUrl,
  };
}

/**
 * ページ内の JSON-LD（script type="application/ld+json" の中身）から Recipe を取り出す。
 * 見つからなければ null。
 */
export function extractRecipeFromJsonLd(
  blocks: string[],
): ImportedRecipe | null {
  for (const raw of blocks) {
    const parsed = parseJsonLoose(raw.trim());
    if (parsed === undefined) continue;
    const node = findRecipeNode(parsed);
    if (!node) continue;
    const title = text(node.name) || text(node.headline);
    const ingredients = asArray(node.recipeIngredient ?? node.ingredients)
      .map((x) => text(x))
      .filter(Boolean)
      .slice(0, 60)
      .map(splitIngredientLine);
    const steps: string[] = [];
    collectSteps(node.recipeInstructions, steps);
    const hints = [
      ...asArray(node.recipeCategory).map(text),
      ...asArray(node.recipeCuisine).map(text),
      ...asArray(node.keywords).map(text),
    ];
    const video = asArray(node.video)[0] as Record<string, Json> | undefined;
    const videoCandidate = video
      ? text(video.embedUrl) || text(video.contentUrl) || text(video.url)
      : "";
    const v = videoCandidate ? parseVideoUrl(videoCandidate) : null;
    if (!title && !ingredients.length) continue;
    return finishRecipe({
      title,
      ingredients,
      steps,
      timeLabel: durationLabel(node.totalTime) || durationLabel(node.cookTime),
      hints,
      videoUrl: v ? v.watchUrl : null,
    });
  }
  return null;
}

// ---- JSON-LD が無いページの予備の読み取り（見出しの後の dl / li / table） ----

/** 見出しから拾った材料。分量が別の欄に無いときは amount を空にして、名前側の1行を分ける */
export type RawIngredient = { name: string; amount: string };

export type HeadingKind = "ingredients" | "steps" | "other" | "ignore";

/** 見出しの文字で、この後を材料として読むか・手順として読むか・読むのをやめるかを決める */
export function classifyHeading(raw: string): HeadingKind {
  const s = text(raw).replace(/\s+/g, "");
  if (!s || s.length > 30) return "ignore";
  if (/材料/.test(s)) return "ingredients";
  if (/作り方|つくり方|作りかた|手順/.test(s)) return "steps";
  return "other";
}

/**
 * 手順の頭の番号（"1." "(3)" "STEP4" "① "）を外す。
 * ページの ol > li では「②のスパゲッティを加える」のように ①② が前の手順を指すことがあるので、
 * 空白の続かない ①② は外さない。概要欄（loose）は「①鶏肉を切る」も番号として外す
 */
function stripStepNumber(s: string, loose = false): string {
  const circled = loose ? "[①-⑳]" : "[①-⑳](?=\\s)";
  return s
    .replace(
      new RegExp(
        `^(?:\\d{1,2}\\s*[.)．）:：、]|${circled}|[(（]\\d{1,2}[)）]|step\\s*\\d{1,2}[.:：]?)\\s*`,
        "i",
      ),
      "",
    )
    .trim();
}

/** "<title>" のサイト名（"｜サイト" " | Site" " - Site"）を外す */
export function cleanPageTitle(raw: string): string {
  const s = text(raw);
  return (s.split(/\s*[｜|]\s*|\s+[-–—]\s+/)[0] ?? s).trim();
}

/** 見出しの後から拾った材料・手順をレシピにする。どちらも空なら null */
export function recipeFromSections(input: {
  title: string;
  ingredients: RawIngredient[];
  steps: string[];
}): ImportedRecipe | null {
  const ingredients: Ingredient[] = [];
  for (const raw of input.ingredients) {
    const name = text(raw.name);
    const amount = text(raw.amount);
    if (!name) continue;
    ingredients.push(amount ? { name, amount } : splitIngredientLine(name));
  }
  const steps = input.steps
    .map((s) => stripStepNumber(text(s)))
    .filter(Boolean);
  if (!ingredients.length && !steps.length) return null;
  return finishRecipe({
    title: cleanPageTitle(input.title),
    ingredients,
    steps,
    timeLabel: "",
    hints: [],
    videoUrl: null,
  });
}

// ---- YouTube の概要欄 ----

const DESC_BULLET = /^[・･\-－*＊●○◆◇■□▼▽★☆✅>＞]+\s*/u;
const URL_RE = /https?:\/\/[^\s"'<>（）「」]+/g;

/** 概要欄の1行が区切り（【材料】など）なら、その種類を返す */
function descMarker(line: string): HeadingKind | null {
  const inner = line.replace(/^[【[［<＜《〈(（■□●○◆◇▼▽★☆・\s]+/u, "").trim();
  if (!inner || line.length > 24) return null;
  if (/^材料/.test(inner)) return "ingredients";
  if (/^(?:作り方|つくり方|作りかた|手順)/.test(inner)) return "steps";
  // 【ポイント】■お知らせ のような別の区切り。＜タレ＞（A）のような短いまとまりの名前は区切りにしない
  if (/^[【[［■□▼▽◆◇]/.test(line) && inner.replace(/[】\]］]/g, "").length > 3)
    return "other";
  return null;
}

/** 概要欄の【材料】【作り方】の区切りから材料・手順を取り出す。区切りが無ければ null */
export function parseDescriptionRecipe(
  description: string,
): { ingredients: RawIngredient[]; steps: string[] } | null {
  const ingredients: RawIngredient[] = [];
  const steps: string[] = [];
  let mode: HeadingKind | null = null;
  let seenMarker = false;
  let numbered = false;
  let afterBlank = false;
  for (const rawLine of description.split(/\r?\n/).slice(0, 400)) {
    const line = rawLine.trim();
    if (!line) {
      afterBlank = true;
      continue;
    }
    const marker = descMarker(line);
    if (marker) {
      mode = marker;
      if (marker !== "other") seenMarker = true;
      afterBlank = false;
      continue;
    }
    if (/^#/.test(line) || /^https?:\/\//.test(line)) {
      mode = null;
      continue;
    }
    if (mode === "ingredients") {
      const body = line.replace(DESC_BULLET, "");
      // ＜タレ＞（A）のような、まとまりの名前だけの行は飛ばす
      if (/^[<＜(（【[［].{0,6}[>＞)）】\]］]$/u.test(body)) continue;
      if (body) ingredients.push(splitIngredientLine(body));
    } else if (mode === "steps") {
      const body = line.replace(DESC_BULLET, "");
      const stripped = stripStepNumber(body, true);
      const hasNumber = stripped !== body.trim();
      if (hasNumber) {
        numbered = true;
        if (stripped) steps.push(stripped);
      } else if (numbered) {
        // 番号つきの手順の後：空行の後なら手順は終わり、続きの行なら前の手順につなげる
        if (afterBlank) mode = null;
        else if (steps.length) steps[steps.length - 1] += stripped;
        else steps.push(stripped);
      } else steps.push(stripped);
    }
    afterBlank = false;
  }
  if (!seenMarker || (!ingredients.length && !steps.length)) return null;
  return { ingredients: ingredients.slice(0, 60), steps: steps.slice(0, 40) };
}

/** レシピのページではない（SNS・動画・ショートリンクのまとめなど）ので試さないホスト */
const NOT_RECIPE_HOSTS =
  /(^|\.)(youtube\.com|youtu\.be|instagram\.com|twitter\.com|x\.com|tiktok\.com|facebook\.com|threads\.net|line\.me|lin\.ee|lit\.link|linktr\.ee|amzn\.to|amazon\.co\.jp|amazon\.com|a\.r10\.to)$/i;

/** 概要欄から、レシピのページかもしれない URL を上から最大 max 件 */
export function pickRecipeUrls(description: string, max = 3): string[] {
  const out: string[] = [];
  for (const m of description.matchAll(URL_RE)) {
    let u: URL;
    try {
      u = new URL(m[0]);
    } catch {
      continue;
    }
    if (NOT_RECIPE_HOSTS.test(u.hostname)) continue;
    const s = u.toString();
    if (out.includes(s)) continue;
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}
