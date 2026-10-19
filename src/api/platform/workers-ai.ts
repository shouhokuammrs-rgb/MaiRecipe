// Cloudflare Workers AI を呼ぶ部品（ai バインディング・鍵は要らない）。
// 呼ぶのは src/api/ai/ だけ。移行するときはここを差し替える。

/** Workers AI の入り口（型は最小限。env.AI.run だけ使う） */
export type WorkersAiBinding = {
  run: (model: string, input: Record<string, unknown>) => Promise<unknown>;
};

export class AiUnavailable extends Error {}
export class AiQuotaExceeded extends Error {}

/** 返事の形がモデルで違うので、文字の部分を探して取り出す */
export function extractAiText(res: unknown): string {
  if (typeof res === "string") return res;
  if (!res || typeof res !== "object") return "";
  const r = res as Record<string, unknown>;
  if (typeof r.response === "string") return r.response;
  // OpenAI の chat 形式
  const choices = r.choices as
    { message?: { content?: unknown } }[] | undefined;
  const content = choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  // OpenAI の Responses 形式（output[].content[].text）
  const output = r.output as
    | { type?: string; content?: { type?: string; text?: unknown }[] }[]
    | undefined;
  if (Array.isArray(output)) {
    const texts: string[] = [];
    for (const o of output) {
      if (o.type && o.type !== "message") continue;
      for (const c of o.content ?? [])
        if (typeof c.text === "string") texts.push(c.text);
    }
    if (texts.length) return texts.join("\n");
  }
  if (typeof r.output_text === "string") return r.output_text;
  return "";
}

export async function runWorkersAi(
  ai: WorkersAiBinding | undefined,
  model: string,
  system: string,
  user: string,
  maxTokens: number,
): Promise<string> {
  if (!ai) throw new AiUnavailable("AI が使えない設定です");
  let res: unknown;
  try {
    res = await ai.run(model, {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: maxTokens,
      temperature: 0.1,
    });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    // 無料枠（1日 10,000 ニューロン）を使い切ったとき
    if (/neuron|quota|limit|429|exceeded/i.test(msg))
      throw new AiQuotaExceeded(msg);
    throw new AiUnavailable(msg);
  }
  return extractAiText(res);
}
