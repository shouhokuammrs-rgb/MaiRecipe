import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiClient } from "@/api/client";

/**
 * 自分宛ての招待があるときだけ出す帯。ただし今のグループにすでに他のメンバーがいるなら
 * （＝この招待をもう受けられない）出さない。読み込み中・エラーのときも出さない。
 */
export function InviteBanner() {
  const invites = useQuery({
    queryKey: ["my-invites"],
    queryFn: apiClient.myInvites,
  });
  const group = useQuery({ queryKey: ["group"], queryFn: apiClient.group });
  if (!invites.data || !group.data) return null;
  if (group.data.members.length !== 1) return null;
  if (invites.data.invites.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {invites.data.invites.map((i) => (
        <Link
          key={i.id}
          to={`/invites/${i.id}`}
          className="flex min-h-11 items-center justify-between gap-2 rounded-xl bg-herb-soft px-3.5 py-2 text-sm font-bold text-herb"
        >
          <span>{i.invitedBy || i.groupName} さんから招待が届いています</span>
          <span className="shrink-0 underline">見る</span>
        </Link>
      ))}
    </div>
  );
}
