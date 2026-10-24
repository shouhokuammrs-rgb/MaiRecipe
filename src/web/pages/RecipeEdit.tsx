import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { apiClient } from "@/api/client";
import { ErrorState, Loading, SubHeader } from "@/components/common";
import { RecipeEditor } from "@/components/RecipeEditor";
import { MemoSuggest } from "@/components/MemoSuggest";
import { applyMemoChanges, type MemoChange } from "../../shared/memo-apply";

export function RecipeEdit() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const memoId = params.get("memo") ?? undefined;
  const nav = useNavigate();
  const qc = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [applied, setApplied] = useState<MemoChange[] | null>(null);
  /** 変更案を入れた回数（入れるたびに編集欄を作り直す） */
  const [applyCount, setApplyCount] = useState(0);
  const q = useQuery({
    // 編集は必ず最新の版から（端末に残した古い内容で版を作らない）
    queryKey: ["recipe", id],
    queryFn: () => apiClient.getRecipe(id),
  });

  const save = useMutation({
    mutationFn: (fields: Parameters<typeof apiClient.addVersion>[1]) =>
      apiClient.addVersion(id, fields),
    onSuccess: async (res) => {
      if ("unchanged" in res) {
        setNotice(
          "前の版から何も変わっていないので、新しい版は作りませんでした。",
        );
        return;
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["recipe", id] }),
        qc.invalidateQueries({ queryKey: ["recipes"] }),
      ]);
      nav(`/recipes/${id}`, { replace: true });
    },
  });

  if (q.isPending) return <Loading />;
  if (q.isError)
    return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const r = q.data;
  const latest = r.versions[r.versions.length - 1]!;
  const memo = memoId ? r.memos.find((m) => m.id === memoId) : undefined;
  const base = {
    title: latest.title,
    category: r.category,
    genre: r.genre,
    timeLabel: r.timeLabel,
    servings: latest.servings,
    tips: latest.tips ?? [],
    stepTimes: latest.stepTimes ?? [],
    ingredients: latest.ingredients,
    steps: latest.steps,
  };
  // AI の変更案を入れたら、その内容で編集欄を作り直す
  const initial = applied
    ? { ...base, ...applyMemoChanges(base, applied) }
    : base;

  /** 変更案は、案を作った版のときだけ入れる（その後にもう一人が版を作っていたら、番号がずれる） */
  const apply = (versionId: string, changes: MemoChange[]) => {
    if (versionId !== latest.id) return false;
    setApplied(changes);
    setApplyCount((n) => n + 1);
    return true;
  };

  return (
    <>
      <SubHeader title={memo ? "メモをレシピに反映" : "材料・作り方を編集"} />
      {/* メモと AI の変更案は編集欄の外に置く（編集欄を作り直しても、案と選んだ状態は残る） */}
      {memo && (
        <div className="flex flex-col gap-2 px-5 pt-4">
          <div className="rounded-xl bg-memo p-3 text-sm leading-7">
            <div className="text-xs font-bold text-memo-ink">
              このメモを見ながら直してください
            </div>
            「{memo.text}」
          </div>
          <MemoSuggest
            recipeId={r.id}
            memoId={memo.id}
            ingredients={latest.ingredients}
            onApply={apply}
          />
        </div>
      )}
      <RecipeEditor
        key={applyCount}
        initial={initial}
        banner={
          <div className="flex flex-col gap-2">
            <div className="rounded-xl bg-herb-soft p-3 text-[13px] leading-6 text-herb">
              いまの最新版（v{latest.seq}）が入っています。保存すると v
              {latest.seq + 1}{" "}
              として「改良のあゆみ」に残ります。前の版は消えません。
            </div>
            {notice && (
              <p role="status" className="text-sm text-memo-ink">
                {notice}
              </p>
            )}
          </div>
        }
        submitLabel={`v${latest.seq + 1} として保存`}
        saving={save.isPending}
        error={save.error?.message}
        onSubmit={(fields) => save.mutate({ ...fields, memoId: memo?.id })}
      />
    </>
  );
}
