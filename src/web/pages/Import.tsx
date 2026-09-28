import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ClipboardPaste, Flag, Info, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  cleanSourceUrl,
  overlapNotice,
  parseRecipeText,
  parseVideoUrl,
  recipeFromSections,
} from "../../shared/importer";
import { apiClient, type ImportResult } from "@/api/client";
import { PrimaryButton, SecondaryButton, SubHeader } from "@/components/common";
import { RecipeEditor } from "@/components/RecipeEditor";
import { VideoEmbed } from "@/components/VideoEmbed";

type Mode = "url" | "text";

/** 貼り付けた文章は端末の中で材料と手順に分ける（API には送らない） */
const TEXT_MAX = 20_000;

function readPastedText(
  text: string,
  rawUrl: string,
  fallbackTitle: string,
): ImportResult | null {
  const parsed = parseRecipeText(text.slice(0, TEXT_MAX));
  if (!parsed) return null;
  const recipe = recipeFromSections({
    title: fallbackTitle || "貼り付けたレシピ",
    ingredients: parsed.ingredients,
    steps: parsed.steps,
  });
  if (!recipe) return null;
  const video = parseVideoUrl(rawUrl);
  const sourceUrl = video?.watchUrl ?? cleanSourceUrl(rawUrl) ?? rawUrl;
  return {
    kind: video ? "video" : "page",
    found: true,
    draft: { ...recipe, sourceUrl, videoUrl: video?.watchUrl ?? null },
    message:
      "貼り付けた文章から読み取りました（AI なし）。内容を確かめてから保存してください。",
    notice: overlapNotice(parsed.overlaps),
  };
}

export function Import() {
  const [mode, setMode] = useState<Mode>("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [textError, setTextError] = useState("");
  /** URL で読めなかったときの題名（貼り付けで読み直すときに引き継ぐ） */
  const [fallbackTitle, setFallbackTitle] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const nav = useNavigate();
  const qc = useQueryClient();

  const read = useMutation({
    mutationFn: (u: string) => apiClient.importUrl(u),
    onSuccess: (r) => setResult(r),
  });
  const report = useMutation({
    mutationFn: (u: string) => apiClient.reportImport(u),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["import-reports"] }),
  });
  const save = useMutation({
    mutationFn: apiClient.createRecipe,
    onSuccess: async ({ id }) => {
      await qc.invalidateQueries({ queryKey: ["recipes"] });
      nav(`/recipes/${id}`, { replace: true });
    },
  });

  const switchMode = (m: Mode) => {
    setMode(m);
    setTextError("");
  };

  if (result) {
    const d = result.draft;
    return (
      <>
        <SubHeader
          title="取り込む内容の確認"
          right={
            <button
              type="button"
              className="h-11 px-3 text-sm text-sub"
              onClick={() => {
                setResult(null);
                report.reset();
              }}
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
            <div className="flex flex-col gap-2">
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
                  {d.videoUrl && d.videoUrl !== d.sourceUrl && (
                    <>
                      <br />
                      動画：<span className="break-all">{d.videoUrl}</span>
                    </>
                  )}
                </span>
              </div>
              {result.notice && (
                <div
                  role="status"
                  className="flex items-start gap-2 rounded-xl bg-memo p-3 text-[13px] leading-6 font-bold text-memo-ink"
                >
                  <TriangleAlert className="mt-1 size-4 shrink-0" />
                  <span>{result.notice}</span>
                </div>
              )}
              {!result.found && (
                <div className="flex flex-col gap-2">
                  <SecondaryButton
                    onClick={() => {
                      setUrl(d.sourceUrl);
                      setFallbackTitle(d.title);
                      setResult(null);
                      report.reset();
                      switchMode("text");
                    }}
                  >
                    <ClipboardPaste className="size-4" />
                    概要欄やページの文章を貼って読み取る
                  </SecondaryButton>
                  <SecondaryButton
                    disabled={report.isPending || report.isSuccess}
                    onClick={() => report.mutate(d.sourceUrl)}
                  >
                    <Flag className="size-4" />
                    {report.isSuccess
                      ? "報告しました（設定画面で見られます）"
                      : report.isPending
                        ? "報告中…"
                        : "読めなかった URL を報告"}
                  </SecondaryButton>
                  {report.isError && (
                    <p role="alert" className="text-sm text-danger">
                      {report.error.message}
                    </p>
                  )}
                </div>
              )}
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
      <div className="flex flex-col gap-4 px-5 pt-5 pb-10">
        <div
          role="group"
          aria-label="取り込み方"
          className="grid grid-cols-2 gap-1 rounded-xl bg-chip p-1"
        >
          {(
            [
              ["url", "URL から"],
              ["text", "文章を貼って"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => switchMode(m)}
              className={`h-11 rounded-lg text-sm font-bold ${mode === m ? "bg-card text-ink shadow-sm" : "text-sub"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "url" ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (url.trim()) {
                setFallbackTitle("");
                read.mutate(url.trim());
              }
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
            <PrimaryButton
              type="submit"
              disabled={read.isPending || !url.trim()}
            >
              {read.isPending ? "読み取り中…" : "読み取る"}
            </PrimaryButton>
            {read.isError && (
              <p role="alert" className="text-sm text-danger">
                {read.error.message}
              </p>
            )}
            <p className="text-xs leading-6 text-sub">
              読み取りは AI
              を使いません。うまく取れなかったときは、文章を貼って読み取るか、出典を残したまま手で入れられます。
            </p>
          </form>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!/^https?:\/\//i.test(url.trim())) {
                setTextError("出典は http(s) の URL を入れてください。");
                return;
              }
              const r = readPastedText(text, url.trim(), fallbackTitle);
              if (r) setResult(r);
              else
                setTextError(
                  "材料と作り方を見つけられませんでした。材料の行（例：玉ねぎ 1個）と作り方の行を含めて貼ってください。",
                );
            }}
          >
            <p className="text-sm leading-7 text-[#4a433c]">
              動画の概要欄やレシピページの文章をコピーして貼ると、材料と作り方に分けます。保存するのは材料と作り方だけで、出典の
              URL を残します。
            </p>
            <label className="flex flex-col gap-1.5 text-[13px] font-bold">
              出典の URL
              <input
                id="import-text-url"
                type="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://"
                className="h-12 rounded-xl border border-field bg-card px-3.5 text-[15px] font-normal"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[13px] font-bold">
              貼り付ける文章
              <textarea
                id="import-text"
                required
                rows={10}
                maxLength={TEXT_MAX}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setTextError("");
                }}
                placeholder={"玉ねぎ…1個\n醤油…大さじ2\n…\n玉ねぎを切る\n…"}
                className="rounded-xl border border-field bg-card px-3.5 py-3 text-[15px] leading-7 font-normal"
              />
            </label>
            <PrimaryButton type="submit" disabled={!text.trim() || !url.trim()}>
              材料と作り方に分ける
            </PrimaryButton>
            {textError && (
              <p role="alert" className="text-sm text-danger">
                {textError}
              </p>
            )}
            <p className="text-xs leading-6 text-sub">
              分けるのはこの端末の中だけで、AI
              も使いません。貼った文章そのものは保存しません。
            </p>
          </form>
        )}
      </div>
    </>
  );
}
