import { BookOpenIcon } from "lucide-react";

export function RecipesEmptyState() {
  return (
    <div
      className="text-muted-foreground flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-16 text-center"
      data-testid="recipes-empty-state"
    >
      <BookOpenIcon aria-hidden className="mb-4 size-10 opacity-60" />
      <p className="text-foreground text-lg font-semibold">レシピはまだありません</p>
      <p className="mt-1 text-sm">レシピの登録機能は次のマイルストーン（M1）で追加されます。</p>
    </div>
  );
}
