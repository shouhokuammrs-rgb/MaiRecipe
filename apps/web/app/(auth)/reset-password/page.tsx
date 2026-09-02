import type { Metadata } from "next";
import Link from "next/link";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "パスワード再設定" };

export default function ResetPasswordPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>パスワード再設定</CardTitle>
        <CardDescription>
          登録済みのメールアドレスを入力してください。再設定用のリンクをお送りします。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ResetPasswordForm />
        <p className="text-muted-foreground text-center text-sm">
          <Link href="/login" className="text-foreground underline">
            ログインに戻る
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
