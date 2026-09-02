import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted/40 flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <Link href="/login" className="mb-6 text-2xl font-bold tracking-tight">
        MaiRecipe
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
