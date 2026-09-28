import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { planSlotLabel } from "../../shared/group";
import { ApiError, apiClient } from "@/api/client";
import {
  ErrorState,
  Loading,
  PrimaryButton,
  SubHeader,
} from "@/components/common";

const NOT_FOUND_MESSAGE =
  "この招待は見つかりませんでした。取り消されたか、別のアカウント宛てです。";

export function JoinGroup() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const revertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (revertTimer.current) clearTimeout(revertTimer.current);
    };
  }, []);

  const q = useQuery({
    queryKey: ["my-invites"],
    queryFn: apiClient.myInvites,
  });
  const invite = q.data?.invites.find((i) => i.id === id);

  const accept = useMutation({
    mutationFn: () => apiClient.acceptInvite(id),
    onSuccess: () => {
      qc.clear();
    },
    onError: () => {
      if (revertTimer.current) clearTimeout(revertTimer.current);
      setConfirming(false);
    },
  });

  const askConfirm = () => {
    if (revertTimer.current) clearTimeout(revertTimer.current);
    if (confirming) {
      accept.mutate();
      return;
    }
    setConfirming(true);
    revertTimer.current = setTimeout(() => setConfirming(false), 3000);
  };

  if (accept.isSuccess && accept.data) {
    const { movedRecipes, keptPlans } = accept.data;
    return (
      <>
        <SubHeader title="招待への参加" back="/" />
        <div className="flex flex-col gap-4 px-5 pt-6 pb-10">
          <h2 className="text-xl font-bold">参加しました</h2>
          <p className="text-sm leading-7 text-[#4a433c]">
            レシピを {movedRecipes} 件移しました
          </p>
          {keptPlans.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {keptPlans.map((p) => (
                <li
                  key={`${p.date}-${p.meal}`}
                  className="rounded-xl bg-memo px-3.5 py-2.5 text-sm leading-6 text-memo-ink"
                >
                  {planSlotLabel(p.date, p.meal)}は、もとの献立を残しました
                </li>
              ))}
            </ul>
          )}
          <Link
            to="/"
            className="flex h-12 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-[15px] font-bold text-white"
          >
            レシピを見る
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <SubHeader title="招待への参加" back="/" />
      <div className="flex flex-col gap-4 px-5 pt-6 pb-10">
        {q.isPending ? (
          <Loading />
        ) : q.isError ? (
          <ErrorState error={q.error} retry={() => void q.refetch()} />
        ) : !invite ? (
          <p role="alert" className="text-sm leading-7 text-danger">
            {NOT_FOUND_MESSAGE}
          </p>
        ) : (
          <>
            <p className="text-sm leading-7 text-[#4a433c]">
              参加すると、あなたのレシピ・献立・買い物リストは{" "}
              {invite.invitedBy || invite.groupName}{" "}
              さんのグループに移り、同じものを一緒に使います。同じ日・同じ食事の献立がすでにあるときは、
              {invite.invitedBy || invite.groupName}{" "}
              さんの献立を残します。参加したあとで抜けることは、今はできません。
            </p>
            <PrimaryButton disabled={accept.isPending} onClick={askConfirm}>
              {accept.isPending
                ? "参加中…"
                : confirming
                  ? "本当に参加する？"
                  : "参加する"}
            </PrimaryButton>
            {accept.isError && (
              <p role="alert" className="text-sm text-danger">
                {accept.error instanceof ApiError && accept.error.status === 404
                  ? NOT_FOUND_MESSAGE
                  : accept.error.message}
              </p>
            )}
          </>
        )}
      </div>
    </>
  );
}
