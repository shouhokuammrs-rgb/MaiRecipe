import type { Metadata } from "next";
import Link from "next/link";

import { LoginForm } from "@/components/auth/login-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { safeNextPath } from "@/lib/auth/routes";

export const metadata: Metadata = { title: "ログイン" };

const ERROR_MESSAGES: Record<string, string> = {
  auth_link_invalid:
    "リンクが無効か期限切れです。もう一度メールを送信するか、ログインしてください。",
};

const INFO_MESSAGES: Record<string, string> = {
  signed_out: "ログアウトしました。",
};

type Props = {
  searchParams: Promise<{ next?: string; error?: string; message?: string }>;
};

export default async function LoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const initialError = params.error ? ERROR_MESSAGES[params.error] : undefined;
  const initialMessage = params.message ? INFO_MESSAGES[params.message] : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>ログイン</CardTitle>
        <CardDescription>登録済みのメールアドレスとパスワードを入力してください</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <LoginForm next={next} initialError={initialError} initialMessage={initialMessage} />
        <p className="text-muted-foreground text-center text-sm">
          アカウントをお持ちでない方は{" "}
          <Link href="/signup" className="text-foreground underline">
            新規登録
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
