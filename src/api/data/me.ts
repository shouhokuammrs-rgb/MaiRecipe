// 本人だけのデータ（DEC-030）。食べた記録・評価・目標・体重はグループではなく本人に閉じる。
// セッションの userId で forUser を作り、ここを通してだけ触る（グループの判定と同じ考え方）
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import type { Db } from "./index";
import * as s from "./schema";

export type MealRow = {
  id: string;
  date: string;
  kind: "cooked" | "outside";
  cookLogId: string | null;
  title: string;
  portion: number;
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
        kind: r.kind,
        cookLogId: r.cookLogId,
        title: r.title,
        portion: r.portion,
        createdAt: r.createdAt.getTime(),
      }));
    },
  };
}
export type UserRepo = ReturnType<typeof forUser>;
