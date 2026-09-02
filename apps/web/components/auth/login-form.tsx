"use client";

import Link from "next/link";
import { useActionState } from "react";

import { signIn, type AuthFormState } from "@/app/(auth)/actions";
import { FormMessage } from "@/components/auth/form-message";
import { SubmitButton } from "@/components/auth/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  next: string;
  initialError?: string;
  initialMessage?: string;
};

export function LoginForm({ next, initialError, initialMessage }: Props) {
  const [state, formAction] = useActionState<AuthFormState, FormData>(signIn, {
    error: initialError,
    success: initialMessage,
  });

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
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
        <div className="flex items-center justify-between">
          <Label htmlFor="password">パスワード</Label>
          <Link href="/reset-password" className="text-muted-foreground text-xs underline">
            パスワードをお忘れですか？
          </Link>
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <FormMessage error={state.error} success={state.success} />
      <SubmitButton className="w-full" pendingText="ログイン中...">
        ログイン
      </SubmitButton>
    </form>
  );
}
