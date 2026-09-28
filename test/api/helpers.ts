import { exports } from "cloudflare:workers";

const ORIGIN = "http://localhost";
let n = 0;

/** DEV_LOGIN のメール登録でユーザーを作り、Cookie ヘッダーを返す */
export async function signUp(name = "テスト"): Promise<string> {
  n += 1;
  const email = `user${Date.now()}-${n}@example.test`;
  const res = await exports.default.fetch(`${ORIGIN}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ email, password: "password-1234", name }),
  });
  if (res.status !== 200)
    throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
  const cookies = res.headers.getSetCookie().map((c) => c.split(";")[0]);
  return cookies.join("; ");
}

export async function api(
  cookie: string | null,
  path: string,
  init: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    raw?: BodyInit;
  } = {},
) {
  const headers: Record<string, string> = {
    origin: ORIGIN,
    ...(init.headers ?? {}),
  };
  if (cookie) headers.cookie = cookie;
  let body: BodyInit | undefined = init.raw;
  if (init.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  return exports.default.fetch(`${ORIGIN}/api${path}`, {
    method: init.method ?? "GET",
    headers,
    body,
  });
}

export const sampleRecipe = {
  title: "鶏むね肉の甘酢炒め",
  category: "主菜",
  genre: "中華",
  timeLabel: "20分",
  sourceUrl: "https://example.com/recipes/1",
  videoUrl: "https://youtu.be/abcDEF12345",
  origin: "import",
  ingredients: [
    { name: "鶏むね肉", amount: "300g" },
    { name: "たまねぎ", amount: "1個" },
    { name: "酢", amount: "大さじ 3" },
    { name: "砂糖", amount: "大さじ2" },
  ],
  steps: ["切る", "焼く", "絡める"],
};
