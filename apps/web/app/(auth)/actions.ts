"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { safeNextPath } from "@/lib/auth/routes";
import {
  validateDisplayName,
  validateEmail,
  validatePassword,
  validatePasswordConfirmation,
} from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/server";

export type AuthFormState = {
  error?: string;
  success?: string;
};

/** メールに埋め込むリダイレクト先のオリジン（Vercel / ローカル両対応） */
async function getOrigin(): Promise<string> {
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

function field(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

export async function signUp(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = field(formData, "email").trim();
  const password = field(formData, "password");
  const passwordConfirmation = field(formData, "passwordConfirmation");
  const displayName = field(formData, "displayName").trim();

  const error =
    validateDisplayName(displayName) ??
    validateEmail(email) ??
    validatePassword(password) ??
    validatePasswordConfirmation(password, passwordConfirmation);
  if (error) return { error };

  const supabase = await createClient();
  const origin = await getOrigin();

  const { data, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${origin}/auth/confirm?next=/`,
      data: { display_name: displayName },
    },
  });

  if (signUpError) {
    return { error: toJapaneseAuthError(signUpError.message) };
  }

  // メール確認が有効な場合、既存メールでも identities が空で返る（列挙対策）
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    return {
      success:
        "このメールアドレスは既に登録されています。ログインするか、パスワードをリセットしてください。",
    };
  }

  return {
    success: `${email} に確認メールを送信しました。メール内のリンクを開いて登録を完了してください。`,
  };
}

export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = field(formData, "email").trim();
  const password = field(formData, "password");
  const next = safeNextPath(field(formData, "next"));

  const error = validateEmail(email) ?? (password ? null : "パスワードを入力してください");
  if (error) return { error };

  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

  if (signInError) {
    return { error: toJapaneseAuthError(signInError.message) };
  }

  redirect(next);
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function requestPasswordReset(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = field(formData, "email").trim();
  const error = validateEmail(email);
  if (error) return { error };

  const supabase = await createClient();
  const origin = await getOrigin();

  const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/confirm?next=/update-password`,
  });

  // メールアドレスの存在有無を漏らさないため、レート制限以外は常に成功扱い
  if (resetError && /rate limit/i.test(resetError.message)) {
    return { error: "送信回数の上限に達しました。しばらく待ってから再度お試しください。" };
  }

  return {
    success: `${email} 宛にパスワード再設定用のメールを送信しました（登録済みの場合）。`,
  };
}

export async function updatePassword(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const password = field(formData, "password");
  const passwordConfirmation = field(formData, "passwordConfirmation");

  const error =
    validatePassword(password) ?? validatePasswordConfirmation(password, passwordConfirmation);
  if (error) return { error };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      error:
        "セッションが無効です。パスワード再設定メールのリンクをもう一度開くか、再度ログインしてください。",
    };
  }

  const { error: updateError } = await supabase.auth.updateUser({ password });
  if (updateError) {
    return { error: toJapaneseAuthError(updateError.message) };
  }

  redirect("/?message=password_updated");
}

/** Supabase Auth の英語エラーを日本語に寄せる（未知のものはそのまま返す） */
function toJapaneseAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) {
    return "メールアドレスまたはパスワードが正しくありません";
  }
  if (m.includes("email not confirmed")) {
    return "メールアドレスの確認が完了していません。受信箱の確認メールを開いてください";
  }
  if (m.includes("user already registered")) {
    return "このメールアドレスは既に登録されています";
  }
  if (m.includes("password should be at least")) {
    return "パスワードが短すぎます";
  }
  if (m.includes("new password should be different")) {
    return "新しいパスワードは現在のパスワードと異なるものにしてください";
  }
  if (m.includes("rate limit") || m.includes("too many requests")) {
    return "リクエストが多すぎます。しばらく待ってから再度お試しください";
  }
  if (m.includes("signups not allowed")) {
    return "現在新規登録を受け付けていません";
  }
  return `エラーが発生しました: ${message}`;
}
