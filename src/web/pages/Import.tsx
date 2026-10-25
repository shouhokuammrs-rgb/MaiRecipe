import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ClipboardPaste,
  Flag,
  Info,
  Loader2,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  cleanSourceUrl,
  overlapNotice,
  parseRecipeText,
  parseVideoUrl,
  recipeFromSections,
} from "../../shared/importer";
import { servingsFromText } from "../../shared/servings";
import {
  apiClient,
  type ImportJob,
  type ImportResult,
  type RecipeFields,
} from "@/api/client";
import { jobLabel, jobResult, useImportJobs } from "@/lib/importJobs";
import { PrimaryButton, SecondaryButton, SubHeader } from "@/components/common";
import { RecipeEditor } from "@/components/RecipeEditor";
import { PhotoImport } from "@/components/PhotoImport";
import { VideoEmbed } from "@/components/VideoEmbed";

type Mode = "url" | "text" | "photo";

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
    servings: servingsFromText(text),
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
  const [params, setParams] = useSearchParams();
  /** いま確かめている、裏の読み取り（保存したら消す） */
  const [activeJob, setActiveJob] = useState<string | null>(null);
  const jobs = useImportJobs();

  // 裏で始める（すぐ返る）。読み終わったら下の一覧と、ほかの画面の上の知らせで分かる
  const start = useMutation({
    mutationFn: (u: string) => apiClient.startImport(u),
    onSuccess: () => {
      setUrl("");
      void qc.invalidateQueries({ queryKey: ["import-jobs"] });
    },
  });
  // 同じ出典のレシピが保存済みなら、読み取る前に知らせる（二重に取り込まない）
  const [dup, setDup] = useState<{
    id: string;
    title: string;
    url: string;
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const submitUrl = async (u: string) => {
    setFallbackTitle("");
    setDup(null);
    setChecking(true);
    // 確かめられなくても、取り込みは止めない
    const saved = await apiClient.findBySource(u).catch(() => null);
    setChecking(false);
    if (saved) setDup({ ...saved, url: u });
    else start.mutate(u);
  };
  const dismiss = useMutation({
    mutationFn: (id: string) => apiClient.dismissImportJob(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["import-jobs"] }),
  });
  // 保存済みのレシピの読み直しなら、そのレシピ（新しい版として保存する）
  const [rereadOf, setRereadOf] = useState<string | null>(null);
  const openJob = (j: ImportJob) => {
    if (j.status === "running") return;
    setActiveJob(j.id);
    setRereadOf(j.recipeId ?? null);
    setResult(jobResult(j));
  };
  // 上の知らせから来たとき（/import?job=…）は、その結果を開く（描画中に1回だけ移す）
  const wanted = params.get("job");
  const wantedJob =
    wanted && result === null
      ? jobs.data?.find((x) => x.id === wanted && x.status !== "running")
      : undefined;
  if (wantedJob) {
    setActiveJob(wantedJob.id);
    setRereadOf(wantedJob.recipeId ?? null);
    setResult(jobResult(wantedJob));
  }
  // URL の ?job= は、読み終えた一覧が来たら外す（戻ったときに開き直さない）
  useEffect(() => {
    if (wanted && jobs.data) setParams({}, { replace: true });
  }, [wanted, jobs.data, setParams]);
  const aiRead = useMutation({
    mutationFn: apiClient.importAi,
    onSuccess: (r) => {
      setResult(r);
      setTextError("");
    },
  });
  const report = useMutation({
    mutationFn: (u: string) => apiClient.reportImport(u),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["import-reports"] }),
  });
  const save = useMutation({
    mutationFn: apiClient.createRecipe,
    onSuccess: async ({ id }) => {
      // 保存した読み取りは一覧から消す
      if (activeJob)
        await apiClient.dismissImportJob(activeJob).catch(() => {});
      void qc.invalidateQueries({ queryKey: ["import-jobs"] });
      await qc.invalidateQueries({ queryKey: ["recipes"] });
      nav(`/recipes/${id}`, { replace: true });
    },
  });

  // 読み直しの結果は、そのレシピの新しい版として積む（前の版は残る）
  const saveVersion = useMutation({
    mutationFn: (fields: RecipeFields) =>
      apiClient.addVersion(rereadOf!, fields),
    onSuccess: async (res) => {
      if (activeJob)
        await apiClient.dismissImportJob(activeJob).catch(() => {});
      void qc.invalidateQueries({ queryKey: ["import-jobs"] });
      await qc.invalidateQueries({ queryKey: ["recipe", rereadOf] });
      await qc.invalidateQueries({ queryKey: ["recipes"] });
      // 今の版と同じなら版は増えない。そのことをレシピの画面で知らせる
      nav(`/recipes/${rereadOf}`, {
        replace: true,
        state:
          "unchanged" in res
            ? {
                notice:
                  "読み直した内容は今の版と同じだったので、新しい版は作りませんでした。",
              }
            : undefined,
      });
    },
  });

  const switchMode = (m: Mode) => {
    setMode(m);
    setTextError("");
  };

  // 読み直しで材料も手順も取れなかったときは、空の版を作らせない（今の版のまま）
  if (
    result &&
    rereadOf &&
    !result.draft.ingredients.length &&
    !result.draft.steps.length
  ) {
    const back = async () => {
      if (activeJob)
        await apiClient.dismissImportJob(activeJob).catch(() => {});
      void qc.invalidateQueries({ queryKey: ["import-jobs"] });
      nav(`/recipes/${rereadOf}`, { replace: true });
    };
    return (
      <>
        <SubHeader title="読み直した内容の確認" />
        <div className="flex flex-col gap-4 px-5 pt-5 pb-10">
          <p
            role="status"
            className="rounded-xl bg-memo p-3 text-sm leading-7 text-memo-ink"
          >
            出典から読み直せませんでした。今のレシピはそのままです。時間をおいてもう一度試すか、「材料・作り方を編集」から直してください。
          </p>
          <PrimaryButton onClick={() => void back()}>
            レシピに戻る
          </PrimaryButton>
        </div>
      </>
    );
  }

  if (result) {
    const d = result.draft;
    return (
      <>
        <SubHeader
          title={rereadOf ? "読み直した内容の確認" : "取り込む内容の確認"}
          right={
            <button
              type="button"
              className="h-11 px-3 text-sm text-sub"
              onClick={() => {
                setResult(null);
                setActiveJob(null);
                setRereadOf(null);
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
          // 前の版の API（人数を返さない）の結果でも読めるように
          initial={{ ...d, servings: d.servings ?? null }}
          banner={
            <div className="flex flex-col gap-2">
              {rereadOf && (
                <p className="rounded-xl bg-memo p-3 text-[13px] leading-6 text-memo-ink">
                  出典から読み直した内容です。保存すると新しい版になります（前の版は残ります）。今の版で自分で直したところ・足したコツは入っていないので、要るものは書き足してください。
                </p>
              )}
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
                  {d.sourceUrl && (
                    <>
                      出典：<span className="break-all">{d.sourceUrl}</span>
                    </>
                  )}
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
              {!result.found && d.sourceUrl && (
                <div className="flex flex-col gap-2">
                  <PrimaryButton
                    disabled={aiRead.isPending}
                    onClick={() =>
                      aiRead.mutate({ url: d.sourceUrl ?? "", title: d.title })
                    }
                  >
                    <Sparkles className="size-4" />
                    {aiRead.isPending
                      ? "AI が読み取り中…（10秒〜1分）"
                      : "AI で読み取る（無料）"}
                  </PrimaryButton>
                  {aiRead.isError && (
                    <p role="alert" className="text-sm text-danger">
                      {aiRead.error.message}
                    </p>
                  )}
                  <SecondaryButton
                    onClick={() => {
                      setUrl(d.sourceUrl ?? "");
                      setFallbackTitle(d.title);
                      setResult(null);
                      setActiveJob(null);
                      // 貼った文章は、ふつうの取り込み（新しいレシピ）として扱う
                      setRereadOf(null);
                      report.reset();
                      switchMode("text");
                    }}
                  >
                    <ClipboardPaste className="size-4" />
                    概要欄やページの文章を貼って読み取る
                  </SecondaryButton>
                  <SecondaryButton
                    disabled={report.isPending || report.isSuccess}
                    onClick={() => report.mutate(d.sourceUrl ?? "")}
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
          submitLabel={
            rereadOf
              ? "新しい版として保存（前の版は残ります）"
              : "元のレシピ（v1）として保存"
          }
          saving={save.isPending || saveVersion.isPending}
          error={save.error?.message ?? saveVersion.error?.message}
          onSubmit={(fields) =>
            rereadOf
              ? saveVersion.mutate(fields)
              : save.mutate({
                  ...fields,
                  sourceUrl: d.sourceUrl,
                  videoUrl: d.videoUrl,
                  // 表紙は出典の画像を元の場所から表示する（保存しない。DEC-023）
                  coverUrl: d.coverUrl ?? null,
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
          className="grid grid-cols-3 gap-1 rounded-xl bg-chip p-1"
        >
          {(
            [
              ["url", "URL から"],
              ["text", "文章を貼って"],
              ["photo", "写真から"],
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

        {mode === "photo" ? (
          <PhotoImport onResult={setResult} />
        ) : mode === "url" ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (url.trim()) void submitUrl(url.trim());
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
              disabled={start.isPending || checking || !url.trim()}
            >
              {start.isPending || checking ? "始めています…" : "読み取る"}
            </PrimaryButton>
            {dup && (
              <div
                role="status"
                className="flex flex-col gap-2 rounded-xl bg-memo p-3 text-[13px] leading-6 text-memo-ink"
              >
                <p>
                  このレシピは保存済みです：
                  <span className="font-bold">{dup.title}</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <PrimaryButton
                    type="button"
                    className="h-11 px-4 text-sm"
                    onClick={() => nav(`/recipes/${dup.id}`)}
                  >
                    保存済みのレシピを開く
                  </PrimaryButton>
                  <SecondaryButton
                    type="button"
                    className="h-11 px-4 text-sm"
                    onClick={() => {
                      start.mutate(dup.url);
                      setDup(null);
                    }}
                  >
                    それでも取り込む
                  </SecondaryButton>
                </div>
              </div>
            )}
            {start.isError && (
              <p role="alert" className="text-sm text-danger">
                {start.error.message}
              </p>
            )}
            {start.isSuccess && (
              <p role="status" className="text-sm leading-6 text-herb">
                読み取りを始めました。長い動画は1〜3分かかります（Google
                側が混んでいるときは自動でやり直すので、10分ほどかかることもあります）。ほかの画面に移っても大丈夫です（終わったら上に知らせが出ます）。
              </p>
            )}
            <JobList
              jobs={jobs.data ?? []}
              onOpen={openJob}
              onDismiss={(id) => dismiss.mutate(id)}
            />
            <p className="text-xs leading-6 text-sub">
              サイトのレシピ情報があればそれを使い、無ければ
              AI（無料）が読みます。動画は AI
              が動画そのものを見て、手順まで書き出します。取れなければ、文章を貼るか、出典を残したまま手で入れられます。
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
            {textError && text.trim() && /^https?:\/\//i.test(url.trim()) && (
              <SecondaryButton
                disabled={aiRead.isPending}
                onClick={() =>
                  aiRead.mutate({
                    text: text.trim(),
                    url: url.trim(),
                    title: fallbackTitle || undefined,
                  })
                }
              >
                <Sparkles className="size-4" />
                {aiRead.isPending
                  ? "AI が読み取り中…（10秒〜1分）"
                  : "AI で読み取る（無料）"}
              </SecondaryButton>
            )}
            {mode === "text" && aiRead.isError && (
              <p role="alert" className="text-sm text-danger">
                {aiRead.error.message}
              </p>
            )}
            <p className="text-xs leading-6 text-sub">
              分けるのはこの端末の中だけで、AI
              も使いません。うまく分けられないときだけ「AI
              で読み取る」が出ます。貼った文章そのものは保存しません。
            </p>
          </form>
        )}
      </div>
    </>
  );
}

/** 裏で読み取っているもの・読み終わったものの一覧（DEC-022） */
function JobList({
  jobs,
  onOpen,
  onDismiss,
}: {
  jobs: ImportJob[];
  onOpen: (j: ImportJob) => void;
  onDismiss: (id: string) => void;
}) {
  if (!jobs.length) return null;
  return (
    <section className="flex flex-col gap-2" aria-label="読み取りの様子">
      <h2 className="text-[13px] font-bold">読み取りの様子</h2>
      <ul className="flex flex-col gap-2">
        {jobs.map((j) => (
          <li
            key={j.id}
            className="flex items-center gap-2 rounded-xl border border-line-soft bg-card py-1.5 pr-1 pl-3"
          >
            {j.status === "running" ? (
              <Loader2 className="size-4 shrink-0 animate-spin text-sub" />
            ) : j.status === "done" ? (
              <Check className="size-4 shrink-0 text-herb" />
            ) : (
              <TriangleAlert className="size-4 shrink-0 text-danger" />
            )}
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm">{jobLabel(j)}</span>
              <span className="text-xs text-sub">
                {j.status === "running"
                  ? "読み取り中…"
                  : j.status === "done"
                    ? j.result?.found
                      ? "読み取れました"
                      : "材料と作り方は見つかりませんでした"
                    : (j.error ?? "読み取れませんでした")}
              </span>
            </div>
            {j.status !== "running" && (
              <button
                type="button"
                onClick={() => onOpen(j)}
                className={`h-11 shrink-0 rounded-lg px-3 text-sm font-bold ${j.status === "done" ? "bg-accent text-white" : "border border-field bg-card text-ink"}`}
              >
                {j.status === "done" || j.recipeId ? "確かめる" : "手で入れる"}
              </button>
            )}
            {j.status !== "running" && (
              <button
                type="button"
                aria-label={`「${jobLabel(j)}」を一覧から消す`}
                onClick={() => onDismiss(j.id)}
                className="flex size-11 shrink-0 items-center justify-center text-faint"
              >
                <X className="size-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
