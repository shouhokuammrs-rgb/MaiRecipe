import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { PageTitle, SecondaryButton } from "@/components/common";
import { authClient } from "@/lib/auth-client";

export function Settings() {
  const session = authClient.useSession();
  const nav = useNavigate();
  const qc = useQueryClient();
  const user = session.data?.user;

  const logout = async () => {
    await authClient.signOut();
    qc.clear();
    nav("/login", { replace: true });
  };

  return (
    <>
      <PageTitle>設定</PageTitle>
      <div className="flex flex-col gap-5 px-5 pt-1 pb-8">
        <section className="flex flex-col gap-1.5">
          <h2 className="text-[13px] font-bold text-sub">アカウント</h2>
          <dl className="rounded-2xl border border-line-soft bg-card text-sm">
            <div className="flex justify-between gap-3 border-b border-[#f3eee7] p-3.5">
              <dt>名前</dt>
              <dd className="truncate text-[#4a433c]">{user?.name ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-3 p-3.5">
              <dt>メール</dt>
              <dd className="truncate text-[#4a433c]">{user?.email ?? "—"}</dd>
            </div>
          </dl>
        </section>

        <section className="flex flex-col gap-1.5">
          <h2 className="text-[13px] font-bold text-sub">AI の使い方</h2>
          <div className="rounded-2xl border border-dashed border-field bg-card p-3.5 text-sm leading-7 text-[#4a433c]">
            今は AI を使っていません（取り込み・検索・買い物リストはすべて AI
            なしで動きます）。 「メモをレシピに反映」「AI
            で読み直す」は次のマイルストーン（M4）で、自分の API
            キーで使えるようにします。
          </div>
        </section>

        <section className="flex flex-col gap-1.5">
          <h2 className="text-[13px] font-bold text-sub">いっしょに使う人</h2>
          <div className="rounded-2xl border border-dashed border-field bg-card p-3.5 text-sm leading-7 text-[#4a433c]">
            パートナーを招待して2人で編集する機能は M5 で追加します。
          </div>
        </section>

        <SecondaryButton onClick={() => void logout()} className="text-danger">
          ログアウト
        </SecondaryButton>
      </div>
    </>
  );
}
