import { describe, expect, it } from "vitest";
import { isJoinRaceError } from "../../src/api/data/membership";

describe("isJoinRaceError（参加の INSERT が競合で失敗したときだけ検知する）", () => {
  it("D1 の NOT NULL 制約違反（group_members）は競合として検知する", () => {
    const err = new Error(
      "D1_ERROR: NOT NULL constraint failed: group_members.group_id: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_NOTNULL)",
    );
    expect(isJoinRaceError(err)).toBe(true);
  });

  it("D1 の UNIQUE 制約違反（group_members）は競合として検知する", () => {
    const err = new Error(
      "D1_ERROR: UNIQUE constraint failed: group_members.user_id: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)",
    );
    expect(isJoinRaceError(err)).toBe(true);
  });

  it("関係ない外部キー違反は競合として扱わない（本当のバグを隠さない）", () => {
    const err = new Error(
      "D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)",
    );
    expect(isJoinRaceError(err)).toBe(false);
  });

  it("Error でない値は競合として扱わない", () => {
    expect(isJoinRaceError("boom")).toBe(false);
    expect(
      isJoinRaceError({
        message: "group_members NOT NULL constraint failed",
      }),
    ).toBe(false);
    expect(isJoinRaceError(null)).toBe(false);
  });
});
