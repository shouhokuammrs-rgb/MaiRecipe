import { describe, expect, it } from "vitest";
import { moveItem } from "../../src/shared/move";

describe("moveItem（材料・手順の並び替え）", () => {
  const list = ["a", "b", "c", "d"];
  it("1つ上・1つ下に動かす", () => {
    expect(moveItem(list, 2, -1)).toEqual(["a", "c", "b", "d"]);
    expect(moveItem(list, 1, 1)).toEqual(["a", "c", "b", "d"]);
  });
  it("端を越えては動かさない（同じ並びを返す）", () => {
    expect(moveItem(list, 0, -1)).toEqual(list);
    expect(moveItem(list, 3, 1)).toEqual(list);
  });
  it("元の配列は変えない", () => {
    const src = [...list];
    moveItem(src, 0, 1);
    expect(src).toEqual(list);
  });
  it("範囲外の番号はそのまま返す", () => {
    expect(moveItem(list, 9, -1)).toEqual(list);
  });
});
