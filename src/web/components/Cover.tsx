import { useState } from "react";
import { apiClient } from "@/api/client";
import { FoodPlaceholder } from "@/components/common";
import { categoryTint } from "@/lib/tint";
import { cn } from "@/lib/utils";
import { pickCover } from "../../shared/cover";

/**
 * レシピの表紙。自分の写真 → 出典の画像（元の場所から表示・保存しない）→ 色と絵。
 * 出典の画像が読めなければ、色と絵に戻す（DEC-023）
 */
export function Cover({
  r,
  className,
  alt = "",
  lazy,
}: {
  r: {
    id: string;
    category: string;
    hasImage: boolean;
    coverUrl: string | null;
    videoUrl: string | null;
    updatedAt: number;
  };
  className?: string;
  alt?: string;
  lazy?: boolean;
}) {
  const cover = pickCover(r);
  const [broken, setBroken] = useState<string | null>(null);
  const src =
    cover.kind === "own"
      ? apiClient.imageUrl(r.id, r.updatedAt)
      : cover.kind === "source"
        ? cover.url
        : null;
  if (!src || broken === src)
    return (
      <div
        className={className}
        style={{ background: categoryTint(r.category) }}
      >
        <FoodPlaceholder className="size-full bg-transparent" />
      </div>
    );
  return (
    <img
      src={src}
      alt={alt}
      loading={lazy ? "lazy" : undefined}
      // 出典のサイトに、こちらのページの URL を渡さない
      referrerPolicy="no-referrer"
      onError={() => setBroken(src)}
      className={cn("object-cover", className)}
    />
  );
}
