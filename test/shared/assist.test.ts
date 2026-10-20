import { describe, expect, it } from "vitest";
import {
  assistInputSchema,
  buildAssistPrompt,
  measureAnswer,
  parseAssistReply,
  parseQuick,
  wakeQuestion,
} from "../../src/shared/assist";

describe("parseQuick（その場ですぐ動く言葉）", () => {
  it.each([
    ["次", { kind: "next", read: false }],
    ["次読んで", { kind: "next", read: true }],
    ["つぎを読んで", { kind: "next", read: true }],
    ["戻って", { kind: "prev", read: false }],
    ["前読んで", { kind: "prev", read: true }],
    ["もう一回", { kind: "repeat" }],
    ["材料", { kind: "ingredients" }],
    ["タイマー", { kind: "timer" }],
    [
      "5分のタイマーかけて",
      { kind: "timer", timer: { label: "5分", seconds: 300 } },
    ],
    ["タイマー3分", { kind: "timer", timer: { label: "3分", seconds: 180 } }],
    ["手順3", { kind: "goto", step: 3 }],
    ["3番目の手順", { kind: "goto", step: 3 }],
  ] as const)("「%s」", (text, action) => {
    expect(parseQuick(text)).toEqual(action);
  });
  it("文や会話では動かない", () => {
    expect(parseQuick("次に肉を焼く")).toBeNull();
    expect(parseQuick("砂糖大さじ1って小さじ何杯")).toBeNull();
  });
});

describe("wakeQuestion（「ねえ」から始まる相談）", () => {
  it("呼びかけを外して質問だけ返す", () => {
    expect(wakeQuestion("ねえ砂糖大さじ1って小さじ何杯")).toBe(
      "砂糖大さじ1って小さじ何杯",
    );
    expect(wakeQuestion("ねぇ、焦げそうなんだけど")).toBe("焦げそうなんだけど");
    expect(wakeQuestion("アシスタント 代わりになるものは")).toBe(
      "代わりになるものは",
    );
  });
  it("呼びかけが無い・中身が無いときは null", () => {
    expect(wakeQuestion("砂糖を入れる")).toBeNull();
    expect(wakeQuestion("ねえ")).toBeNull();
  });
});

describe("measureAnswer（計量の換算は AI なしで）", () => {
  it.each([
    ["砂糖大さじ1って小さじ何杯", "大さじ1は小さじ3杯です（15ml）。"],
    ["大さじ2は何ml", "大さじ2は30mlです。"],
    ["小さじ1と1/2は大さじ何杯", "小さじ1と1/2は大さじ1/2杯です（7.5ml）。"],
    ["1カップって大さじいくつ", "1カップは大さじ13と1/3杯です（200ml）。"],
    ["大さじ半分は小さじ何杯", "大さじ1/2は小さじ1と1/2杯です（7.5ml）。"],
    ["50mlは大さじ何杯", "50mlは大さじ3と1/3杯です。"],
  ])("「%s」", (q, a) => {
    expect(measureAnswer(q)).toBe(a);
  });
  it.each([
    ["大さじ1/2は小さじ何杯？", "大さじ1/2は小さじ1と1/2杯です（7.5ml）。"],
    ["小さじ1/2は何ml", "小さじ1/2は2.5mlです。"],
    ["大さじ1杯半は小さじ何杯", "大さじ1と1/2は小さじ4と1/2杯です（22.5ml）。"],
    ["大さじ1は何mlで小さじだと", "大さじ1は15mlです。"],
  ])("分数・聞かれた単位を正しく「%s」", (q, a) => {
    expect(measureAnswer(q)).toBe(a);
  });
  it("量が2つ以上ある質問は AI に任せる（取り違えない）", () => {
    expect(measureAnswer("大さじ3と小さじ1は何ml？")).toBeNull();
    expect(measureAnswer("小さじ1しかないけど、大さじ1は何杯分？")).toBeNull();
  });
  it("重さ（g）や、換算でない質問は AI に任せる", () => {
    expect(measureAnswer("砂糖大さじ1って何グラム")).toBeNull();
    expect(measureAnswer("大さじ1入れていい？")).toBeNull();
    expect(measureAnswer("焦げそう")).toBeNull();
  });
});

describe("AI への頼み方と返事", () => {
  const recipe = {
    title: "ダミーの煮物",
    ingredients: [
      { name: "大根", amount: "1/2本" },
      { name: "しょうゆ", amount: "大さじ2" },
    ],
    steps: ["大根を切る", "10分煮る"],
  };
  it("今のレシピ・今の手順・直前のやりとりを渡す", () => {
    const { system, user } = buildAssistPrompt({
      ...recipe,
      stepIndex: 1,
      history: [
        { role: "user", text: "前の質問" },
        { role: "assistant", text: "前の答え" },
      ],
      question: "落とし蓋がない",
    });
    expect(system).toContain("JSON");
    expect(user).toContain("ダミーの煮物");
    expect(user).toContain("しょうゆ 大さじ2");
    expect(user).toContain("今の手順：2. 10分煮る");
    expect(user).toContain("前の答え");
    expect(user).toContain("落とし蓋がない");
  });
  it("返事の JSON から答えと動き（タイマー・手順）を読む", () => {
    expect(
      parseAssistReply(
        '{"answer":"3分のタイマーをかけます。","action":{"type":"timer","seconds":180,"label":"3分"}}',
      ),
    ).toEqual({
      answer: "3分のタイマーをかけます。",
      action: { type: "timer", seconds: 180, label: "3分" },
    });
    expect(
      parseAssistReply(
        '{"answer":"手順3に進みます","action":{"type":"step","number":3}}',
      ),
    ).toEqual({
      answer: "手順3に進みます",
      action: { type: "step", number: 3 },
    });
  });
  it("JSON でなければ文をそのまま答えにし、おかしな動きは捨てる", () => {
    expect(parseAssistReply("アルミホイルで代わりになります。")).toEqual({
      answer: "アルミホイルで代わりになります。",
      action: null,
    });
    expect(
      parseAssistReply(
        '{"answer":"はい","action":{"type":"timer","seconds":-5}}',
      ),
    ).toEqual({ answer: "はい", action: null });
    expect(parseAssistReply("")).toBeNull();
    // 途中で切れた JSON は答えにしない（記号ごと読み上げない）
    expect(parseAssistReply('{"answer":"火を弱めて')).toBeNull();
  });
  it("入力の上限", () => {
    const ok = assistInputSchema.safeParse({
      recipeId: "r1",
      stepIndex: 0,
      question: "あ",
      history: [],
    });
    expect(ok.success).toBe(true);
    expect(
      assistInputSchema.safeParse({
        recipeId: "r1",
        stepIndex: 0,
        question: "あ".repeat(301),
      }).success,
    ).toBe(false);
  });
});
