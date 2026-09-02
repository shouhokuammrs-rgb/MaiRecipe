"use server";

import { revalidatePath } from "next/cache";

import { validateDisplayName } from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/server";

export type ProfileFormState = {
  error?: string;
  success?: string;
};

export async function updateProfile(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const raw = formData.get("displayName");
  const displayName = (typeof raw === "string" ? raw : "").trim();

  const error = validateDisplayName(displayName);
  if (error) return { error };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "ログインが必要です" };

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ display_name: displayName })
    .eq("id", user.id);

  if (updateError) {
    return { error: `更新に失敗しました: ${updateError.message}` };
  }

  // ヘッダーの表示名など、レイアウト配下を再描画
  revalidatePath("/", "layout");
  return { success: "表示名を更新しました" };
}
