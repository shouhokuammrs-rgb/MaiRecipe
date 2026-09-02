import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ProfileForm } from "@/components/settings/profile-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "プロフィール設定" };

export default async function ProfileSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-xl font-bold">プロフィール設定</h1>
      <Card>
        <CardHeader>
          <CardTitle>表示名</CardTitle>
          <CardDescription>ヘッダーなどに表示される名前です。</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm displayName={profile?.display_name ?? ""} email={user.email ?? ""} />
        </CardContent>
      </Card>
    </div>
  );
}
