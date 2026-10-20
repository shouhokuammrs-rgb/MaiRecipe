import { useQuery } from "@tanstack/react-query";
import { apiClient, type ImportJob, type ImportResult } from "@/api/client";
import { cleanSourceUrl, parseVideoUrl } from "../../shared/importer";

/**
 * 裏で進めている取り込みの様子（DEC-022）。読み取り中があるあいだだけ数秒ごとに見に行く。
 * どの画面からも同じものを見る（取り込み画面と、上の知らせ）
 */
export function useImportJobs() {
  return useQuery({
    queryKey: ["import-jobs"],
    queryFn: async () => (await apiClient.importJobs()).jobs,
    refetchInterval: (q) =>
      (q.state.data as ImportJob[] | undefined)?.some(
        (j) => j.status === "running",
      )
        ? 4000
        : false,
    refetchOnWindowFocus: true,
  });
}

/** 一覧などに出す、読み取り結果の短い名前 */
export function jobLabel(j: ImportJob): string {
  return j.result?.draft.title || j.url.replace(/^https?:\/\/(www\.)?/, "");
}

/**
 * 確かめる画面に出す結果。読めなかったときも、出典を残したまま手で入れられるよう空の下書きを作る
 */
export function jobResult(j: ImportJob): ImportResult {
  if (j.result) return j.result;
  const video = parseVideoUrl(j.url);
  return {
    kind: video ? "video" : "page",
    found: false,
    draft: {
      title: "",
      category: "主菜",
      genre: "その他",
      timeLabel: "",
      ingredients: [],
      steps: [],
      sourceUrl: video?.watchUrl ?? cleanSourceUrl(j.url) ?? j.url,
      videoUrl: video?.watchUrl ?? null,
    },
    message: `${j.error ?? "読み取れませんでした。"} 出典を残したまま、手で入れられます。`,
  };
}
