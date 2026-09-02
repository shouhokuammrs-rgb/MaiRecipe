"use client";

import { useActionState } from "react";

import { signUp, type AuthFormState } from "@/app/(auth)/actions";
import { FormMessage } from "@/components/auth/form-message";
import { SubmitButton } from "@/components/auth/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/validation";

export function SignupForm() {
  const [state, formAction] = useActionState<AuthFormState, FormData>(signUp, {});

  if (state.success) {
    return <FormMessage success={state.success} />;
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="displayName">表示名</Label>
        <Input id="displayName" name="displayName" autoComplete="nickname" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">メールアドレス</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">パスワード（{PASSWORD_MIN_LENGTH}文字以上）</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="passwordConfirmation">パスワード（確認）</Label>
        <Input
          id="passwordConfirmation"
          name="passwordConfirmation"
          type="password"
          autoComplete="new-password"
          required
        />
      </div>
      <FormMessage error={state.error} />
      <SubmitButton className="w-full" pendingText="登録中...">
        アカウントを作成
      </SubmitButton>
    </form>
  );
}
