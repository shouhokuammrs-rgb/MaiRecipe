import { useQuery } from "@tanstack/react-query";
import { Link2, Plus, Search, ShoppingBasket, SquarePen } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { categoryTint } from "@/lib/tint";
import { apiClient, type RecipeHeader } from "@/api/client";
import {
  Chip,
  Empty,
  ErrorState,
  FoodPlaceholder,
  Loading,
  PageTitle,
} from "@/components/common";
import { InviteBanner } from "@/components/InviteBanner";
import { CATEGORIES, GENRES } from "../../shared/constants";

export function Recipes() {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [genre, setGenre] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const nav = useNavigate();
  const list = useQuery({
    queryKey: ["recipes", q, category, genre],
    queryFn: () => apiClient.listRecipes({ q: q.trim(), category, genre }),
    placeholderData: (prev) => prev,
  });

  return (
    <>
      <PageTitle
        aside={
          <Link
            to="/import"
            className="flex h-9 items-center gap-1.5 rounded-full border border-field bg-card px-3 text-[13px] font-medium"
          >
            <Link2 className="size-4" />
            URL・動画から
          </Link>
        }
      >
        レシピ{" "}
        {list.data && (
          <span className="text-sm font-medium text-sub">
            {list.data.length}品
          </span>
        )}
      </PageTitle>

      <div className="px-5">
        <InviteBanner />
      </div>

      <div className="flex flex-col gap-3 px-5 pb-2">
        <div className="flex gap-2">
          <label className="relative block flex-1">
            <span className="sr-only">レシピ名で検索</span>
            <Search className="absolute top-3.5 left-3.5 size-4 text-sub" />
            <input
              id="recipe-search"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="レシピ名で検索"
              className="h-11 w-full rounded-xl border border-line bg-card pr-3 pl-10 text-[15px]"
            />
          </label>
          <Link
            to="/find"
            className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-ink px-3 text-[13px] font-bold text-white"
          >
            <ShoppingBasket className="size-4" />
            材料から探す
          </Link>
        </div>
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          <Chip on={!category} onClick={() => setCategory("")}>
            すべて
          </Chip>
          {CATEGORIES.map((c) => (
            <Chip
              key={c}
              on={category === c}
              onClick={() => setCategory(category === c ? "" : c)}
            >
              {c}
            </Chip>
          ))}
        </div>
        <div className="no-scrollbar -mt-1 flex gap-1.5 overflow-x-auto">
          <Chip variant="genre" on={!genre} onClick={() => setGenre("")}>
            すべて
          </Chip>
          {GENRES.map((g) => (
            <Chip
              key={g}
              variant="genre"
              on={genre === g}
              onClick={() => setGenre(genre === g ? "" : g)}
            >
              {g}
            </Chip>
          ))}
        </div>
      </div>

      <div className="flex-1 px-5 pt-1 pb-24">
        {list.isPending && <Loading />}
        {list.isError && (
          <ErrorState error={list.error} retry={() => list.refetch()} />
        )}
        {list.data && list.data.length === 0 && (
          <Empty>
            {q || category || genre ? (
              "当てはまるレシピはありません。"
            ) : (
              <>
                まだレシピがありません。
                <br />
                右下の「＋」から、見つけたレシピを取り込んでみましょう。
              </>
            )}
          </Empty>
        )}
        <div className="grid grid-cols-2 gap-3.5">
          {list.data?.map((r) => (
            <RecipeCard key={r.id} r={r} />
          ))}
        </div>
      </div>

      <button
        type="button"
        aria-label="レシピを追加"
        onClick={() => setAddOpen(true)}
        className="fixed right-[max(20px,calc(50%-268px))] bottom-24 flex size-14 items-center justify-center rounded-full bg-accent text-white shadow-lg"
      >
        <Plus className="size-6" strokeWidth={2.2} />
      </button>

      {addOpen && (
        <div
          className="fixed inset-0 z-20 flex flex-col justify-end bg-ink/45"
          onClick={() => setAddOpen(false)}
        >
          <div
            role="dialog"
            aria-label="レシピを追加"
            className="mx-auto flex w-full max-w-xl flex-col gap-3 rounded-t-3xl bg-card px-5 pt-5 pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-[17px] font-bold">レシピを追加</h2>
              <button
                type="button"
                className="h-9 text-sm text-sub"
                onClick={() => setAddOpen(false)}
              >
                閉じる
              </button>
            </div>
            <button
              type="button"
              onClick={() => nav("/import")}
              className="flex items-center gap-3.5 rounded-2xl border-[1.5px] border-ink p-3.5 text-left"
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-deep">
                <Link2 className="size-5" />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-[15px] font-bold">
                  見つけたレシピを取り込む
                </span>
                <span className="text-xs leading-5 text-sub">
                  サイトや動画の URL から。取り込んだら自分好みに改良できます
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => nav("/recipes/new")}
              className="flex items-center gap-3.5 rounded-2xl border border-field p-3.5 text-left"
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-chip text-[#4a433c]">
                <SquarePen className="size-5" />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="flex items-center gap-1.5 text-[15px] font-bold">
                  ゼロから自分で作る
                  <span className="rounded bg-[#f3e8d6] px-1.5 py-0.5 text-[10px] text-memo-ink">
                    将来プレミアム
                  </span>
                </span>
                <span className="text-xs leading-5 text-sub">
                  オリジナルのレシピを登録します
                </span>
              </span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function RecipeCard({ r }: { r: RecipeHeader }) {
  return (
    <Link
      to={`/recipes/${r.id}`}
      className="flex flex-col overflow-hidden rounded-2xl border border-line-soft bg-card"
    >
      <div
        className="relative h-28"
        style={{ background: categoryTint(r.category) }}
      >
        {r.hasImage ? (
          <img
            src={apiClient.imageUrl(r.id, r.updatedAt)}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <FoodPlaceholder className="size-full bg-transparent" />
        )}
        {r.videoUrl && (
          <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-video/80 px-2 py-0.5 text-[11px] text-white">
            <svg
              width="9"
              height="9"
              viewBox="0 0 24 24"
              fill="#fff"
              aria-hidden="true"
            >
              <path d="M7 4l13 8-13 8z" />
            </svg>
            動画
          </span>
        )}
        {r.versionCount > 1 && (
          <span className="absolute right-2 bottom-2 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-bold text-herb">
            v{r.versionCount}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1 px-3 pt-2.5 pb-3">
        <div className="text-sm leading-snug font-bold">{r.title}</div>
        <div className="text-xs text-sub">
          {r.category}・{r.genre}
          {r.timeLabel && `・${r.timeLabel}`}
        </div>
      </div>
    </Link>
  );
}
