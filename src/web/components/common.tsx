import { ChevronLeft, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

export function PageTitle({
  children,
  aside,
}: {
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-2">
      <h1 className="font-display text-2xl font-bold">{children}</h1>
      {aside}
    </div>
  );
}

export function SubHeader({
  title,
  right,
  back,
}: {
  title: string;
  right?: ReactNode;
  back?: string;
}) {
  const nav = useNavigate();
  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-1 border-b border-line-soft bg-card px-2">
      <button
        type="button"
        aria-label="戻る"
        onClick={() => (back ? nav(back) : nav(-1))}
        className="flex size-11 items-center justify-center rounded-full"
      >
        <ChevronLeft className="size-5" />
      </button>
      <h1 className="min-w-0 flex-1 truncate text-base font-bold">{title}</h1>
      {right}
    </header>
  );
}

export function Chip({
  on,
  onClick,
  children,
  variant = "category",
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  variant?: "category" | "genre";
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "shrink-0 border text-[13px] font-medium",
        variant === "category"
          ? "h-8 rounded-full px-3.5"
          : "h-7 rounded-lg px-3 text-xs",
        variant === "category" &&
          (on
            ? "border-ink bg-ink text-white"
            : "border-field bg-card text-ink"),
        variant === "genre" &&
          (on
            ? "border-herb-mid bg-herb-soft text-herb"
            : "border-line bg-card text-[#4a433c]"),
      )}
    >
      {children}
    </button>
  );
}

export function Loading({ label = "読み込み中…" }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 py-16 text-sm text-sub"
    >
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  );
}

export function ErrorState({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  const msg = error instanceof Error ? error.message : "読み込めませんでした";
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 px-6 py-16 text-center text-sm text-sub"
    >
      <p>{msg}</p>
      {retry && (
        <button
          type="button"
          onClick={retry}
          className="h-10 rounded-full border border-field bg-card px-4 text-ink"
        >
          もう一度読み込む
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="px-4 py-14 text-center text-sm leading-7 text-sub">
      {children}
    </div>
  );
}

export function PrimaryButton({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "flex h-12 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-[15px] font-bold text-white disabled:opacity-50",
        className,
      )}
    />
  );
}

export function SecondaryButton({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "flex h-12 items-center justify-center gap-2 rounded-xl border border-field bg-card px-4 text-sm font-medium text-ink disabled:opacity-50",
        className,
      )}
    />
  );
}

export function FoodPlaceholder({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center justify-center bg-chip", className)}>
      <svg
        width="36"
        height="36"
        viewBox="0 0 24 24"
        fill="none"
        stroke="rgba(43,38,34,0.4)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="13" r="7" />
        <circle cx="12" cy="13" r="3.5" />
        <path d="M3 4v5M5 4v5M4 9v11M20 4c-1.5 1-2 3-2 5h2v11" />
      </svg>
    </div>
  );
}
