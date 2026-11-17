import { describe, expect, it } from "vitest";
import {
  FRIDGE_ZONES,
  fridgeZone,
  groupByZone,
  pantryPatchSchema,
} from "../../src/shared/pantry";

// 冷蔵庫の仕分け（DEC-033）：名前からどの室に入れるかを決める
const cases: Record<string, string[]> = {
  冷蔵室: [
    "卵",
    "木綿豆腐",
    "納豆",
    "ヨーグルト",
    "バター",
    "ピザ用チーズ",
    "油揚げ",
    "こんにゃく",
    "ちくわ",
    "キムチ",
    "ゆでうどん",
    "中華麺",
    "餃子の皮",
    "残りもの",
  ],
  チルド: [
    "鶏もも肉",
    "豚こま",
    "合いびき肉",
    "ベーコン",
    "ハム",
    "鮭",
    "カツオ",
    "刺身",
    "しらす",
    "明太子",
    "あさり",
  ],
  ドアポケット: [
    "牛乳",
    "豆乳",
    "麦茶",
    "ジュース",
    "白だし",
    "焼肉のたれ",
    "チューブにんにく",
  ],
  野菜室: [
    "キャベツ",
    "にんじん",
    "大根",
    "トマト",
    "きゅうり",
    "ほうれん草",
    "しめじ",
    "長ねぎ",
    "大葉",
    "レモン",
    "りんご",
    "もやし",
    "ブロッコリー",
  ],
  冷凍室: [
    "冷凍うどん",
    "冷凍えび",
    "ミックスベジタブル",
    "アイスクリーム",
    "冷凍ご飯",
  ],
  常温: [
    "じゃがいも",
    "玉ねぎ",
    "さつまいも",
    "かぼちゃ",
    "バナナ",
    "米",
    "食パン",
    "パスタ",
    "そうめん",
    "ツナ缶",
    "トマト缶",
    "乾燥わかめ",
    "塩昆布",
    "パン粉",
  ],
};

describe("冷蔵庫のどこに入れるか", () => {
  for (const [zone, names] of Object.entries(cases)) {
    it(zone, () => {
      const wrong = names
        .map((n) => [n, fridgeZone(n)] as const)
        .filter(([, z]) => z !== zone);
      expect(wrong).toEqual([]);
    });
  }

  it("室は冷蔵庫の上から順。常温は最後", () => {
    expect(FRIDGE_ZONES).toEqual([
      "冷蔵室",
      "チルド",
      "ドアポケット",
      "野菜室",
      "冷凍室",
      "常温",
    ]);
  });
});

describe("室ごとに分ける", () => {
  it("室の順に並べ、室の中は入ってきた順（期限の近い順）のまま。空の室も返す", () => {
    const items = [
      { name: "キャベツ", zone: "野菜室" as const },
      { name: "卵", zone: "冷蔵室" as const },
      { name: "にんじん", zone: "野菜室" as const },
    ];
    const g = groupByZone(items);
    expect(g.map((x) => x.zone)).toEqual([...FRIDGE_ZONES]);
    expect(
      g.find((x) => x.zone === "野菜室")!.items.map((i) => i.name),
    ).toEqual(["キャベツ", "にんじん"]);
    expect(g.find((x) => x.zone === "冷凍室")!.items).toEqual([]);
  });
});

describe("置き場所を直す", () => {
  it("室だけでも直せる。null で「おまかせ」に戻す。知らない室は弾く", () => {
    expect(pantryPatchSchema.safeParse({ zone: "冷凍室" }).success).toBe(true);
    expect(pantryPatchSchema.safeParse({ zone: null }).success).toBe(true);
    expect(pantryPatchSchema.safeParse({ zone: "物置" }).success).toBe(false);
  });
});
