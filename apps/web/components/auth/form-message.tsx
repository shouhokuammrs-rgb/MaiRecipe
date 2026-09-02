import { cn } from "@/lib/utils";

type Props = {
  error?: string;
  success?: string;
  className?: string;
};

/** フォーム直下に出すエラー/成功メッセージ */
export function FormMessage({ error, success, className }: Props) {
  if (!error && !success) return null;
  return (
    <p
      role={error ? "alert" : "status"}
      data-testid={error ? "form-error" : "form-success"}
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        error
          ? "border-destructive/40 bg-destructive/5 text-destructive"
          : "border-green-600/40 bg-green-50 text-green-800",
        className,
      )}
    >
      {error ?? success}
    </p>
  );
}
