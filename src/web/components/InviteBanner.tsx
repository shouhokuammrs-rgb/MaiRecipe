import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiClient } from "@/api/client";

/** 自分宛ての招待があるときだけ出す帯。無い・読み込み中・エラーのときは何も出さない */
export function InviteBanner() {
  const q = useQuery({
    queryKey: ["my-invites"],
    queryFn: apiClient.myInvites,
  });
  if (!q.data || q.data.invites.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {q.data.invites.map((i) => (
        <Link
          key={i.id}
          to={`/invites/${i.id}`}
          className="flex min-h-11 items-center justify-between gap-2 rounded-xl bg-herb-soft px-3.5 py-2 text-sm font-bold text-herb"
        >
          <span>{i.invitedBy} さんから招待が届いています</span>
          <span className="shrink-0 underline">見る</span>
        </Link>
      ))}
    </div>
  );
}
