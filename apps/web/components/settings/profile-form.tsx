"use client";

import { useActionState } from "react";

import { updateProfile, type ProfileFormState } from "@/app/(app)/settings/actions";
import { FormMessage } from "@/components/auth/form-message";
import { SubmitButton } from "@/components/auth/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/auth/validation";

type Props = {
  displayName: string;
  email: string;
};

export function ProfileForm({ displayName, email }: Props) {
  const [state, formAction] = useActionState<ProfileFormState, FormData>(updateProfile, {});

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="email">メールアドレス</Label>
        <Input id="email" value={email} readOnly disabled />
      </div>
      <div className="space-y-2">
        <Label htmlFor="displayName">表示名</Label>
        <Input
          id="displayName"
          name="displayName"
          defaultValue={displayName}
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          autoComplete="nickname"
          required
        />
      </div>
      <FormMessage error={state.error} success={state.success} />
      <SubmitButton pendingText="保存中...">保存</SubmitButton>
    </form>
  );
}
