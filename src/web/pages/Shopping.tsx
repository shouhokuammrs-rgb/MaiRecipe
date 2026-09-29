import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useState } from "react";
import { apiClient, type ShopItem } from "@/api/client";
import {
  Chip,
  Empty,
  ErrorState,
  Loading,
  PageTitle,
} from "@/components/common";
import { Toast, useToast } from "@/components/Toast";
import { cn } from "@/lib/utils";
import { SHOP_SECTIONS } from "../../shared/constants";
import { labelDate } from "../../shared/dates";

const RANGES = [
  { days: 1, label: "今日" },
  { days: 2, label: "明日まで" },
  { days: 3, label: "3日分" },
  { days: 7, label: "1週間" },
];

export function Shopping() {
  const [days, setDays] = useState(3);
  const [showHave, setShowHave] = useState(false);
  const qc = useQueryClient();
  const { toast, show: setToast } = useToast();
  const q = useQuery({
    queryKey: ["shopping", days],
    queryFn: () => apiClient.shopping(days),
  });

  const check = useMutation({
    mutationFn: (p: { name: string; value: boolean; section: string }) =>
      apiClient.setHave(p.name, p.value),
    onMutate: async (p) => {
      await qc.cancelQueries({ queryKey: ["shopping", days] });
      const prev = qc.getQueryData<
        Awaited<ReturnType<typeof apiClient.shopping>>
      >(["shopping", days]);
      if (prev) {
        qc.setQueryData(["shopping", days], {
          ...prev,
          items: prev.items.map((i) =>
            i.name === p.name ? { ...i, have: p.value } : i,
          ),
        });
      }
      return { prev };
    },
    onSuccess: (_d, p) => {
      if (p.section === "調味料") {
        setToast(
          p.value
            ? `「${p.name}」は家にある扱いに戻しました`
            : `「${p.name}」を買うものに入れました`,
        );
      } else {
        setToast(
          p.value
            ? `「${p.name}」を冷蔵庫に入れました`
            : `「${p.name}」を冷蔵庫から戻しました`,
        );
      }
    },
    onError: (_e, _p, ctx) =>
      ctx?.prev && qc.setQueryData(["shopping", days], ctx.prev),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["shopping"] });
      qc.invalidateQueries({ queryKey: ["pantry"] });
    },
  });

  const items = q.data?.items ?? [];
  const hiddenCount = items.filter((i) => i.have).length;
  const toBuy = items.filter((i) => !i.have);
  const shown = showHave ? items : toBuy;

  return (
    <>
      <PageTitle
        aside={
          q.data && (
            <span className="text-[13px] text-sub">残り {toBuy.length}品</span>
          )
        }
      >
        買い物リスト
      </PageTitle>
      <div className="flex flex-col gap-2 px-5 pb-2">
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
          {RANGES.map((r) => (
            <Chip
              key={r.days}
              on={days === r.days}
              onClick={() => setDays(r.days)}
            >
              {r.label}
            </Chip>
          ))}
        </div>
        {q.data && (
          <p className="text-xs leading-6 text-[#4a433c]">
            {q.data.from === q.data.to
              ? `${labelDate(q.data.from).md}（今日）`
              : `${labelDate(q.data.from).md}〜${labelDate(q.data.to).md}`}{" "}
            の献立 {q.data.recipeCount}
            品（各レシピの最新版）から作成。過ぎた日は入りません。
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={showHave}
            onClick={() => setShowHave(!showHave)}
            className={cn(
              "flex h-8 items-center gap-2 rounded-full border border-field px-3 text-xs",
              showHave ? "bg-[#f4f8f4]" : "bg-card",
            )}
          >
            <span
              className={cn(
                "relative inline-block h-4 w-7 rounded-full",
                showHave ? "bg-herb-mid" : "bg-[#cfc5b8]",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 size-3 rounded-full bg-white",
                  showHave ? "left-3.5" : "left-0.5",
                )}
              />
            </span>
            冷蔵庫にあるものも表示（{hiddenCount}件）
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-4 px-5 pt-1 pb-8">
        {q.isPending && <Loading />}
        {q.isError && <ErrorState error={q.error} retry={() => q.refetch()} />}
        {q.data && items.length === 0 && (
          <Empty>
            この期間に買うものはありません。
            <br />
            献立にレシピを入れるか、期間を広げてください。
          </Empty>
        )}
        {q.data && items.length > 0 && toBuy.length === 0 && !showHave && (
          <Empty>全部そろっています。冷蔵庫に入っています。</Empty>
        )}
        {SHOP_SECTIONS.map((section) => {
          const list = shown.filter((i) => i.section === section);
          if (!list.length) return null;
          return (
            <section key={section} className="flex flex-col gap-1.5">
              <h2 className="text-[13px] font-bold text-sub">{section}</h2>
              <ul className="overflow-hidden rounded-2xl border border-line-soft bg-card">
                {list.map((i) => (
                  <ShopRow
                    key={i.key}
                    i={i}
                    onToggle={(value) =>
                      check.mutate({ name: i.name, value, section: i.section })
                    }
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <Toast message={toast} />
    </>
  );
}

function ShopRow({
  i,
  onToggle,
}: {
  i: ShopItem;
  onToggle: (value: boolean) => void;
}) {
  return (
    <li
      className={cn(
        "flex items-center border-b border-[#f3eee7] last:border-b-0",
        i.have ? "bg-paper" : "bg-card",
      )}
    >
      <button
        type="button"
        aria-pressed={i.have}
        aria-label={`${i.name}を買った・ある`}
        onClick={() => onToggle(!i.have)}
        className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pr-3.5 pl-3.5 text-left"
      >
        <span
          className={cn(
            "flex size-[22px] shrink-0 items-center justify-center rounded-[7px] border-2",
            i.have ? "border-herb-mid bg-herb-mid" : "border-[#cfc5b8] bg-card",
          )}
        >
          {i.have && <Check className="size-3.5 text-white" strokeWidth={3} />}
        </span>
        <span
          className={cn(
            "flex min-w-0 flex-1 flex-col gap-0.5",
            i.have && "opacity-50",
          )}
        >
          <span
            className={cn(
              "flex justify-between gap-2 text-[15px]",
              i.have && "line-through",
            )}
          >
            <span>{i.name}</span>
            <span className="shrink-0 font-bold">{i.amount}</span>
          </span>
          <span className="text-[11px] text-sub">
            {i.recipes.join("・")}
            {i.merged.length > 0 && `（${i.merged.join("・")} もまとめました）`}
          </span>
        </span>
      </button>
    </li>
  );
}
