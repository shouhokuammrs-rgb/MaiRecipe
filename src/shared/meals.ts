// 食べた記録（DEC-030）。本人だけのもの。ここは純粋な部分
import { z } from "zod";
import { MEALS } from "./constants";

export const MEAL_KCAL_MAX = 5000;

export const mealAddSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** 朝・昼・夜。分からなければ null */
  meal: z.enum(MEALS).nullable().default(null),
  title: z.string().trim().min(1).max(60),
  portion: z
    .number()
    .min(0.5)
    .max(10)
    .refine((v) => Number.isInteger(v * 2), "0.5 刻みで入れてください")
    .default(1),
  /** 1人前のカロリー（概算。分からなければ null） */
  kcal: z.number().int().min(0).max(MEAL_KCAL_MAX).nullable().default(null),
});
export type MealAddInput = z.infer<typeof mealAddSchema>;

/** 外食・買ったものの写真を見て、料理名と概算カロリーを読むときの指示 */
export function buildMealPhotoPrompt(): string {
  return [
    "この写真は食事の写真です。何の料理か当てて、写っている分のカロリーをおおまかに見積もってください。",
    "必ず次の JSON だけを返してください。前後に説明や ``` を付けないでください。",
    '{"title":"料理名（短く。例：牛丼 並）","kcal":650,"items":["写っている品1","品2"]}',
    "決まり：",
    "- kcal は写っている量の合計の概算（整数）。日本の一般的な店の盛りを基準にする。分からなければ null",
    "- 複数の品があれば title は主な品、items に全部",
    "- 食事の写真でなければ title を空文字にする",
  ].join("\n");
}

export type MealPhoto = { title: string; kcal: number | null; items: string[] };

/** AI の返事から料理名とカロリーを読む。料理名が無ければ null */
export function parseMealPhoto(raw: string): MealPhoto | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  const o = (json ?? {}) as {
    title?: unknown;
    kcal?: unknown;
    items?: unknown;
  };
  const title =
    typeof o.title === "string"
      ? o.title.replace(/\s+/g, " ").trim().slice(0, 60)
      : "";
  if (!title) return null;
  const n = typeof o.kcal === "string" ? Number(o.kcal) : o.kcal;
  const kcal =
    typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= MEAL_KCAL_MAX
      ? Math.round(n)
      : null;
  const items = Array.isArray(o.items)
    ? o.items
        .filter((x): x is string => typeof x === "string" && x.trim() !== "")
        .map((x) => x.trim().slice(0, 40))
        .slice(0, 10)
    : [];
  return { title, kcal, items };
}

/** 日ごとのまとめ（新しい日が先）。kcal は人前をかけた分の合計、分からない品があれば partial */
export function summarizeMeals(
  meals: {
    date: string;
    title: string;
    portion: number;
    kcal: number | null;
  }[],
): { date: string; count: number; kcal: number; partial: boolean }[] {
  const by = new Map<
    string,
    { date: string; count: number; kcal: number; partial: boolean }
  >();
  for (const m of meals) {
    const cur = by.get(m.date) ?? {
      date: m.date,
      count: 0,
      kcal: 0,
      partial: false,
    };
    cur.count += 1;
    if (m.kcal === null) cur.partial = true;
    else cur.kcal += Math.round(m.kcal * m.portion);
    by.set(m.date, cur);
  }
  return [...by.values()].sort((a, b) => b.date.localeCompare(a.date));
}
