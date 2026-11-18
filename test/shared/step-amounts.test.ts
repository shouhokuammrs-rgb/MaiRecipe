import { describe, expect, it } from "vitest";
import { stepWithAmounts } from "../../src/shared/step-amounts";

// 手順に出てくる材料に分量を添える（DEC-036）
const ing = (name: string, amount = "") => ({ name, amount });
const ings = [
  ing("鶏もも肉", "300g"),
  ing("塩", "小さじ1/2"),
  ing("片栗粉", "大さじ2"),
  ing("玉ねぎ（薄切り）", "1個"),
  ing("ごま油", "大さじ1"),
  ing("水", "200ml"),
  ing("こしょう", "少々"),
  ing("卵", ""),
  ing("【A】しょうゆ", "大さじ1"),
  ing("【A】みりん", "大さじ2"),
];

describe("stepWithAmounts", () => {
  it.each([
    ["鶏もも肉に塩をふる", "鶏もも肉（300g）に塩（小さじ1/2）をふる"],
    ["片栗粉をまぶす", "片栗粉（大さじ2）をまぶす"],
    [
      "塩、こしょうで味をととのえる",
      "塩（小さじ1/2）、こしょう（少々）で味をととのえる",
    ],
    // 材料名の（薄切り）は外して探す。書き方の揺れ（たまねぎ）も拾う
    ["玉ねぎを炒める", "玉ねぎ（1個）を炒める"],
    ["たまねぎを炒める", "たまねぎ（1個）を炒める"],
    ["フライパンにごま油を熱する", "フライパンにごま油（大さじ1）を熱する"],
    ["水を加えて煮る", "水（200ml）を加えて煮る"],
  ])("「%s」", (step, out) => {
    expect(stepWithAmounts(step, ings)).toBe(out);
  });

  it("同じ手順に2回出てきたら、添えるのは最初の1回", () => {
    expect(stepWithAmounts("塩をふり、5分おいて塩を洗い流す", ings)).toBe(
      "塩（小さじ1/2）をふり、5分おいて塩を洗い流す",
    );
  });

  it("別の言葉の一部には添えない", () => {
    for (const s of [
      "水気をふき取る",
      "塩こしょうをふる",
      "塩昆布を加える",
      "サラダ油をひく",
      "溶き卵を回し入れる",
    ])
      expect(stepWithAmounts(s, ings)).toBe(s);
  });

  it("手順にもう分量が書いてあるとき・かっこが続くときは添えない", () => {
    for (const s of [
      "塩小さじ1をふる",
      "塩 小さじ1/2 をふる",
      "塩（ひとつまみ）をふる",
      "水200mlを加える",
      "片栗粉大さじ1をまぶす",
    ])
      expect(stepWithAmounts(s, ings)).toBe(s);
  });

  it("分量の無い材料には添えない", () => {
    expect(stepWithAmounts("卵を割り入れる", ings)).toBe("卵を割り入れる");
  });

  it("まとまり（A）は、中身に分量を付けて書き足す", () => {
    expect(stepWithAmounts("Aを加えて煮る", ings)).toBe(
      "A（しょうゆ 大さじ1・みりん 大さじ2）を加えて煮る",
    );
  });

  it("長い名前を先に当てる（ごま油の「油」に別の材料「油」を当てない）", () => {
    const xs = [ing("油", "適量"), ing("ごま油", "小さじ1")];
    expect(stepWithAmounts("ごま油を回しかけ、油を足す", xs)).toBe(
      "ごま油（小さじ1）を回しかけ、油（適量）を足す",
    );
  });
});
