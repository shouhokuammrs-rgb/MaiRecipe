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
import { clearOfflineRecipes } from "@/lib/offlineRecipes";
import { cn } from "@/lib/utils";
import { SERVINGS_MAX } from "../../shared/servings";

export function Settings() {
  const session = authClient.useSession();
  const nav = useNavigate();
  const qc = useQueryClient();
  const user = session.data?.user;

  const logout = async () => {
    await authClient.signOut();
    qc.clear();
    clearOfflineRecipes();
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

        <AiUsageSection />

        <HouseholdSection />

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

/** 今日の AI の使用量。無料分の目安の9割で止める（DEC-025） */
function AiUsageSection() {
  const q = useQuery({ queryKey: ["ai-usage"], queryFn: apiClient.aiUsage });
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="text-[13px] font-bold text-sub">AI の使用量（今日）</h2>
      <div className="flex flex-col gap-3 rounded-2xl border border-line-soft bg-card p-3.5 text-sm">
        {q.isPending ? (
          <Loading />
        ) : q.isError ? (
          <ErrorState error={q.error} retry={() => void q.refetch()} />
        ) : (
          q.data.items.map((i) => {
            const ratio = Math.min(1, i.used / Math.max(1, i.stopAt));
            const stopped = i.available && i.used >= i.stopAt;
            return (
              <div key={i.key} className="flex flex-col gap-1">
                <div className="flex justify-between gap-2">
                  <span>{i.label}</span>
                  <span
                    className={cn(
                      "shrink-0 tabular-nums",
                      stopped ? "font-bold text-danger" : "text-sub",
                    )}
                  >
                    {!i.available
                      ? "使っていない設定です"
                      : stopped
                        ? "今日は止めています"
                        : `${i.used} / ${i.stopAt} 回`}
                  </span>
                </div>
                <div
                  className="h-1.5 overflow-hidden rounded-full bg-line-soft"
                  role="progressbar"
                  aria-label={i.label}
                  aria-valuemin={0}
                  aria-valuemax={i.stopAt}
                  aria-valuenow={Math.min(i.used, i.stopAt)}
                >
                  <div
                    className={cn(
                      "h-full rounded-full",
                      stopped ? "bg-danger" : "bg-herb",
                    )}
                    style={{ width: `${ratio * 100}%` }}
                  />
                </div>
              </div>
            );
          })
        )}
        <p className="text-xs leading-5 text-sub">
          AI
          は無料の枠だけで使っています。お金はかかりません。無料の目安の9割に達したら、その日は止めます。回数が戻るのは、Gemini
          は日本時間の16〜17時ごろ、Workers AI
          は9時です（会社ごとの1日の区切り）。取り込みは AI
          が止まっても、サイトのレシピ情報や手入力で続けられます。
        </p>
      </div>
    </section>
  );
}

/** ふだん作る人数。買い物リストは、人数の分かるレシピをこの人数に換算して作る */
function HouseholdSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["group"], queryFn: apiClient.group });
  const save = useMutation({
    mutationFn: (n: number) => apiClient.setHouseholdServings(n),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["group"] });
      await qc.invalidateQueries({ queryKey: ["shopping"] });
    },
  });
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="text-[13px] font-bold text-sub">ふだん作る量</h2>
      <div className="flex flex-col gap-2 rounded-2xl border border-line-soft bg-card p-3.5 text-sm">
        <label className="flex items-center justify-between gap-3">
          <span>いつも何人分作る？</span>
          <select
            className="h-11 rounded-xl border border-field bg-card px-3 text-base"
            disabled={!q.data || save.isPending}
            value={save.isPending ? save.variables : (q.data?.servings ?? 2)}
            onChange={(e) => save.mutate(Number(e.target.value))}
          >
            {Array.from({ length: SERVINGS_MAX }, (_, k) => k + 1).map((n) => (
              <option key={n} value={n}>
                {n}人分
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs leading-5 text-sub">
          買い物リストは、この人数に合わせて分量を計算します（4人分のレシピなら半分に）。
        </p>
        {save.isError && (
          <p className="text-xs text-danger">
            保存できませんでした。もう一度選んでください。
          </p>
        )}
      </div>
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
    onError: async () => {
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
                <span className="min-w-0 break-all text-sub">
                  招待中：{i.email}
                </span>
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
              招待する人のメールアドレス
              <input
                id="invite-email"
                name="email"
                type="email"
                required
                autoComplete="off"
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
