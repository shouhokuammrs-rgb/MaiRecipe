// Google の Gemini API を呼ぶ部品。YouTube の動画を URL のまま見せて読ませる（#36 / DEC-018）。
// 鍵（GEMINI_API_KEY）はここでだけ使う。呼ぶのは src/api/ai/ だけ。移行するときはここを差し替える。
import { AiQuotaExceeded, AiUnavailable } from "./workers-ai";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
/** 動画を見るのは時間がかかる（10分の動画で30秒〜1分）。それ以上は待たない */
const TIMEOUT_MS = 90_000;

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
            parts: [{ file_data: { file_uri: videoUrl } }, { text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: maxTokens,
          responseMimeType: "application/json",
          // 料理の手順を読むだけなので、画は粗くてよい（使う量が3分の1ほどになる）
          mediaResolution: "MEDIA_RESOLUTION_LOW",
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new AiUnavailable(String((e as Error)?.message ?? e));
  }
  if (res.status === 429)
    throw new AiQuotaExceeded(
      "Gemini の無料枠の上限（1分あたり・1日あたり）に当たりました",
    );
  if (!res.ok) {
    // 鍵や中身はログに出さない。状態の番号だけ
    throw new AiUnavailable(`Gemini がエラーを返しました（${res.status}）`);
  }
  return extractGeminiText(await res.json().catch(() => null));
}
