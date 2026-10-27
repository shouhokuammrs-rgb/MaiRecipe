// 本人だけのデータ（DEC-030）。食べた記録・評価・目標・体重はグループではなく本人に閉じる。
// セッションの userId で forUser を作り、ここを通してだけ触る（グループの判定と同じ考え方）
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { NotFound, type Db } from "./index";
import * as s from "./schema";

export type MealRow = {
  id: string;
  date: string;
  meal: "breakfast" | "lunch" | "dinner" | null;
  kind: "cooked" | "outside";
  cookLogId: string | null;
  title: string;
  portion: number;
  kcal: number | null;
  createdAt: number;
};

export function forUser(db: Db, userId: string) {
  const mine = eq(s.mealLogs.userId, userId);
  return {
    /** 期間の食べた記録（古い順） */
    async listMeals(from: string, to: string): Promise<MealRow[]> {
      const rows = await db
        .select()
        .from(s.mealLogs)
        .where(and(mine, gte(s.mealLogs.date, from), lte(s.mealLogs.date, to)))
        .orderBy(asc(s.mealLogs.date), desc(s.mealLogs.createdAt));
      return rows.map((r) => ({
        id: r.id,
        date: r.date,
        meal: r.meal,
        kind: r.kind,
        cookLogId: r.cookLogId,
        title: r.title,
        portion: r.portion,
        kcal: r.kcal,
        createdAt: r.createdAt.getTime(),
      }));
    },

    /** 外食・買ったものを入れる */
    async addMeal(input: {
      date: string;
      meal: "breakfast" | "lunch" | "dinner" | null;
      title: string;
      portion: number;
      kcal: number | null;
    }): Promise<string> {
      const id = crypto.randomUUID();
      await db.insert(s.mealLogs).values({
        id,
        userId,
        date: input.date,
        meal: input.meal,
        kind: "outside",
        cookLogId: null,
        title: input.title,
        portion: input.portion,
        kcal: input.kcal,
      });
      return id;
    },

    /** 自分の食べた記録を消す（作った記録はそのまま）。他人のものは 404 */
    async deleteMeal(id: string) {
      const r = await db
        .delete(s.mealLogs)
        .where(and(eq(s.mealLogs.id, id), mine))
        .returning({ id: s.mealLogs.id });
      if (!r.length) throw new NotFound("meal");
    },
  };
}
export type UserRepo = ReturnType<typeof forUser>;
