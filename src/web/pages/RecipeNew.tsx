import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { apiClient } from "@/api/client";
import { SubHeader } from "@/components/common";
import { RecipeEditor } from "@/components/RecipeEditor";

export function RecipeNew() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: apiClient.createRecipe,
    onSuccess: async ({ id }) => {
      await qc.invalidateQueries({ queryKey: ["recipes"] });
      nav(`/recipes/${id}`, { replace: true });
    },
  });
  return (
    <>
      <SubHeader title="レシピを追加" back="/" />
      <RecipeEditor
        initial={{
          title: "",
          category: "主菜",
          genre: "和食",
          timeLabel: "",
          ingredients: [],
          steps: [],
        }}
        extras={{ sourceUrl: "", videoUrl: "" }}
        banner={
          <div className="rounded-xl bg-[#f3e8d6] p-3 text-[13px] leading-6 text-memo-ink">
            ゼロから作る機能は、一般公開のときにプレミアム機能にする予定です（今は使えます）。
          </div>
        }
        submitLabel="保存"
        saving={save.isPending}
        error={save.error?.message}
        onSubmit={(fields, ex) =>
          save.mutate({
            ...fields,
            sourceUrl: ex?.sourceUrl.trim() || null,
            videoUrl: ex?.videoUrl.trim() || null,
            origin: ex?.sourceUrl.trim() ? "import" : "own",
          })
        }
      />
    </>
  );
}
