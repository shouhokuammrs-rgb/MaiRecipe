// Google の Gemini API を呼ぶ部品。YouTube の動画を URL のまま見せて読ませる（#36 / DEC-018）。
// 鍵（GEMINI_API_KEY）はここでだけ使う。呼ぶのは src/api/ai/ だけ。移行するときはここを差し替える。
import { AiQuotaExceeded, AiUnavailable } from "./workers-ai";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
/** 動画を見るのは時間がかかる（15分の動画で1〜2分）。それ以上は待たない */
const TIMEOUT_MS = 150_000;

export type GeminiEnv = { GEMINI_API_KEY?: string };

export function hasGemini(env: GeminiEnv): boolean {
  return Boolean(env.GEMINI_API_KEY);
}

/** 返事から文字の部分だけを取り出す（考えている途中の文は除く） */
export function extractGeminiText(res: unknown): string {
  const parts = (
    res as {
      candidates?: {
        content?: { parts?: { text?: unknown; thought?: boolean }[] };
      }[];
    }
  )?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("");
}

export async function runGeminiVideo(
  env: GeminiEnv,
  model: string,
  prompt: string,
  videoUrl: string,
  maxTokens: number,
): Promise<string> {
  const key = env.GEMINI_API_KEY;
  if (!key) throw new AiUnavailable("Gemini の鍵がありません");
  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                file_data: { file_uri: videoUrl },
                // 2秒に1コマで十分（手順はほぼ声で分かる）。長い動画でも時間内に読み終える
                videoMetadata: { fps: 0.5 },
              },
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: maxTokens,
          responseMimeType: "application/json",
          // 料理の手順を読むだけなので、画は粗くてよい（使う量が3分の1ほどになる）
          mediaResolution: "MEDIA_RESOLUTION_LOW",
          // 長い動画で考えすぎると、答えを書く前に上限に当たる。考える量は少なめに
          thinkingConfig: { thinkingLevel: "low" },
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    // 画面に出るので、決まった日本語にする（英語の生のエラーを出さない）
    const timeout = (e as Error)?.name === "TimeoutError";
    throw new AiUnavailable(
      timeout
        ? "動画を見るのに時間がかかりすぎました"
        : "Gemini につながりませんでした",
    );
  }
  if (res.status === 429)
    throw new AiQuotaExceeded(
      "Gemini の無料枠の上限（1分あたり・1日あたり）に当たりました",
    );
  if (!res.ok) {
    // 鍵や中身はログに出さない。状態の番号だけ
    throw new AiUnavailable(`Gemini がエラーを返しました（${res.status}）`);
  }
  const body = (await res.json().catch(() => null)) as {
    candidates?: { finishReason?: string }[];
  } | null;
  const finish = body?.candidates?.[0]?.finishReason;
  if (finish === "MAX_TOKENS")
    throw new AiUnavailable("動画が長く、答えが途中で切れました");
  if (finish && finish !== "STOP")
    throw new AiUnavailable(`動画を読めませんでした（${finish}）`);
  return extractGeminiText(body);
}

/** 文章だけで頼む（お料理アシスタント）。返事は JSON の文字 */
export async function runGeminiText(
  env: GeminiEnv,
  model: string,
  system: string,
  user: string,
  maxTokens: number,
  /** 考える量（少ないほど速い）。料理中の相談は minimal */
  thinkingLevel?: "minimal" | "low" | "medium" | "high",
): Promise<string> {
  const key = env.GEMINI_API_KEY;
  if (!key) throw new AiUnavailable("Gemini の鍵がありません");
  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: maxTokens,
          responseMimeType: "application/json",
          ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
        },
      }),
      // 料理中に待たせすぎない。遅ければ予備の AI に回す
      signal: AbortSignal.timeout(12_000),
    });
  } catch (e) {
    throw new AiUnavailable(String((e as Error)?.message ?? e));
  }
  if (res.status === 429)
    throw new AiQuotaExceeded(
      "Gemini の無料枠の上限（1分あたり・1日あたり）に当たりました",
    );
  if (!res.ok)
    throw new AiUnavailable(`Gemini がエラーを返しました（${res.status}）`);
  const body = (await res.json().catch(() => null)) as {
    candidates?: { finishReason?: string }[];
  } | null;
  // 長さの上限で切れた返事は使わない（予備の AI に回す）
  if (body?.candidates?.[0]?.finishReason === "MAX_TOKENS")
    throw new AiUnavailable("Gemini の返事が途中で切れました");
  return extractGeminiText(body);
}
