// URL 取り込みの解釈部分（AI なし）。HTML の取得は API 側、ここは純粋な変換だけ。
// サイトは schema.org の Recipe（JSON-LD）から、材料と手順だけを取り出す。
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

/**
 * ページ内の JSON-LD（script type="application/ld+json" の中身）から Recipe を取り出す。
 * 見つからなければ null。
 */
export function extractRecipeFromJsonLd(
  blocks: string[],
): ImportedRecipe | null {
  for (const raw of blocks) {
    let parsed: Json;
    try {
      parsed = JSON.parse(raw.trim());
    } catch {
      continue;
    }
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
      title,
      ...ingredients.map((i) => i.name),
    ];
    const video = asArray(node.video)[0] as Record<string, Json> | undefined;
    const videoCandidate = video
      ? text(video.embedUrl) || text(video.contentUrl) || text(video.url)
      : "";
    const v = videoCandidate ? parseVideoUrl(videoCandidate) : null;
    if (!title && !ingredients.length) continue;
    return {
      title: title.slice(0, 100) || "取り込んだレシピ",
      ingredients: ingredients.map((i) => ({
        name: i.name.slice(0, 60),
        amount: i.amount.slice(0, 30),
      })),
      steps: steps.slice(0, 40).map((s) => s.slice(0, 500)),
      timeLabel: durationLabel(node.totalTime) || durationLabel(node.cookTime),
      category: guessCategory(hints),
      genre: guessGenre(hints),
      videoUrl: v ? v.watchUrl : null,
    };
  }
  return null;
}
