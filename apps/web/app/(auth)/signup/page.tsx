import type { Metadata } from "next";
import Link from "next/link";

import { SignupForm } from "@/components/auth/signup-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "新規登録" };

export default function SignupPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>新規登録</CardTitle>
        <CardDescription>
          登録後、確認メールが届きます。メール内のリンクを開くと利用を開始できます。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SignupForm />
        <p className="text-muted-foreground text-center text-sm">
          すでにアカウントをお持ちの方は{" "}
          <Link href="/login" className="text-foreground underline">
            ログイン
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
