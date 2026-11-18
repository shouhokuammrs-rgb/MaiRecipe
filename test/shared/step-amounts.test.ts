import { describe, expect, it } from "vitest";
import {
  stepsWithAmounts,
  stepWithAmounts,
} from "../../src/shared/step-amounts";

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

  // レビューで見つかったもの
  it("後ろに分量が書いてあるときは添えない", () => {
    const xs = [...ings, ing("酒", "大さじ1"), ing("砂糖", "大さじ1")];
    for (const st of [
      "塩をひとつまみ加える",
      "水を大さじ2加える",
      "酒、みりん、しょうゆを各大さじ1ずつ入れる",
      "塩と砂糖各小さじ1を混ぜる",
      "塩もみする",
    ])
      expect(stepWithAmounts(st, xs)).toBe(st);
  });

  it("水・油は、材料として入れるとき（を・と・、が続く）だけ添える", () => {
    const xs = [ing("水", "200ml"), ing("油", "大さじ1")];
    for (const st of ["野菜を水にさらす", "米を水で洗う", "油は捨てる"])
      expect(stepWithAmounts(st, xs)).toBe(st);
    expect(stepWithAmounts("水と油を入れる", xs)).toBe(
      "水（200ml）と油（大さじ1）を入れる",
    );
  });

  it("同じ名前が材料表に2つあっても、2つ目に別の分量を付けない。まとまりの外を先に", () => {
    const xs = [ing("【A】塩", "ひとつまみ"), ing("塩", "小さじ1/2")];
    expect(stepWithAmounts("塩をふり、塩は控えめにする", xs)).toBe(
      "塩（小さじ1/2）をふり、塩は控えめにする",
    );
  });

  it("分量の但し書きは外し、長すぎる分量は添えない", () => {
    const xs = [
      ing("鶏もも肉", "1枚(300g)"),
      ing("だし汁", "400ml（水400ml＋顆粒だし小さじ1でも可）"),
      ing("バター", "室温に30分おいてやわらかくしたもの"),
    ];
    expect(stepWithAmounts("鶏もも肉を切る", xs)).toBe("鶏もも肉（1枚）を切る");
    expect(stepWithAmounts("だし汁を注ぐ", xs)).toBe("だし汁（400ml）を注ぐ");
    expect(stepWithAmounts("バターを塗る", xs)).toBe("バターを塗る");
  });

  it("切り方の数字（2cm幅・2等分・2つに）は分量ではないので添える", () => {
    const xs = [ing("大根", "1/2本"), ing("玉ねぎ", "1個")];
    expect(stepWithAmounts("大根を2cm幅に切る", xs)).toBe(
      "大根（1/2本）を2cm幅に切る",
    );
    expect(stepWithAmounts("玉ねぎを2等分にする", xs)).toBe(
      "玉ねぎ（1個）を2等分にする",
    );
    expect(stepWithAmounts("玉ねぎを2つに切る", xs)).toBe(
      "玉ねぎ（1個）を2つに切る",
    );
    expect(stepWithAmounts("玉ねぎを2個使う", xs)).toBe("玉ねぎを2個使う");
  });

  // 実際のレシピで見つかったもの（なすと豚肉の炒め物）
  describe("かっこで材料を並べた手順", () => {
    const step =
      "容器に合わせ調味料の材料（オイスターソース、しょうゆ、砂糖、酒）を入れて混ぜ合わせる";
    const seasonings = [
      ing("オイスターソース", "大さじ1"),
      ing("しょうゆ", "大さじ1"),
      ing("砂糖", "小さじ2"),
      ing("酒", "大さじ1"),
    ];
    const want =
      "容器に合わせ調味料の材料（オイスターソース 大さじ1、しょうゆ 大さじ1、砂糖 小さじ2、酒 大さじ1）を入れて混ぜ合わせる";

    it("かっこを重ねず、最後の材料（「）」の前）にも添える", () => {
      expect(stepWithAmounts(step, seasonings)).toBe(want);
    });

    it("材料がまとまりになっていても、同じ中身を2回書かない", () => {
      const grouped = seasonings.map((i) => ({
        ...i,
        name: `【合わせ調味料】${i.name}`,
      }));
      expect(stepWithAmounts(step, grouped)).toBe(want);
      // 中身の書いていない手順では、まとまりを書き足す
      expect(stepWithAmounts("合わせ調味料を加える", grouped)).toBe(
        "合わせ調味料（オイスターソース 大さじ1・しょうゆ 大さじ1・砂糖 小さじ2・酒 大さじ1）を加える",
      );
    });
  });

  it("「ちぎった赤唐辛子」「切ったなす」のように、動詞の後の材料にも添える", () => {
    const xs = [ing("赤唐辛子", "1本"), ing("なす", "3本")];
    expect(stepWithAmounts("ちぎった赤唐辛子を加える", xs)).toBe(
      "ちぎった赤唐辛子（1本）を加える",
    );
    expect(stepWithAmounts("切ったなすを加える", xs)).toBe(
      "切ったなす（3本）を加える",
    );
  });

  it("まとまりの外に同じ名前の材料があっても、まとまりの中身は書き足す", () => {
    const xs = [
      ing("【A】しょうゆ", "大さじ1"),
      ing("【A】みりん", "大さじ2"),
      ing("しょうゆ", "少々"),
    ];
    expect(stepWithAmounts("Aを加え、しょうゆで味を調える", xs)).toBe(
      "A（しょうゆ 大さじ1・みりん 大さじ2）を加え、しょうゆ（少々）で味を調える",
    );
  });

  it("閉じていないかっこの後は、ふつうにかっこで添える", () => {
    expect(
      stepWithAmounts("鍋に(水を入れ、塩を加える", [ing("塩", "少々")]),
    ).toBe("鍋に(水を入れ、塩（少々）を加える");
  });

  describe("手順で短く呼ぶ肉（豚肉・鶏肉・牛肉・ひき肉）", () => {
    it("その種類の材料が1つだけなら、同じものと見なす", () => {
      expect(
        stepWithAmounts("豚肉に塩をふる", [ing("豚小間切れ肉", "150g")]),
      ).toBe("豚肉（150g）に塩をふる");
      expect(stepWithAmounts("鶏肉を焼く", [ing("鶏もも肉", "1枚")])).toBe(
        "鶏肉（1枚）を焼く",
      );
      expect(
        stepWithAmounts("ひき肉を炒める", [ing("合いびき肉", "200g")]),
      ).toBe("ひき肉（200g）を炒める");
      expect(
        stepWithAmounts("牛肉を加える", [ing("牛こま切れ肉", "200g")]),
      ).toBe("牛肉（200g）を加える");
    });
    it("肉ではないもの（鶏がらスープの素・鶏卵・豚骨スープ・牛蒡）は肉と見なさず、数にも入れない", () => {
      for (const [name, step] of [
        ["鶏がらスープの素", "鶏肉を切る"],
        ["鶏卵", "鶏肉を切る"],
        ["とりがらスープ", "とり肉を切る"],
        ["豚骨スープ", "豚肉を焼く"],
        ["牛蒡", "牛肉を炒める"],
      ] as const)
        expect(stepWithAmounts(step, [ing(name, "小さじ1")])).toBe(step);
      // 鶏もも肉 と 鶏がらスープの素 があっても、鶏肉は鶏もも肉
      expect(
        stepWithAmounts("鶏肉を切る", [
          ing("鶏もも肉", "1枚"),
          ing("鶏がらスープの素", "小さじ1"),
        ]),
      ).toBe("鶏肉（1枚）を切る");
    });
    it("2つ以上あるとき・肉ではないもの（牛乳）は添えない", () => {
      const two = [ing("豚バラ肉", "100g"), ing("豚ロース", "2枚")];
      expect(stepWithAmounts("豚肉を焼く", two)).toBe("豚肉を焼く");
      expect(stepWithAmounts("牛肉を加える", [ing("牛乳", "200ml")])).toBe(
        "牛肉を加える",
      );
    });
  });

  it("once: 同じ材料には最初の手順でだけ添える。まとまりの中身は使う手順でも出す", () => {
    const xs = [
      ing("なす", "3本"),
      ing("にんにく", "1かけ"),
      ing("【合わせ調味料】しょうゆ", "小さじ2"),
      ing("【合わせ調味料】酒", "大さじ2"),
    ];
    const steps = [
      "合わせ調味料の材料（しょうゆ、酒）を混ぜる",
      "なすを切る",
      "切ったなすを焼き、にんにくを刻む",
      "にんにくを加える",
      "合わせ調味料を加える",
    ];
    expect(stepsWithAmounts(steps, xs, { once: true })).toEqual([
      "合わせ調味料の材料（しょうゆ 小さじ2、酒 大さじ2）を混ぜる",
      "なす（3本）を切る",
      "切ったなすを焼き、にんにく（1かけ）を刻む",
      "にんにくを加える",
      "合わせ調味料（しょうゆ 小さじ2・酒 大さじ2）を加える",
    ]);
    // 料理モード（once なし）は毎回
    expect(stepsWithAmounts(steps, xs)[2]).toBe(
      "切ったなす（3本）を焼き、にんにく（1かけ）を刻む",
    );
  });
});
