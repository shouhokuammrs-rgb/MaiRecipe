/** 並びの中の1つを上（-1）か下（+1）へ1つ動かす。端を越えるときや範囲外はそのまま。元の配列は変えない */
export function moveItem<T>(
  list: readonly T[],
  index: number,
  dir: -1 | 1,
): T[] {
  const to = index + dir;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length)
    return [...list];
  const next = [...list];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}
