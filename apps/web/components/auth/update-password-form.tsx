"use client";

import { useActionState } from "react";

import { updatePassword, type AuthFormState } from "@/app/(auth)/actions";
import { FormMessage } from "@/components/auth/form-message";
import { SubmitButton } from "@/components/auth/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/validation";

export function UpdatePasswordForm() {
  const [state, formAction] = useActionState<AuthFormState, FormData>(updatePassword, {});

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="password">新しいパスワード（{PASSWORD_MIN_LENGTH}文字以上）</Label>
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
        <Label htmlFor="passwordConfirmation">新しいパスワード（確認）</Label>
        <Input
          id="passwordConfirmation"
          name="passwordConfirmation"
          type="password"
          autoComplete="new-password"
          required
        />
      </div>
      <FormMessage error={state.error} />
      <SubmitButton className="w-full" pendingText="更新中...">
        パスワードを更新
      </SubmitButton>
    </form>
  );
}
