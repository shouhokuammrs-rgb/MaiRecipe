import type { Metadata } from "next";

import { UpdatePasswordForm } from "@/components/auth/update-password-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "新しいパスワードの設定" };

// このページはリカバリーセッション（メールのリンク経由）が必要。未ログインは middleware が /login へ戻す
export default function UpdatePasswordPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>新しいパスワードの設定</CardTitle>
        <CardDescription>新しいパスワードを2回入力してください。</CardDescription>
      </CardHeader>
      <CardContent>
        <UpdatePasswordForm />
      </CardContent>
    </Card>
  );
}
