import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  CalendarDays,
  Refrigerator,
  Settings,
  ShoppingCart,
} from "lucide-react";
import { Link, NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { apiClient, ApiError } from "@/api/client";
import { Loading } from "@/components/common";
import { jobLabel, useImportJobs } from "@/lib/importJobs";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/", label: "レシピ", icon: BookOpen, end: true },
  { to: "/plan", label: "献立", icon: CalendarDays, end: false },
  { to: "/fridge", label: "冷蔵庫", icon: Refrigerator, end: false },
  { to: "/shopping", label: "買い物", icon: ShoppingCart, end: false },
  { to: "/settings", label: "設定", icon: Settings, end: false },
];

/** ログイン必須の画面の外枠。下のタブは一覧系の画面だけに出す */
export function AppLayout() {
  const loc = useLocation();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: apiClient.me,
    retry: false,
    staleTime: 60_000,
  });
  if (me.isPending) return <Loading />;
  if (me.error instanceof ApiError && me.error.status === 401) {
    return <Navigate to="/login" replace />;
  }
  const showTabs = ["/", "/plan", "/fridge", "/shopping", "/settings"].includes(
    loc.pathname,
  );
  return (
    <div className="mx-auto flex h-full max-w-xl flex-col bg-paper">
      <main className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
        <Outlet />
      </main>
      {loc.pathname !== "/import" && !loc.pathname.endsWith("/cook") && (
        <ImportJobsStrip />
      )}
      {showTabs && (
        <nav
          aria-label="メイン"
          className="grid shrink-0 grid-cols-5 border-t border-line-soft bg-card"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        >
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                cn(
                  "flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-bold",
                  isActive ? "text-accent" : "text-faint",
                )
              }
            >
              <t.icon className="size-[22px]" strokeWidth={1.9} />
              {t.label}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}

/** 裏で読み取っているレシピの知らせ（DEC-022）。読めたら「確かめる」で取り込み画面へ */
function ImportJobsStrip() {
  const { data: jobs } = useImportJobs();
  const done = jobs?.find((j) => j.status === "done");
  const failed = jobs?.find((j) => j.status === "failed");
  const running = jobs?.filter((j) => j.status === "running").length ?? 0;
  const show = done ?? failed;
  if (!show && !running) return null;
  return (
    <div
      role="status"
      className={cn(
        "flex shrink-0 items-center gap-2 border-t border-line-soft px-4 py-1.5 text-[13px]",
        show && !done ? "bg-memo text-memo-ink" : "bg-herb-soft text-herb",
      )}
    >
      {show ? (
        <>
          <span className="min-w-0 flex-1 truncate">
            {done
              ? done.result?.found
                ? "読み取れました"
                : "材料と作り方が見つかりませんでした"
              : "読み取れませんでした"}
            ：{jobLabel(show)}
          </span>
          <Link
            to={`/import?job=${show.id}`}
            className={cn(
              "flex h-11 shrink-0 items-center rounded-lg px-3 font-bold",
              done
                ? "bg-herb text-white"
                : "border border-field bg-card text-ink",
            )}
          >
            {done || show.recipeId ? "確かめる" : "手で入れる"}
          </Link>
        </>
      ) : (
        <span className="flex h-11 items-center">
          レシピを読み取り中…（{running}件）
        </span>
      )}
    </div>
  );
}
