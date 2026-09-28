import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "@/api/client";
import {
  ErrorState,
  Loading,
  PageTitle,
  PrimaryButton,
  SecondaryButton,
} from "@/components/common";
import { InviteBanner } from "@/components/InviteBanner";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

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

        <GroupSection />

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
                className="flex min-h-11 items-center break-all text-accent underline"
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

/** 「いっしょに使う人」。メンバー一覧・招待中・招待フォーム・取り消し */
function GroupSection() {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const revertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const q = useQuery({ queryKey: ["group"], queryFn: apiClient.group });

  useEffect(() => {
    return () => {
      if (revertTimer.current) clearTimeout(revertTimer.current);
    };
  }, []);

  const invite = useMutation({
    mutationFn: (e: string) => apiClient.invite(e),
    onSuccess: async () => {
      setEmail("");
      await qc.invalidateQueries({ queryKey: ["group"] });
    },
  });

  const cancelInvite = useMutation({
    mutationFn: (id: string) => apiClient.cancelInvite(id),
    onSuccess: async () => {
      setConfirmCancelId(null);
      await qc.invalidateQueries({ queryKey: ["group"] });
    },
  });

  const askCancel = (id: string) => {
    if (revertTimer.current) clearTimeout(revertTimer.current);
    if (confirmCancelId === id) {
      cancelInvite.mutate(id);
      return;
    }
    setConfirmCancelId(id);
    revertTimer.current = setTimeout(() => {
      setConfirmCancelId((cur) => (cur === id ? null : cur));
    }, 3000);
  };

  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="text-[13px] font-bold text-sub">いっしょに使う人</h2>
      <InviteBanner />
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={() => void q.refetch()} />
      ) : (
        <>
          <ul className="rounded-2xl border border-line-soft bg-card text-sm">
            {q.data.members.map((m, i) => (
              <li
                key={i}
                className="flex min-h-11 items-center justify-between gap-2 border-b border-[#f3eee7] p-3.5 last:border-b-0"
              >
                <span className="truncate text-[#4a433c]">
                  {m.name}
                  {m.isMe && "（あなた）"}
                </span>
              </li>
            ))}
            {q.data.invites.map((i) => (
              <li
                key={i.id}
                className="flex min-h-11 items-center justify-between gap-2 border-b border-[#f3eee7] p-3.5 last:border-b-0"
              >
                <span className="truncate text-sub">招待中：{i.email}</span>
                <button
                  type="button"
                  disabled={cancelInvite.isPending}
                  onClick={() => askCancel(i.id)}
                  className={cn(
                    "flex h-11 shrink-0 items-center rounded-lg px-3 text-xs",
                    confirmCancelId === i.id
                      ? "bg-danger font-bold text-white"
                      : "border border-[#e3c3b8] text-danger",
                  )}
                >
                  {confirmCancelId === i.id ? "本当に取り消す？" : "取り消す"}
                </button>
              </li>
            ))}
          </ul>
          {cancelInvite.isError && (
            <p role="alert" className="text-sm text-danger">
              {cancelInvite.error.message}
            </p>
          )}

          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (email.trim()) invite.mutate(email.trim());
            }}
          >
            <label className="flex flex-col gap-1.5 text-[13px] font-bold">
              招待する
              <input
                id="invite-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="partner@example.com"
                className="h-12 rounded-xl border border-field bg-card px-3.5 text-[15px] font-normal"
              />
            </label>
            <PrimaryButton type="submit" disabled={invite.isPending}>
              {invite.isPending ? "招待中…" : "招待する"}
            </PrimaryButton>
            {invite.isError && (
              <p role="alert" className="text-sm text-danger">
                {invite.error.message}
              </p>
            )}
          </form>
          <p className="text-xs leading-6 text-sub">
            相手の Google
            のメールアドレスを入れてください。相手がそのアドレスでログインすると招待が届きます（メールは送られないので、相手に伝えてください）。自分以外4人まで。
          </p>
        </>
      )}
    </section>
  );
}
