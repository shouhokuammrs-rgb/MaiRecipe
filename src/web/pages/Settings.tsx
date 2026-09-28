import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { apiClient } from "@/api/client";
import {
  ErrorState,
  Loading,
  PageTitle,
  SecondaryButton,
} from "@/components/common";
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

        <ImportReports />

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

/** 取り込みで「読めなかった URL を報告」したもの。後で読み取りを直すための控え */
function ImportReports() {
  const q = useQuery({
    queryKey: ["import-reports"],
    queryFn: apiClient.importReports,
  });
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="text-[13px] font-bold text-sub">
        読めなかった URL の報告
      </h2>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={() => void q.refetch()} />
      ) : q.data.reports.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-field bg-card p-3.5 text-sm leading-7 text-sub">
          まだありません。取り込みで読めなかったときに「読めなかった URL
          を報告」を押すと、ここに残ります。
        </div>
      ) : (
        <ul className="rounded-2xl border border-line-soft bg-card text-sm">
          {q.data.reports.map((r) => (
            <li
              key={r.url}
              className="flex flex-col gap-0.5 border-b border-[#f3eee7] p-3.5 last:border-b-0"
            >
              <a
                href={r.url}
                target="_blank"
                rel="noreferrer noopener"
                className="break-all text-accent underline"
              >
                {r.url}
              </a>
              <span className="text-xs text-sub">
                {new Date(r.createdAt).toLocaleDateString("ja-JP")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
