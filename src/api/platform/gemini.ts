// Google の Gemini API を呼ぶ部品。YouTube の動画を URL のまま見せて読ませる（#36 / DEC-018）。
// 鍵（GEMINI_API_KEY）はここでだけ使う。呼ぶのは src/api/ai/ だけ。移行するときはここを差し替える。
import { AiQuotaExceeded, AiUnavailable } from "./workers-ai";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
/** 動画を見るのは時間がかかる（15分の動画で1〜2分）。それ以上は待たない */
const TIMEOUT_MS = 150_000;

export type GeminiEnv = { GEMINI_API_KEY?: string };

/** Gemini 側の一時的な失敗（500・503・524 など）。少し待ってやり直せば通ることが多い */
export class GeminiTemporary extends AiUnavailable {}

/** 1分あたりの上限（少し待てばまた使える） */
export class GeminiRateLimited extends AiQuotaExceeded {}

/** 429 の中身から、1日あたりか1分あたりかを見分ける（中身は quotaId だけ見る。鍵は出さない） */
async function quotaError(res: Response): Promise<AiQuotaExceeded> {
  const body = await res.text().catch(() => "");
  return /PerDay/i.test(body)
    ? new AiQuotaExceeded("Gemini の今日の無料枠を使い切りました")
    : new GeminiRateLimited(
        "Gemini の1分あたりの無料枠に当たりました。少し待つとまた使えます",
      );
}

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
  if (res.status === 429) throw await quotaError(res);
  if (!res.ok) {
    // 鍵や中身はログに出さない。状態の番号だけ
    const msg = `Gemini がエラーを返しました（${res.status}）`;
    throw res.status >= 500 ? new GeminiTemporary(msg) : new AiUnavailable(msg);
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

/**
 * 写真を見せて読ませる（料理本のページ）。写真は画面で縮めた JPEG の base64 を、そのまま渡す
 * （ここでは画像の中身を触らない・変換しない。DEC-008）
 */
export async function runGeminiImage(
  env: GeminiEnv,
  model: string,
  prompt: string,
  jpegBase64: string,
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
              { inline_data: { mime_type: "image/jpeg", data: jpegBase64 } },
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: maxTokens,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingLevel: "low" },
        },
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    const timeout = (e as Error)?.name === "TimeoutError";
    throw new AiUnavailable(
      timeout
        ? "写真を読むのに時間がかかりすぎました"
        : "Gemini につながりませんでした",
    );
  }
  if (res.status === 429) throw await quotaError(res);
  if (!res.ok) {
    const msg = `Gemini がエラーを返しました（${res.status}）`;
    throw res.status >= 500 ? new GeminiTemporary(msg) : new AiUnavailable(msg);
  }
  const body = (await res.json().catch(() => null)) as {
    candidates?: { finishReason?: string }[];
  } | null;
  const finish = body?.candidates?.[0]?.finishReason;
  if (finish && finish !== "STOP")
    throw new AiUnavailable(`写真を読めませんでした（${finish}）`);
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
  /** 待つ時間（料理中は短く） */
  timeoutMs = 12_000,
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
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new AiUnavailable(String((e as Error)?.message ?? e));
  }
  if (res.status === 429) throw await quotaError(res);
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
