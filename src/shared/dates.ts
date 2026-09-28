// 日付は "YYYY-MM-DD"（日本時間）の文字列で扱う。

export function todayJst(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** その日を含む週の月曜日 */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 月=0
  return addDays(date, -dow);
}

const DOW = ["日", "月", "火", "水", "木", "金", "土"];

export function labelDate(date: string): {
  md: string;
  dow: string;
  dowIndex: number;
} {
  const d = new Date(`${date}T00:00:00Z`);
  return {
    md: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`,
    dow: DOW[d.getUTCDay()] ?? "",
    dowIndex: d.getUTCDay(),
  };
}

export function isDate(s: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())
  );
}
