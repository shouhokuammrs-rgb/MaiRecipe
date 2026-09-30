import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";

const ORIGIN = "http://localhost";
let n = 0;

/** 名前とメールを指定して登録する（メールは省略可）。Cookie と小文字のメールを返す */
export async function signUpAs(name = "テスト", email?: string) {
  n += 1;
  const addr = email ?? `user${Date.now()}-${n}@example.test`;
  const res = await exports.default.fetch(`${ORIGIN}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ email: addr, password: "password-1234", name }),
  });
  if (res.status !== 200)
    throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
  const cookies = res.headers.getSetCookie().map((c) => c.split(";")[0]);
  return { cookie: cookies.join("; "), email: addr.toLowerCase() };
}

/** DEV_LOGIN のメール登録でユーザーを作り、Cookie ヘッダーを返す */
export async function signUp(name = "テスト"): Promise<string> {
  return (await signUpAs(name)).cookie;
}

/** テストだけで使う：Google で確認済みの状態にする（本番のコードには抜け道を作らない） */
export async function verifyEmail(email: string): Promise<void> {
  await env.DB.prepare("update user set email_verified = 1 where email = ?")
    .bind(email)
    .run();
}

/**
 * テストだけで使う：そのユーザーが今何個の group_members 行を持っているか（生の SQL）。
 * 競合したときに二重加入していないかを、API に無い形で直接確かめるため。
 */
export async function groupMembershipCount(email: string): Promise<number> {
  const row = await env.DB.prepare(
    `select count(*) as n from group_members gm
     join user u on u.id = gm.user_id
     where u.email = ?`,
  )
    .bind(email.toLowerCase())
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * テストだけで使う：買い物の印の値を直接読む（読み出す API はアプリに無いため）。
 * 無ければ null。
 */
export async function rawShoppingMark(
  email: string,
  key: string,
  kind: "home",
): Promise<boolean | null> {
  const row = await env.DB.prepare(
    `select sm.value as value from shopping_marks sm
     join group_members gm on gm.group_id = sm.group_id
     join user u on u.id = gm.user_id
     where u.email = ? and sm.key = ? and sm.kind = ?`,
  )
    .bind(email.toLowerCase(), key, kind)
    .first<{ value: number }>();
  return row ? Boolean(row.value) : null;
}

/**
 * テストだけで使う：そのユーザーのグループに献立の行を直接入れる（API では過ぎた日に入れられないため）。
 * position を省くと列そのものを書かない（position 列が無かった頃と同じ形の INSERT）。行の id を返す。
 */
export async function insertPlanRaw(
  email: string,
  p: {
    date: string;
    meal: "breakfast" | "lunch" | "dinner";
    recipeId: string;
    position?: number;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  const withPosition = p.position !== undefined;
  await env.DB.prepare(
    `insert into meal_plans (id, group_id, date, meal, recipe_id${withPosition ? ", position" : ""})
     select ?, gm.group_id, ?, ?, ?${withPosition ? ", ?" : ""}
     from group_members gm join user u on u.id = gm.user_id
     where u.email = ?`,
  )
    .bind(
      id,
      p.date,
      p.meal,
      p.recipeId,
      ...(withPosition ? [p.position] : []),
      email.toLowerCase(),
    )
    .run();
  return id;
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
