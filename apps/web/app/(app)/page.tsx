import { RecipesEmptyState } from "@/components/recipes/recipes-empty-state";

const INFO_MESSAGES: Record<string, string> = {
  password_updated: "パスワードを更新しました。",
};

type Props = {
  searchParams: Promise<{ message?: string }>;
};

export default async function HomePage({ searchParams }: Props) {
  const params = await searchParams;
  const message = params.message ? INFO_MESSAGES[params.message] : undefined;

  return (
    <div className="space-y-6">
      {message ? (
        <p
          role="status"
          className="rounded-md border border-green-600/40 bg-green-50 px-3 py-2 text-sm text-green-800"
        >
          {message}
        </p>
      ) : null}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">レシピ</h1>
      </div>
      <RecipesEmptyState />
    </div>
  );
}
