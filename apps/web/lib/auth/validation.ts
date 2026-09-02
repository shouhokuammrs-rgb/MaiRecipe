/**
 * 認証フォームのバリデーション（サーバー側で使用。ユニットテスト対象）
 */

export const PASSWORD_MIN_LENGTH = 8;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email: string): string | null {
  const v = email.trim();
  if (!v) return "メールアドレスを入力してください";
  if (!EMAIL_RE.test(v)) return "メールアドレスの形式が正しくありません";
  return null;
}

export function validatePassword(password: string): string | null {
  if (!password) return "パスワードを入力してください";
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `パスワードは${PASSWORD_MIN_LENGTH}文字以上で入力してください`;
  }
  return null;
}

export function validatePasswordConfirmation(
  password: string,
  confirmation: string,
): string | null {
  if (password !== confirmation) return "パスワードが一致しません";
  return null;
}

export const DISPLAY_NAME_MAX_LENGTH = 50;

export function validateDisplayName(name: string): string | null {
  const v = name.trim();
  if (!v) return "表示名を入力してください";
  if (v.length > DISPLAY_NAME_MAX_LENGTH) {
    return `表示名は${DISPLAY_NAME_MAX_LENGTH}文字以内で入力してください`;
  }
  return null;
}
