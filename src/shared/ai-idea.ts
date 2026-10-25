// 冷蔵庫の食材から、AI に新しいレシピを考えてもらう（#15 の2つ目 / DEC-029）。ここは純粋な部分。
// 出典の無いレシピなので、保存すると「AI が考えたレシピ（出典なし）」として分けて見せる（DEC-012）
import { z } from "zod";
import { CATEGORIES, GENRES, type Category, type Genre } from "./constants";
import { parseAiRecipe, type AiRecipe } from "./ai-read";

/** 一度に出す案の数 */
export const IDEAS_MAX = 3;

export const ideaSchema = z.object({
  /** 使いたい食材（冷蔵庫で選んだもの） */
  use: z
    .array(z.string().trim().max(30))
    .transform((a) => a.filter(Boolean))
    .pipe(z.array(z.string()).min(1).max(10)),
  wish: z.string().trim().max(100).default(""),
});
export type IdeaInput = z.infer<typeof ideaSchema>;

export type RecipeIdea = Omit<AiRecipe, "stepTimes"> & {
  category: Category;
  genre: Genre;
};

export function buildIdeaPrompt(p: {
  use: string[];
  /** 冷蔵庫にあるほかの食材（使わなくてよい） */
  others: string[];
  wish: string;
}) {
  const system = [
    "あなたは家庭料理の手伝いをします。使いたい食材で、家で作れるレシピを考えてください。",
    `違う料理を${IDEAS_MAX}つまで考える。必ず次の JSON だけを返す（前後に説明や \`\`\` を付けない）：`,
    `{"ideas":[{"title":"料理名","category":"${CATEGORIES.join("|")}","genre":"${GENRES.join("|")}","servings":"2人分","time":"20分","ingredients":[{"name":"材料名","amount":"分量"}],"steps":["手順1","手順2"],"tips":[{"step":1,"text":"コツ"}]}]}`,
    "決まり：",
    "- 使いたい食材をできるだけ使う。ほかにある食材は使ってもよい。しょうゆ・塩・砂糖・油などのふつうの調味料は家にあるものとしてよい",
    "- それ以外の食材を足すのは1つの料理に2つまで",
    "- 2人分で、分量は大さじ・小さじ・g・個などで具体的に書く",
    "- 手順は短い文に分け、番号は付けない。火加減と時間を書く",
    "- 実在の料理本やサイトのレシピを書き写さない。ありふれた家庭料理として自分で組み立てる",
    "- 生焼け・食中毒の心配がある食材は、中まで火を通すことを手順に書く",
  ].join("\n");
  const user = [
    `使いたい食材：${p.use.join("、")}`,
    `ほかにある食材：${p.others.length ? p.others.join("、") : "（なし）"}`,
    `希望：${p.wish || "（なし）"}`,
  ].join("\n");
  return { system, user };
}

const pick = <T extends string>(list: readonly T[], v: unknown): T =>
  (list as readonly unknown[]).includes(v) ? (v as T) : ("その他" as T);

/** AI の返事から案を読む。形の崩れた案は捨てる。返事そのものが読めなければ null */
export function parseIdeas(raw: string): RecipeIdea[] | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  const list = (json as { ideas?: unknown })?.ideas;
  if (!Array.isArray(list)) return null;
  const out: RecipeIdea[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const r = parseAiRecipe(JSON.stringify(item));
    if (!r || !r.title || !r.ingredients.length || !r.steps.length) continue;
    const o = item as { category?: unknown; genre?: unknown };
    const { stepTimes: _drop, ...rest } = r;
    out.push({
      ...rest,
      category: pick(CATEGORIES, o.category),
      genre: pick(GENRES, o.genre),
    });
    if (out.length >= IDEAS_MAX) break;
  }
  return out;
}
