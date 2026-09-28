import { useMutation } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "@/api/client";
import { Empty, ErrorState, Loading, SubHeader } from "@/components/common";
import { MicButton } from "@/components/MicButton";

const SUGGEST = [
  "鶏肉",
  "豚肉",
  "牛肉",
  "ひき肉",
  "鮭",
  "卵",
  "豆腐",
  "玉ねぎ",
  "にんじん",
  "じゃがいも",
  "キャベツ",
  "なす",
  "ピーマン",
  "トマト",
  "きのこ",
  "ほうれん草",
];

function splitTerms(s: string): string[] {
  return s
    .split(/[\s、,，と]+|がある|あります|を使いたい|使いたい/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t.length <= 30);
}

export function Find() {
  const [terms, setTerms] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const search = useMutation({
    mutationFn: (t: string[]) => apiClient.find(t),
  });

  const update = (next: string[]) => {
    const uniq = [...new Set(next)].slice(0, 10);
    setTerms(uniq);
    if (uniq.length) search.mutate(uniq);
    else search.reset();
  };
  const addDraft = (text = draft) => {
    const t = splitTerms(text);
    if (t.length) update([...terms, ...t]);
    setDraft("");
  };

  return (
    <>
      <SubHeader title="材料から探す" back="/" />
      <div className="flex flex-col gap-4 px-5 pt-4 pb-10">
        <p className="text-sm leading-7 text-[#4a433c]">
          使いたい材料・家にある材料を入れると、作れそうなレシピが出てきます。
        </p>

        <div className="flex flex-col gap-2 rounded-2xl border border-field bg-card p-2.5">
          {terms.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {terms.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-label={`${t} を外す`}
                  onClick={() => update(terms.filter((x) => x !== t))}
                  className="flex h-8 items-center gap-1 rounded-full bg-ink px-3 text-[13px] text-white"
                >
                  {t}
                  <X className="size-3.5 opacity-80" />
                </button>
              ))}
            </div>
          )}
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              addDraft();
            }}
          >
            <label className="flex-1">
              <span className="sr-only">材料を入力</span>
              <input
                id="find-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="例: 鶏肉 玉ねぎ"
                className="h-10 w-full bg-transparent px-1 text-[15px] outline-none"
              />
            </label>
            <button
              type="submit"
              className="h-9 rounded-full border border-field px-3 text-[13px]"
            >
              追加
            </button>
          </form>
          <MicButton
            value=""
            onChange={(t) => addDraft(t)}
            label="話して入れる"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="text-xs text-sub">よく使う材料</div>
          <div className="flex flex-wrap gap-1.5">
            {SUGGEST.filter((s) => !terms.includes(s)).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => update([...terms, s])}
                className="h-8 rounded-full border border-field bg-card px-3 text-xs"
              >
                ＋ {s}
              </button>
            ))}
          </div>
        </div>

        {search.isPending && <Loading label="探しています…" />}
        {search.isError && <ErrorState error={search.error} />}
        {search.data && search.data.length === 0 && (
          <Empty>入れた材料を使うレシピは、まだありません。</Empty>
        )}
        {!terms.length && (
          <Empty>
            材料を入れてください。自分のレシピ（最新版）の材料から探します。
          </Empty>
        )}

        <div className="flex flex-col gap-2.5">
          {search.data?.map((r) => {
            const all = r.matched === r.total;
            return (
              <Link
                key={r.id}
                to={`/recipes/${r.id}`}
                className="flex flex-col gap-1 rounded-2xl border border-line-soft bg-card p-3.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[15px] font-bold">{r.title}</span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${all ? "bg-herb-soft text-herb" : "bg-chip text-[#4a433c]"}`}
                  >
                    {all ? "全部使える" : `${r.matched}/${r.total} 使える`}
                  </span>
                </div>
                <span className="text-xs text-herb">
                  使える：{r.have.join("・")}
                </span>
                <span className="text-xs text-sub">
                  {r.missing.length
                    ? `買い足し：${r.missing.join("・")}`
                    : "買い足しなし"}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
