import { describe, expect, it } from "vitest";
import { SHOP_SECTIONS } from "../../src/shared/constants";
import {
  canonicalName,
  isStapleCanonical,
  shopSection,
} from "../../src/shared/ingredients";
import {
  moveSection,
  resolveShopOrder,
  shopOrderSchema,
} from "../../src/shared/shop-order";

// 売り場の判定（DEC-032）。スクショで外れていたもの（カツオ・ネギ・椎茸・生米・塩昆布・薬味）を含む
const cases: Record<string, string[]> = {
  "野菜・果物": [
    "しめじ",
    "にんにく",
    "舞茸",
    "椎茸",
    "シイタケ",
    "ネギ",
    "万能ねぎ",
    "薬味",
    "ミョウガ",
    "大葉",
    "キャベツ",
    "ダイコン",
    "玉ねぎ",
    "トマト",
    "ミニトマト",
    "レモン",
    "りんご",
    "えのき",
    "生姜",
    "パクチー",
    "長芋",
    "枝豆",
  ],
  魚: [
    "カツオ",
    "鰹のたたき",
    "鮭",
    "塩鮭",
    "サバ",
    "ぶり",
    "えび",
    "むきエビ",
    "イカ",
    "あさり",
    "ほたて",
    "しらす",
    "マグロ",
    "刺身",
    "たらこ",
    "明太子",
  ],
  肉: [
    "鶏もも肉",
    "豚バラ肉",
    "合いびき肉",
    "牛こま切れ",
    "ベーコン",
    "ウインナー",
    "ささみ",
    "手羽先",
    "ハム",
  ],
  "卵・豆腐・乳製品": [
    "卵",
    "木綿豆腐",
    "絹ごし豆腐",
    "油揚げ",
    "厚揚げ",
    "納豆",
    "牛乳",
    "バター",
    "ピザ用チーズ",
    "ヨーグルト",
    "生クリーム",
    "こんにゃく",
    "ちくわ",
    "キムチ",
    "餃子の皮",
    "豆乳",
  ],
  調味料: [
    "醤油",
    "砂糖",
    "塩",
    "みりん",
    "酒",
    "鶏がらスープの素",
    "かつおだし",
    "顆粒だし",
    "コンソメ",
    "片栗粉",
    "パン粉",
    "ごま油",
    "オリーブオイル",
    "焼肉のたれ",
    "カレールウ",
    "チューブにんにく",
    "ラー油",
    "七味唐辛子",
    "白ごま",
    "水",
  ],
  "乾物・缶詰": [
    "塩昆布",
    "昆布",
    "焼きのり",
    "乾燥わかめ",
    "ひじき",
    "かつお節",
    "春雨",
    "ツナ缶",
    "サバ缶",
    "トマト缶",
    "干し椎茸",
    "切り干し大根",
    "高野豆腐",
  ],
  "米・パン・麺": [
    "生米",
    "米",
    "ご飯",
    "食パン",
    "うどん",
    "そば",
    "焼きそば麺",
    "スパゲッティ",
    "パスタ",
    "中華麺",
    "そうめん",
    "もち",
  ],
  冷凍食品: [
    "冷凍うどん",
    "冷凍えび",
    "冷凍ブロッコリー",
    "ミックスベジタブル",
    "アイスクリーム",
  ],
  飲み物: ["ジュース", "炭酸水", "紅茶", "麦茶"],
  その他: ["ラップ", "クッキングシート"],
};

describe("売り場の判定", () => {
  for (const [section, names] of Object.entries(cases)) {
    it(section, () => {
      const wrong = names
        .map((n) => [n, shopSection(n)] as const)
        .filter(([, got]) => got !== section);
      expect(wrong).toEqual([]);
    });
  }
});

describe("売り場の並び", () => {
  it("保存が無ければおすすめの並び（青果から）", () => {
    expect(resolveShopOrder(null)).toEqual([...SHOP_SECTIONS]);
    expect(resolveShopOrder(null)[0]).toBe("野菜・果物");
  });

  it("保存した並びを使う。知らない売り場は落とし、足りない売り場は差し込む", () => {
    const saved = ["肉", "野菜・果物", "なくなった売り場", "魚"];
    const got = resolveShopOrder(saved);
    // 保存した3つは保存した順のまま
    expect(got.filter((x) => ["肉", "野菜・果物", "魚"].includes(x))).toEqual([
      "肉",
      "野菜・果物",
      "魚",
    ]);
    expect(got).not.toContain("なくなった売り場");
    // 後から増えた売り場は、おすすめの並びで1つ前の売り場のすぐ後ろ
    const added = resolveShopOrder(
      SHOP_SECTIONS.filter((x) => x !== "冷凍食品"),
    );
    expect(added).toEqual([...SHOP_SECTIONS]);
    expect(new Set(got).size).toBe(SHOP_SECTIONS.length);
    expect(got).toHaveLength(SHOP_SECTIONS.length);
  });

  it("1つ上・下に動かす。端では動かない", () => {
    const o = [...SHOP_SECTIONS];
    expect(moveSection(o, "魚", -1).slice(0, 2)).toEqual(["魚", "野菜・果物"]);
    expect(moveSection(o, "野菜・果物", -1)).toEqual(o);
    expect(moveSection(o, "その他", 1)).toEqual(o);
  });

  it("保存できるのは全部の売り場を1回ずつ並べたものだけ", () => {
    expect(
      shopOrderSchema.safeParse({ order: [...SHOP_SECTIONS] }).success,
    ).toBe(true);
    expect(shopOrderSchema.safeParse({ order: null }).success).toBe(true);
    expect(shopOrderSchema.safeParse({ order: ["魚"] }).success).toBe(false);
    const dup = [...SHOP_SECTIONS];
    dup[1] = dup[0]!;
    expect(shopOrderSchema.safeParse({ order: dup }).success).toBe(false);
  });
});

// レビューで見つかった外れ（DEC-032）
describe("紛らわしい名前", () => {
  const more: [string, string][] = [
    ["スイカ", "野菜・果物"],
    ["タラの芽", "野菜・果物"],
    ["鶏の皮", "肉"],
    ["餃子の皮", "卵・豆腐・乳製品"],
    ["パンチェッタ", "肉"],
    ["ゆでだこ", "魚"],
    ["ごまだれ", "調味料"],
    ["グラニュー糖", "調味料"],
    ["三温糖", "調味料"],
    ["塩麹", "調味料"],
    ["マーガリン", "卵・豆腐・乳製品"],
    ["梅干し", "卵・豆腐・乳製品"],
    ["しらす干し", "魚"],
    ["紅しょうが", "卵・豆腐・乳製品"],
    ["ごぼう天", "卵・豆腐・乳製品"],
    ["だし巻き卵", "卵・豆腐・乳製品"],
    ["からし菜", "野菜・果物"],
    ["バニラエッセンス", "その他"],
    ["唐辛子", "調味料"],
  ];
  it.each(more)("%s → %s", (name, section) => {
    expect(shopSection(name)).toBe(section);
  });
});

describe("いつも家にある扱いの調味料は、売り場とは別に今までどおり", () => {
  it("決まった調味料だけ。売り場が調味料でも、買う物はいつも家にある扱いにしない", () => {
    for (const n of [
      "醤油",
      "砂糖",
      "塩",
      "みりん",
      "酒",
      "片栗粉",
      "ごま油",
      "水",
    ])
      expect(isStapleCanonical(canonicalName(n))).toBe(true);
    for (const n of [
      "パン粉",
      "白だし",
      "ウスターソース",
      "焼肉のたれ",
      "カレールウ",
      "はちみつ",
      "黒こしょう",
      "ラー油",
      "赤ワイン",
      "顆粒だし",
    ]) {
      expect(shopSection(n)).toBe("調味料");
      expect(isStapleCanonical(canonicalName(n))).toBe(false);
    }
  });

  it("名寄せは増やしていない（冷蔵庫に入っている名前とずれない）", () => {
    for (const n of ["ネギ", "椎茸", "シメジ", "エノキ", "舞茸"])
      expect(canonicalName(n)).toBe(n);
  });
});
