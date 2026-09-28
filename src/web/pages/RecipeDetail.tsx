import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ChevronLeft, GitBranch } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  apiClient,
  type RecipeDetail as Detail,
  type Version,
} from "@/api/client";
import {
  ErrorState,
  FoodPlaceholder,
  Loading,
  PrimaryButton,
  SecondaryButton,
} from "@/components/common";
import { MicButton } from "@/components/MicButton";
import { VideoEmbed } from "@/components/VideoEmbed";
import { shrinkImage } from "@/lib/image";
import { categoryTint } from "@/lib/tint";
import { cn } from "@/lib/utils";

function md(ts: number) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function RecipeDetail() {
  const { id = "" } = useParams();
  const q = useQuery({
    queryKey: ["recipe", id],
    queryFn: () => apiClient.getRecipe(id),
  });
  if (q.isPending) return <Loading />;
  if (q.isError)
    return <ErrorState error={q.error} retry={() => q.refetch()} />;
  return <DetailView r={q.data} />;
}

function DetailView({ r }: { r: Detail }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [viewId, setViewId] = useState<string | null>(null);
  const [threadOpen, setThreadOpen] = useState(false);
  const [memo, setMemo] = useState("");
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [imgError, setImgError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const latest = r.versions[r.versions.length - 1]!;
  const view = r.versions.find((v) => v.id === viewId) ?? latest;
  const viewingOld = view.id !== latest.id;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["recipe", r.id] });
    void qc.invalidateQueries({ queryKey: ["recipes"] });
  };

  const addMemo = useMutation({
    mutationFn: (text: string) => apiClient.addMemo(r.id, text),
    onSuccess: () => {
      setMemo("");
      setThreadOpen(true);
      refresh();
    },
  });
  const delVersion = useMutation({
    mutationFn: (vid: string) => apiClient.deleteVersion(r.id, vid),
    onSuccess: () => {
      setConfirmDel(null);
      setViewId(null);
      refresh();
    },
  });
  const delMemo = useMutation({
    mutationFn: (mid: string) => apiClient.deleteMemo(r.id, mid),
    onSuccess: () => {
      setConfirmDel(null);
      refresh();
    },
  });
  const delRecipe = useMutation({
    mutationFn: () => apiClient.deleteRecipe(r.id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["recipes"] });
      nav("/", { replace: true });
    },
  });
  const photo = useMutation({
    mutationFn: async (file: File) =>
      apiClient.putImage(r.id, await shrinkImage(file)),
    onSuccess: () => {
      setImgError(null);
      refresh();
    },
    onError: (e) =>
      setImgError(
        e instanceof Error ? e.message : "写真を保存できませんでした",
      ),
  });

  // 版とメモを時系列に並べた「改良のあゆみ」
  const thread = useMemo(() => {
    const noOf = new Map(r.versions.map((v) => [v.id, v.seq]));
    const items = [
      ...r.versions.map((v) => ({
        type: "version" as const,
        at: v.createdAt,
        v,
      })),
      ...r.memos.map((m) => ({
        type: "memo" as const,
        at: m.createdAt,
        m,
        appliedSeq: m.appliedVersionId
          ? noOf.get(m.appliedVersionId)
          : undefined,
      })),
    ];
    return items.sort((a, b) => a.at - b.at);
  }, [r]);

  const askDelete = (key: string, run: () => void) => {
    if (confirmDel === key) run();
    else setConfirmDel(key);
  };

  return (
    <div className="flex flex-col bg-card">
      <div className="relative">
        {r.videoUrl ? (
          <div className="bg-video px-3 pt-14 pb-3">
            <VideoEmbed url={r.videoUrl} className="[&_a]:text-white/70" />
          </div>
        ) : r.hasImage ? (
          <img
            src={apiClient.imageUrl(r.id, r.updatedAt)}
            alt={r.title}
            className="h-56 w-full object-cover"
          />
        ) : (
          <div style={{ background: categoryTint(r.category) }}>
            <FoodPlaceholder className="h-48 w-full bg-transparent" />
          </div>
        )}
        <button
          type="button"
          aria-label="戻る"
          onClick={() => nav("/")}
          className="absolute top-3 left-3 z-10 flex size-10 items-center justify-center rounded-full bg-white/90"
        >
          <ChevronLeft className="size-5" />
        </button>
        {!r.videoUrl && (
          <>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="absolute right-3 bottom-3 z-10 flex h-9 items-center gap-1.5 rounded-full bg-white/90 px-3 text-xs font-bold"
            >
              <Camera className="size-4" />
              {photo.isPending
                ? "保存中…"
                : r.hasImage
                  ? "写真を変える"
                  : "写真を追加"}
            </button>
            <input
              ref={fileRef}
              id="recipe-photo"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) photo.mutate(f);
                e.target.value = "";
              }}
            />
          </>
        )}
      </div>

      <div className="flex flex-col gap-5 px-5 pt-4 pb-10">
        {imgError && (
          <p role="alert" className="text-sm text-danger">
            {imgError}
          </p>
        )}
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-[23px] leading-snug font-bold">
            {view.title}
          </h1>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-ink px-2.5 py-0.5 text-xs text-white">
              {r.category}
            </span>
            <span className="rounded-md bg-herb-soft px-2.5 py-0.5 text-xs text-herb">
              {r.genre}
            </span>
            {r.timeLabel && (
              <span className="ml-1 text-[13px] text-sub">{r.timeLabel}</span>
            )}
          </div>
          <div
            className={cn(
              "text-xs font-bold",
              r.versions.length > 1 ? "text-herb" : "text-sub",
            )}
          >
            {r.versions.length > 1
              ? `最新版 v${latest.seq}・${md(latest.createdAt)} 更新`
              : "元のレシピ（まだ改良なし）"}
          </div>
        </div>

        {viewingOld && (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-memo px-3 py-2.5 text-[13px]">
            v{view.seq}
            {view.kind === "original" ? "（元のレシピ）" : ""}{" "}
            を表示中。献立・買い物には最新版を使います
            <button
              type="button"
              onClick={() => setViewId(null)}
              className="shrink-0 font-bold text-accent-deep underline"
            >
              最新版へ
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5">
          <PrimaryButton
            onClick={() => nav(`/plan?add=${r.id}`)}
            className="h-12 text-sm"
          >
            献立に追加
          </PrimaryButton>
          <SecondaryButton onClick={() => nav(`/recipes/${r.id}/edit`)}>
            材料・作り方を編集
          </SecondaryButton>
        </div>

        <section className="flex flex-col gap-2">
          <h2 className="text-base font-bold">
            材料 <span className="text-xs font-normal text-sub">2人分</span>
          </h2>
          {view.ingredients.length === 0 ? (
            <p className="text-sm text-sub">
              まだ材料がありません。「材料・作り方を編集」から入れてください。
            </p>
          ) : (
            <ul className="border-t border-line-soft">
              {view.ingredients.map((i, k) => (
                <li
                  key={k}
                  className="flex justify-between gap-3 border-b border-line-soft px-0.5 py-2.5 text-sm"
                >
                  <span>{i.name}</span>
                  <span className="shrink-0">{i.amount}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2.5">
          <h2 className="text-base font-bold">作り方</h2>
          {view.steps.length === 0 && (
            <p className="text-sm text-sub">まだ作り方がありません。</p>
          )}
          <ol className="flex flex-col gap-2.5">
            {view.steps.map((s, k) => (
              <li key={k} className="flex items-start gap-3">
                <span className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-accent-soft text-[13px] font-bold text-accent-deep">
                  {k + 1}
                </span>
                <span className="pt-0.5 text-sm leading-7">{s}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* 改良のあゆみ（普段は閉じておく） */}
        <section className="flex flex-col gap-2.5">
          <div className="overflow-hidden rounded-2xl border border-line-soft bg-paper">
            <button
              type="button"
              aria-expanded={threadOpen}
              onClick={() => {
                setThreadOpen(!threadOpen);
                setConfirmDel(null);
              }}
              className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left"
            >
              <GitBranch className="size-5 text-sub" />
              <span className="flex flex-1 flex-col">
                <span className="text-[15px] font-bold">改良のあゆみ</span>
                <span className="text-xs text-sub">
                  v1 → v{latest.seq}・メモ {r.memos.length}件
                </span>
              </span>
              <span className="text-xs text-[#4a433c]">
                {threadOpen ? "閉じる" : "開く"}
              </span>
            </button>
            {threadOpen && (
              <ol className="border-t border-line-soft px-3.5 pt-3">
                {thread.map((it, idx) => {
                  const last = idx === thread.length - 1;
                  if (it.type === "version") {
                    const v: Version = it.v;
                    const isLatest = v.id === latest.id;
                    const key = `v${v.id}`;
                    return (
                      <li key={key} className="flex gap-3">
                        <Rail
                          color={v.kind === "original" ? "#2B2622" : "#3E6B4B"}
                          last={last}
                        />
                        <div className="flex flex-1 flex-col gap-1.5 pb-4">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-[13px] font-bold">
                              v{v.seq}
                              {"\u3000"}
                              {v.kind === "original"
                                ? `元のレシピ${r.sourceUrl ? "（出典どおり）" : ""}`
                                : v.kind === "memo"
                                  ? "メモから更新"
                                  : "自分で編集"}
                              {isLatest ? "・最新" : ""}
                            </span>
                            <span className="shrink-0 text-[11px] text-sub">
                              {md(v.createdAt)}
                            </span>
                          </div>
                          {v.changes.map((c, k) => (
                            <span key={k} className="text-xs text-[#4a433c]">
                              ・{c}
                            </span>
                          ))}
                          <div className="flex flex-wrap gap-1.5">
                            {view.id !== v.id && (
                              <SmallButton
                                onClick={() =>
                                  setViewId(isLatest ? null : v.id)
                                }
                              >
                                {isLatest ? "最新版を見る" : "この版を見る"}
                              </SmallButton>
                            )}
                            {v.kind !== "original" && (
                              <DeleteButton
                                confirming={confirmDel === key}
                                busy={delVersion.isPending}
                                onClick={() =>
                                  askDelete(key, () => delVersion.mutate(v.id))
                                }
                              />
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  }
                  const m = it.m;
                  const key = `m${m.id}`;
                  return (
                    <li key={key} className="flex gap-3">
                      <Rail color="#D08A2E" last={last} />
                      <div className="flex flex-1 flex-col gap-1.5 pb-4">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[13px] font-bold text-memo-ink">
                            メモ
                            {it.appliedSeq
                              ? `\u3000→ v${it.appliedSeq} に反映`
                              : "\u3000未反映"}
                          </span>
                          <span className="shrink-0 text-[11px] text-sub">
                            {md(m.createdAt)}
                          </span>
                        </div>
                        <p className="rounded-xl border border-line-soft bg-card px-2.5 py-2 text-sm leading-7 whitespace-pre-wrap">
                          {m.text}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {!it.appliedSeq && (
                            <SmallButton
                              dark
                              onClick={() =>
                                nav(`/recipes/${r.id}/edit?memo=${m.id}`)
                              }
                            >
                              レシピに反映する
                            </SmallButton>
                          )}
                          <DeleteButton
                            confirming={confirmDel === key}
                            busy={delMemo.isPending}
                            onClick={() =>
                              askDelete(key, () => delMemo.mutate(m.id))
                            }
                          />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          <form
            className="flex flex-col gap-2 rounded-2xl border border-field bg-card p-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (memo.trim()) addMemo.mutate(memo.trim());
            }}
          >
            <label>
              <span className="sr-only">メモ</span>
              <textarea
                id="memo-input"
                rows={2}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                maxLength={1000}
                placeholder="作ってみてどうだった？ 話しかけてもOK"
                className="w-full resize-none bg-transparent px-1 text-sm leading-6 outline-none"
              />
            </label>
            <div className="flex items-center justify-between gap-2">
              <MicButton value={memo} onChange={setMemo} label="話してメモ" />
              <button
                type="submit"
                disabled={!memo.trim() || addMemo.isPending}
                className="ml-auto h-10 rounded-full bg-accent px-4 text-[13px] font-bold text-white disabled:opacity-50"
              >
                メモを残す
              </button>
            </div>
            {addMemo.isError && (
              <p role="alert" className="text-xs text-danger">
                {addMemo.error.message}
              </p>
            )}
          </form>
        </section>

        {r.sourceUrl && (
          <div className="flex flex-col gap-1 text-[13px]">
            <span className="font-bold">出典</span>
            <a
              href={r.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="break-all text-accent underline"
            >
              {r.sourceUrl}
            </a>
          </div>
        )}

        <button
          type="button"
          onClick={() => askDelete("recipe", () => delRecipe.mutate())}
          className={cn(
            "h-11 rounded-xl text-sm",
            confirmDel === "recipe"
              ? "bg-danger font-bold text-white"
              : "text-danger",
          )}
        >
          {confirmDel === "recipe"
            ? "本当に消す？（元に戻せません）"
            : "このレシピを削除"}
        </button>
      </div>
    </div>
  );
}

function Rail({ color, last }: { color: string; last: boolean }) {
  return (
    <div
      className="flex w-3.5 shrink-0 flex-col items-center"
      aria-hidden="true"
    >
      <span
        className="mt-1.5 size-3 shrink-0 rounded-full"
        style={{ background: color }}
      />
      <span
        className="w-0.5 flex-1"
        style={{ background: last ? "transparent" : "#E1D9CE" }}
      />
    </div>
  );
}

function SmallButton({
  dark,
  className,
  ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { dark?: boolean }) {
  return (
    <button
      type="button"
      {...p}
      className={cn(
        "h-8 rounded-full px-3 text-xs",
        dark
          ? "bg-ink font-bold text-white"
          : "border border-field bg-card text-ink",
        className,
      )}
    />
  );
}

function DeleteButton({
  confirming,
  busy,
  onClick,
}: {
  confirming: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className={cn(
        "h-8 rounded-full border px-3 text-xs",
        confirming
          ? "border-danger bg-danger text-white"
          : "border-[#e3c3b8] bg-card text-danger",
      )}
    >
      {confirming ? "本当に消す？" : "消す"}
    </button>
  );
}
