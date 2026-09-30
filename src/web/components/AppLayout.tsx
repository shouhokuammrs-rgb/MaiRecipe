import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  CalendarDays,
  Refrigerator,
  Settings,
  ShoppingCart,
} from "lucide-react";
import { NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { apiClient, ApiError } from "@/api/client";
import { Loading } from "@/components/common";
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
