import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

/**
 * E2E 用 Supabase ヘルパー。
 * .env.local の service_role key で「メール確認済み」のテストユーザーを作成/削除する。
 * （メール確認を有効にしたままでも E2E を回せるようにするため）
 */

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `${name} が未設定です。apps/web/.env.local に Supabase の URL / anon key / service_role key を設定してください。`,
    );
  }
  return v;
}

export function createAdminClient(): SupabaseClient<Database> {
  return createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export function createAnonClient(): SupabaseClient<Database> {
  return createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export type TestUser = {
  id: string;
  email: string;
  password: string;
  displayName: string;
};

export const TEST_EMAIL_DOMAIN = "e2e.mairecipe.test";

export function uniqueEmail(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now()}-${rand}@${TEST_EMAIL_DOMAIN}`;
}

export async function createConfirmedUser(
  admin: SupabaseClient<Database>,
  prefix: string,
): Promise<TestUser> {
  const email = uniqueEmail(prefix);
  const password = `Pw-${Math.random().toString(36).slice(2, 10)}-e2e`;
  const displayName = `${prefix}-${Math.random().toString(36).slice(2, 6)}`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (error || !data.user) {
    throw new Error(`テストユーザー作成に失敗: ${error?.message ?? "unknown"}`);
  }
  return { id: data.user.id, email, password, displayName };
}

export async function deleteUser(admin: SupabaseClient<Database>, userId: string): Promise<void> {
  await admin.auth.admin.deleteUser(userId);
}

export async function findUserByEmail(
  admin: SupabaseClient<Database>,
  email: string,
): Promise<User | null> {
  // listUsers はページングされるので、テスト用メールは最近作成されたものとして先頭ページで探す
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

/** 認証済みユーザーの所属グループID（サインアップトリガーで作られる個人グループ） */
export async function getOwnGroupId(client: SupabaseClient<Database>): Promise<string> {
  const { data, error } = await client.from("group_members").select("group_id").limit(1).single();
  if (error || !data) {
    throw new Error(`group_members が取得できません: ${error?.message ?? "no row"}`);
  }
  return data.group_id;
}
