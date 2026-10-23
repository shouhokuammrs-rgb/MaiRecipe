import { describe, expect, it } from "vitest";
import { parseAiRecipe } from "../../src/shared/ai-read";
import { parseSceneTime } from "../../src/shared/scenes";
import { sceneUrl } from "../../src/shared/scene-url";

describe("parseSceneTime", () => {
  it.each([
    ["1:23", 83],
    ["01:02:03", 3723],
    ["0:05", 5],
    [42, 42],
    ["75", 75],
    ["1分23秒", 83],
  ])("%j → %s", (raw, n) => {
    expect(parseSceneTime(raw)).toBe(n);
  });
  it.each([[""], [null], ["abc"], [-1], ["1:99"], [999999]])(
    "読めなければ null（%j）",
    (raw) => {
      expect(parseSceneTime(raw)).toBeNull();
    },
  );
});

describe("sceneUrl", () => {
  it("YouTube の埋め込みを、その秒から始める", () => {
    expect(sceneUrl("https://www.youtube.com/watch?v=abcDEF12345", 83)).toBe(
      "https://www.youtube-nocookie.com/embed/abcDEF12345?rel=0&playsinline=1&start=83&autoplay=1",
    );
    expect(sceneUrl("https://example.com/x", 3)).toBeNull();
  });
});

describe("parseAiRecipe（手順の時刻）", () => {
  it("手順ごとの時刻を、空の手順を除いたあとの並びにそろえて返す", () => {
    const r = parseAiRecipe(
      '{"ingredients":[{"name":"卵"}],"steps":[{"text":"割る","at":"0:10"},{"text":""},"混ぜる",{"text":"焼く","at":"1:05"}]}',
    );
    expect(r?.steps).toEqual(["割る", "混ぜる", "焼く"]);
    expect(r?.stepTimes).toEqual([10, null, 65]);
  });
  it("時刻が1つも無ければ空の配列", () => {
    expect(
      parseAiRecipe('{"ingredients":[{"name":"卵"}],"steps":["割る"]}')
        ?.stepTimes,
    ).toEqual([]);
  });
});
