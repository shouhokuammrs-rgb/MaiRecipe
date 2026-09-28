import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Info } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient, type ImportResult } from "@/api/client";
import { PrimaryButton, SubHeader } from "@/components/common";
import { RecipeEditor } from "@/components/RecipeEditor";
import { VideoEmbed } from "@/components/VideoEmbed";

export function Import() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const nav = useNavigate();
  const qc = useQueryClient();

  const read = useMutation({
    mutationFn: (u: string) => apiClient.importUrl(u),
    onSuccess: (r) => setResult(r),
  });
  const save = useMutation({
    mutationFn: apiClient.createRecipe,
    onSuccess: async ({ id }) => {
      await qc.invalidateQueries({ queryKey: ["recipes"] });
      nav(`/recipes/${id}`, { replace: true });
    },
  });

  if (result) {
    const d = result.draft;
    return (
      <>
        <SubHeader
          title="取り込む内容の確認"
          right={
            <button
              type="button"
              className="h-10 px-3 text-sm text-sub"
              onClick={() => setResult(null)}
            >
              やり直す
            </button>
          }
        />
        {d.videoUrl && (
          <div className="px-5 pt-4">
            <VideoEmbed url={d.videoUrl} />
          </div>
        )}
        <RecipeEditor
          initial={d}
          banner={
            <div
              className={`flex items-start gap-2 rounded-xl p-3 text-[13px] leading-6 ${result.found ? "bg-herb-soft text-herb" : "bg-memo text-memo-ink"}`}
            >
              {result.found ? (
                <Check className="mt-1 size-4 shrink-0" />
              ) : (
                <Info className="mt-1 size-4 shrink-0" />
              )}
              <span>
                {result.message}
                <br />
                出典：<span className="break-all">{d.sourceUrl}</span>
              </span>
            </div>
          }
          submitLabel="元のレシピ（v1）として保存"
          saving={save.isPending}
          error={save.error?.message}
          onSubmit={(fields) =>
            save.mutate({
              ...fields,
              sourceUrl: d.sourceUrl,
              videoUrl: d.videoUrl,
              origin: "import",
            })
          }
        />
      </>
    );
  }

  return (
    <>
      <SubHeader title="URL・動画から取り込み" back="/" />
      <form
        className="flex flex-col gap-4 px-5 pt-5 pb-10"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) read.mutate(url.trim());
        }}
      >
        <p className="text-sm leading-7 text-[#4a433c]">
          レシピサイトや料理動画（YouTube）の URL
          を貼ると、材料と作り方を取り出して保存します。元の文章や写真はコピーせず、出典のリンクを必ず残します。
        </p>
        <label className="flex flex-col gap-1.5 text-[13px] font-bold">
          URL
          <input
            id="import-url"
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://"
            className="h-12 rounded-xl border border-field bg-card px-3.5 text-[15px] font-normal"
          />
        </label>
        <PrimaryButton type="submit" disabled={read.isPending || !url.trim()}>
          {read.isPending ? "読み取り中…" : "読み取る"}
        </PrimaryButton>
        {read.isError && (
          <p role="alert" className="text-sm text-danger">
            {read.error.message}
          </p>
        )}
        <p className="text-xs leading-6 text-sub">
          読み取りは AI
          を使いません。うまく取れなかったときは、出典を残したまま手で入れられます。
        </p>
      </form>
    </>
  );
}
