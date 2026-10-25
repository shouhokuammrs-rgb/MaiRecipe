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

/** 送られた写真が JPEG の base64 でない（読む前に止める） */
export class PhotoInvalid extends Error {}
/** Gemini が写真を読まなかった（書き写しすぎ・安全・長すぎ・形式など。待っても同じ） */
export class PhotoUnreadable extends Error {}

/** base64 に使える字（A-Z a-z 0-9 + / =）だけ true */
const B64 = new Uint8Array(256);
for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=")
  B64[ch.charCodeAt(0)] = 1;
const JPEG_HEAD = [47, 57, 106, 47]; // "/9j/"

/**
 * 写真を見せて読ませる（料理本のページ）。写真は画面で縮めた JPEG の base64 の文字を、
 * 受け取ったまま Gemini への依頼の中に流し込む（文字に直したり、JSON を作り直したりしない。
 * 無料プランの CPU 10ms を守るため。DEC-008）。流しながら1字ずつ base64 の字かを確かめる
 * （JSON の中に別の値を差し込まれないように）
 */
export async function runGeminiImage(
  env: GeminiEnv,
  model: string,
  prompt: string,
  photo: { body: ReadableStream<Uint8Array>; length: number },
  maxTokens: number,
): Promise<string> {
  const key = env.GEMINI_API_KEY;
  if (!key) throw new AiUnavailable("Gemini の鍵がありません");
  const enc = new TextEncoder();
  const head = enc.encode(
    '{"contents":[{"parts":[{"inline_data":{"mime_type":"image/jpeg","data":"',
  );
  const tail = enc.encode(
    `"}},{"text":${JSON.stringify(prompt)}}]}],"generationConfig":${JSON.stringify(
      {
        temperature: 0.1,
        maxOutputTokens: maxTokens,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingLevel: "low" },
      },
    )}}`,
  );
  const { readable, writable } = new FixedLengthStream(
    head.length + photo.length + tail.length,
  );
  let invalid: Error | null = null;
  const pump = (async () => {
    const w = writable.getWriter();
    const r = photo.body.getReader();
    try {
      await w.write(head);
      let seen = 0;
      for (;;) {
        const { done, value } = await r.read();
        if (done) break;
        for (let k = 0; k < value.length; k++) {
          const b = value[k]!;
          const at = seen + k;
          if (!B64[b] || (at < 4 && b !== JPEG_HEAD[at]))
            throw new PhotoInvalid("JPEG の写真だけ読めます");
        }
        seen += value.length;
        if (seen > photo.length)
          throw new PhotoInvalid("写真の大きさが合いません");
        await w.write(value);
      }
      if (seen !== photo.length || seen < 4)
        throw new PhotoInvalid("写真の大きさが合いません");
      await w.write(tail);
      await w.close();
    } catch (e) {
      invalid =
        e instanceof PhotoInvalid
          ? e
          : new PhotoInvalid("写真を受け取れませんでした");
      await w.abort(invalid).catch(() => {});
      await r.cancel().catch(() => {});
    }
  })();
  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: readable,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    await pump;
    if (invalid) throw invalid;
    const timeout = (e as Error)?.name === "TimeoutError";
    throw new AiUnavailable(
      timeout
        ? "写真を読むのに時間がかかりすぎました"
        : "Gemini につながりませんでした",
    );
  }
  await pump;
  if (invalid) throw invalid;
  if (res.status === 429) throw await quotaError(res);
  if (!res.ok) {
    const msg = `Gemini がエラーを返しました（${res.status}）`;
    if (res.status >= 500) throw new GeminiTemporary(msg);
    // 写真が読めない形式など（待っても同じ）
    throw new PhotoUnreadable(msg);
  }
  const body = (await res.json().catch(() => null)) as {
    candidates?: { finishReason?: string }[];
  } | null;
  const finish = body?.candidates?.[0]?.finishReason;
  // 書き写しすぎ（RECITATION）・安全・長すぎなどは、やり直しても同じなので「読めなかった」
  if (finish && finish !== "STOP")
    throw new PhotoUnreadable(`写真を読めませんでした（${finish}）`);
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
