import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient, type PantryItem } from "@/api/client";
import {
  Empty,
  ErrorState,
  Loading,
  PageTitle,
  PrimaryButton,
  SecondaryButton,
} from "@/components/common";
import { MicButton } from "@/components/MicButton";
import { RecoCard } from "@/components/RecoCard";
import { RecipeIdeas } from "@/components/RecipeIdeas";
import { Toast, useToast } from "@/components/Toast";
import { apiErrorMessage, cn } from "@/lib/utils";
import { addDays, labelDate } from "../../shared/dates";
import {
  addedLabel,
  FRIDGE_SORT_LABELS,
  FRIDGE_SORTS,
  FRIDGE_ZONES,
  type FridgeSort,
  type FridgeZone,
  fridgeZone,
  groupByZone,
  INSIDE_ZONES,
  isExpiringSoon,
  resolveFridgeOrder,
  splitPantryInput,
} from "../../shared/pantry";
import { moveSection } from "../../shared/shop-order";
import { firstEmptyDinner } from "../../shared/recommend";

/** 一度に選べる食材の上限（まとめて移動のため多め） */
const SELECT_LIMIT = 50;
/** レシピを探すときに使える食材の上限 */
const FIND_LIMIT = 10;

/** 消す確認が自動で元に戻るまでの時間 */
const CONFIRM_MS = 4000;

export function Fridge() {
  const qc = useQueryClient();
  const { toast, show } = useToast();
  const q = useQuery({ queryKey: ["pantry"], queryFn: apiClient.pantry });
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<PantryItem | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());
  const [terms, setTerms] = useState<string[]>([]);
  const [moveOpen, setMoveOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  /** 手で並べている途中の並び（null は並べていない） */
  const [arranging, setArranging] = useState<string[] | null>(null);
  const undo = useUndoToast((e) => show(apiErrorMessage(e)));

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(null), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirming]);

  const del = useMutation({
    mutationFn: (item: PantryItem) => apiClient.deletePantry(item.id),
    onSuccess: (_d, item) => {
      setConfirming(null);
      show(`「${item.name}」を使い切りました`);
      setSelectedNames((prev) => {
        if (!prev.has(item.name)) return prev;
        const next = new Set(prev);
        next.delete(item.name);
        return next;
      });
      // 使い切った食材で固定していた「探す」の言葉が古いまま残らないようにする
      setTerms((prev) => (prev.includes(item.name) ? [] : prev));
    },
    onError: (e) => show(apiErrorMessage(e)),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["pantry"] });
      qc.invalidateQueries({ queryKey: ["shopping"] });
      qc.invalidateQueries({ queryKey: ["recommend"] });
    },
  });

  // 古いサーバーの答えには zone が無いので、そのときは画面で名前から決める
  const items = (q.data?.items ?? []).map((i) => ({
    ...i,
    zone: i.zone ?? fridgeZone(i.name),
  }));
  const today = q.data?.today ?? "";
  const zoneOrder = q.data?.zones ?? resolveFridgeOrder(null);
  const sort: FridgeSort = q.data?.sort ?? "expires";
  // 手で並べている間は、その並びで見せる
  // 並べている間に相手が消した品は落とし、増えた品は後ろに足す
  const shown = arranging
    ? [
        ...arranging
          .map((id) => items.find((i) => i.id === id))
          .filter((i): i is (typeof items)[number] => Boolean(i)),
        ...items.filter((i) => !arranging.includes(i.id)),
      ]
    : items;
  const groups = groupByZone(shown, zoneOrder);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["pantry"] });
    qc.invalidateQueries({ queryKey: ["recommend"] });
  };

  const moveMut = useMutation({
    mutationFn: (p: { ids: string[]; zone: FridgeZone | null }) =>
      apiClient.movePantry(p.ids, p.zone),
    onSuccess: (r, p) => {
      setMoveOpen(false);
      setSelectedNames(new Set());
      setTerms([]);
      undo.show(
        p.zone
          ? `${r.moved}個を${p.zone}に移しました`
          : `${r.moved}個をおまかせの置き場所に戻しました`,
        async () => {
          await apiClient.restorePantryZones(r.undo);
          refresh();
        },
      );
    },
    onError: (e) => show(apiErrorMessage(e)),
    onSettled: refresh,
  });

  const settingsMut = useMutation({
    mutationFn: (p: { sort?: FridgeSort; zones?: FridgeZone[] | null }) =>
      apiClient.setFridgeSettings(p),
    onError: (e) => show(apiErrorMessage(e)),
    onSettled: refresh,
  });

  /** 並べ方・室の順番を変える。変える前に戻せるようにする */
  const applySettings = async (
    next: { sort?: FridgeSort; zones?: FridgeZone[] | null },
    msg: string,
  ) => {
    const inside = zoneOrder.filter((z) => z !== "常温");
    const wasDefault = inside.every((z, i) => z === INSIDE_ZONES[i]);
    const before = { sort, zones: wasDefault ? null : inside };
    await settingsMut.mutateAsync(next);
    undo.show(msg, async () => {
      await apiClient.setFridgeSettings(before);
      refresh();
    });
  };

  const finishArranging = useMutation({
    // 並べ方も「手で並べた順」になる（サーバーが1回で書く）
    mutationFn: (order: string[]) => apiClient.setPantryOrder(order),
    onSuccess: () => {
      // 並べる前の手並べ（あれば）と並べ方に戻せるようにする
      const prevOrder = [...items]
        .filter((i) => i.position != null)
        .sort((a, b) => a.position! - b.position!)
        .map((i) => i.id);
      const prevSort = sort;
      setArranging(null);
      undo.show("並びを保存しました", async () => {
        await apiClient.setPantryOrder(prevOrder);
        await apiClient.setFridgeSettings({ sort: prevSort });
        refresh();
      });
    },
    onError: (e) => show(apiErrorMessage(e)),
    onSettled: refresh,
  });

  // Esc で手並べをやめる（シートが開いていないとき）
  useEffect(() => {
    if (!arranging || sortOpen || moveOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setArranging(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [arranging, sortOpen, moveOpen]);

  /** 手で並べる：同じ室の中で1つ上・下へ */
  const nudge = (id: string, dir: -1 | 1) => {
    if (!arranging) return;
    const arr = shown.map((i) => i.id);
    const zoneOfId = (x: string) => items.find((i) => i.id === x)?.zone;
    const z = zoneOfId(id);
    const i = arr.indexOf(id);
    // 同じ室の隣を探す
    let j = i + dir;
    while (j >= 0 && j < arr.length && zoneOfId(arr[j]!) !== z) j += dir;
    if (j < 0 || j >= arr.length) return;
    const next = [...arr];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setArranging(next);
  };
  // 画面の並び（室ごと）にそろえる
  const selected = groups
    .flatMap((g) => g.items)
    .map((i) => i.name)
    .filter((n) => selectedNames.has(n));
  const barShown = Boolean(arranging) || selected.length > 0;

  const toggleSelect = (name: string) => {
    if (selectedNames.has(name)) {
      const next = new Set(selectedNames);
      next.delete(name);
      setSelectedNames(next);
      setTerms([]);
      return;
    }
    if (selected.length >= SELECT_LIMIT) {
      show(`${SELECT_LIMIT}個まで選べます`);
      return;
    }
    const next = new Set(selectedNames);
    next.add(name);
    setSelectedNames(next);
    setTerms([]);
  };

  return (
    <>
      <PageTitle
        aside={
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="flex h-11 items-center gap-1 rounded-xl bg-accent px-3.5 text-sm font-bold text-white"
          >
            ＋ 食材
          </button>
        }
      >
        冷蔵庫
      </PageTitle>

      <div className="flex flex-col gap-3 px-5 pt-1 pb-8">
        <RecoCard onToast={show} />
        {q.isPending && <Loading />}
        {q.isError && <ErrorState error={q.error} retry={() => q.refetch()} />}
        {q.data && items.length === 0 && (
          <Empty>
            冷蔵庫は空です。
            <br />
            右上の「＋ 食材」か、買い物リストのチェックで入ります。
          </Empty>
        )}
        {q.data && items.length > 0 && (
          <>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[13px] font-bold text-sub">
                冷蔵庫の中（{items.length}）
              </h2>
              {!arranging && (
                <button
                  type="button"
                  onClick={() => setSortOpen(true)}
                  className="flex h-11 items-center rounded-full border border-field bg-card px-3 text-xs"
                >
                  並べ替え：{FRIDGE_SORT_LABELS[sort]}
                </button>
              )}
            </div>
            {arranging ? (
              <p className="text-[11.5px] text-sub">
                ↑↓
                で室の中の順番を変えて、下の「この並びにする」を押してください。
              </p>
            ) : (
              <p className="text-[11.5px] text-faint">
                食材を選ぶと、まとめて移動・レシピを探す
              </p>
            )}
            <FridgeView
              groups={groups}
              renderItem={(item) =>
                arranging ? (
                  <ArrangeRow
                    key={item.id}
                    item={item}
                    first={
                      groups.find((g) => g.zone === item.zone)?.items[0]?.id ===
                      item.id
                    }
                    last={
                      groups.find((g) => g.zone === item.zone)?.items.at(-1)
                        ?.id === item.id
                    }
                    onUp={() => nudge(item.id, -1)}
                    onDown={() => nudge(item.id, 1)}
                  />
                ) : (
                  <FridgeRow
                    key={item.id}
                    item={item}
                    today={today}
                    confirming={confirming === item.id}
                    disabled={del.isPending}
                    selected={selectedNames.has(item.name)}
                    onEdit={() => setEditing(item)}
                    onToggleSelect={() => toggleSelect(item.name)}
                    onFinishTap={() =>
                      confirming === item.id
                        ? del.mutate(item)
                        : setConfirming(item.id)
                    }
                  />
                )
              }
            />
            {arranging && (
              <div className="sticky bottom-[84px] z-10 flex gap-2 rounded-2xl bg-paper/95 p-1 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
                <SecondaryButton
                  className="flex-1"
                  onClick={() => setArranging(null)}
                >
                  やめる
                </SecondaryButton>
                <PrimaryButton
                  className="flex-1"
                  disabled={finishArranging.isPending}
                  onClick={() => finishArranging.mutate(shown.map((i) => i.id))}
                >
                  この並びにする
                </PrimaryButton>
              </div>
            )}
            {!arranging && selected.length > 0 && (
              <div className="sticky bottom-[84px] z-10 flex gap-1.5 rounded-2xl bg-paper/95 p-1 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
                <button
                  type="button"
                  aria-label="選ぶのをやめる"
                  onClick={() => {
                    setSelectedNames(new Set());
                    setTerms([]);
                  }}
                  className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-field bg-card text-lg text-sub"
                >
                  ×
                </button>
                <SecondaryButton
                  className="flex-1 px-2"
                  onClick={() => setMoveOpen(true)}
                >
                  {selected.length}個を移動
                </SecondaryButton>
                <PrimaryButton
                  className="flex-1 px-2"
                  disabled={selected.length > FIND_LIMIT}
                  onClick={() => setTerms(selected)}
                >
                  {selected.length > FIND_LIMIT
                    ? `探すのは${FIND_LIMIT}個まで`
                    : "レシピを探す"}
                </PrimaryButton>
              </div>
            )}
            {terms.length > 0 && (
              <>
                <FindSection terms={terms} today={today} onToast={show} />
                {/* 選び直したら案も消す */}
                <RecipeIdeas key={terms.join("|")} terms={terms} />
              </>
            )}
          </>
        )}
        <p className="text-xs text-sub">
          調味料（醤油・味噌など）は冷蔵庫に出さず、いつも家にある扱いです。
        </p>
      </div>

      {addOpen && <AddSheet onClose={() => setAddOpen(false)} onDone={show} />}
      {editing && (
        <EditSheet
          item={editing}
          onClose={() => setEditing(null)}
          onDone={show}
        />
      )}
      {moveOpen && (
        <MoveSheet
          count={selected.length}
          pending={moveMut.isPending}
          onClose={() => setMoveOpen(false)}
          onPick={(zone) =>
            moveMut.mutate({
              ids: items
                .filter((i) => selectedNames.has(i.name))
                .map((i) => i.id),
              zone,
            })
          }
        />
      )}
      {sortOpen && (
        <SortSheet
          sort={sort}
          zones={zoneOrder}
          onClose={() => setSortOpen(false)}
          onArrange={() => {
            setSortOpen(false);
            setSelectedNames(new Set());
            setTerms([]);
            // いま見えている順から並べ始める
            setArranging(
              groupByZone(items, zoneOrder).flatMap((g) =>
                g.items.map((i) => i.id),
              ),
            );
          }}
          onSave={(next, msg) => {
            setSortOpen(false);
            // 失敗は settingsMut の onError で知らせる
            applySettings(next, msg).catch(() => {});
          }}
        />
      )}
      {/* 下にボタンの帯が出ているときは、お知らせをその上に出す */}
      <div className={cn(barShown && "[&>[role=status]]:bottom-[156px]")}>
        {!undo.state && <Toast message={toast} />}
        <UndoToast state={undo.state} onUndo={undo.run} />
      </div>
    </>
  );
}

/** 「元に戻す」つきのお知らせ（DEC-034）。6秒で消える。戻せなかったら onError */
function useUndoToast(onError: (e: unknown) => void) {
  const [state, setState] = useState<{
    msg: string;
    undo: () => Promise<void>;
    key: number;
  } | null>(null);
  useEffect(() => {
    if (!state) return;
    const t = setTimeout(() => setState(null), 6000);
    return () => clearTimeout(t);
  }, [state]);
  return {
    state,
    show: (msg: string, undo: () => Promise<void>) =>
      setState({ msg, undo, key: Date.now() }),
    run: async () => {
      const s = state;
      setState(null);
      try {
        await s?.undo();
      } catch (e) {
        onError(e);
      }
    },
  };
}

function UndoToast({
  state,
  onUndo,
}: {
  state: { msg: string; key: number } | null;
  onUndo: () => void;
}) {
  if (!state) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-20 left-1/2 z-30 flex w-[calc(100%-32px)] max-w-md -translate-x-1/2 items-center gap-2 rounded-xl bg-ink py-1 pr-1 pl-4 text-[13px] text-white shadow-lg"
    >
      <span className="flex-1">{state.msg}</span>
      <button
        type="button"
        onClick={onUndo}
        className="flex h-11 shrink-0 items-center rounded-lg px-3 font-bold text-[#f3c9b6] underline"
      >
        元に戻す
      </button>
    </div>
  );
}

/** 下からのシートの枠（Esc と背景タップで閉じる） */
function Sheet({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useSheetEsc(onClose);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div
      className="fixed inset-0 z-20 flex flex-col justify-end bg-ink/45"
      onClick={onClose}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="mx-auto flex max-h-[90dvh] w-full max-w-xl flex-col gap-3 overflow-y-auto rounded-t-3xl bg-card px-5 pt-5 pb-[max(env(safe-area-inset-bottom),24px)] outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function MoveSheet({
  count,
  pending,
  onClose,
  onPick,
}: {
  count: number;
  pending: boolean;
  onClose: () => void;
  onPick: (zone: FridgeZone | null) => void;
}) {
  return (
    <Sheet label="まとめて移動" onClose={onClose}>
      <h2 className="text-[17px] font-bold">{count}個をどこへ移す？</h2>
      <div className="grid grid-cols-2 gap-2">
        {FRIDGE_ZONES.map((z) => (
          <button
            key={z}
            type="button"
            disabled={pending}
            onClick={() => onPick(z)}
            className={cn(
              "flex min-h-12 items-center justify-center rounded-xl border text-[15px] font-bold disabled:opacity-50",
              ZONE_LOOK[z].box,
              ZONE_LOOK[z].head,
            )}
          >
            {z}
          </button>
        ))}
      </div>
      <p className="text-[11.5px] leading-5 text-sub">
        冷凍室へはこの品だけ移します（次に買った分はいつもの室に入ります）。ほかの室へ移すと、次からもその室に入ります。
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={() => onPick(null)}
        className="min-h-11 text-sm text-sub underline disabled:opacity-50"
      >
        おまかせの置き場所に戻す
      </button>
      <SecondaryButton onClick={onClose}>やめる</SecondaryButton>
    </Sheet>
  );
}

function SortSheet({
  sort,
  zones,
  onClose,
  onArrange,
  onSave,
}: {
  sort: FridgeSort;
  zones: FridgeZone[];
  onClose: () => void;
  onArrange: () => void;
  onSave: (
    next: { sort?: FridgeSort; zones?: FridgeZone[] | null },
    msg: string,
  ) => void;
}) {
  const [nextSort, setNextSort] = useState(sort);
  const inside = zones.filter((z) => z !== "常温");
  const [order, setOrder] = useState<FridgeZone[]>(inside);
  const isDefault = order.every((z, i) => z === INSIDE_ZONES[i]);
  const zonesChanged = order.some((z, i) => z !== inside[i]);
  const changed = nextSort !== sort || zonesChanged;

  return (
    <Sheet label="並べ替え" onClose={onClose}>
      <h2 className="text-[17px] font-bold">並べ替え</h2>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-xs font-bold text-sub">
          室の中の並び
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {FRIDGE_SORTS.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={nextSort === m}
              onClick={() => setNextSort(m)}
              className={cn(
                "min-h-11 rounded-full border px-3.5 text-sm",
                nextSort === m
                  ? "border-herb-mid bg-herb-soft font-bold text-herb"
                  : "border-field bg-card text-sub",
              )}
            >
              {FRIDGE_SORT_LABELS[m]}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onArrange}
          className="flex min-h-11 items-center justify-center rounded-xl border border-dashed border-field text-sm font-bold text-ink"
        >
          食材を手で並べる（↑↓）
        </button>
        <p className="text-[11.5px] text-sub">
          手で並べた順は、ほかの並びにしても消えません。「手で並べた順」に戻せばまた出ます。
        </p>
      </fieldset>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-xs font-bold text-sub">
          室の順番（うちの冷蔵庫に合わせる）
        </legend>
        <ol className="overflow-hidden rounded-2xl border border-line-soft">
          {order.map((z, i) => (
            <li
              key={z}
              className="flex items-center gap-2 border-b border-[#f3eee7] pl-3.5 last:border-b-0"
            >
              <span className="w-5 text-xs text-sub tabular-nums">{i + 1}</span>
              <span className="flex-1 text-[15px]">{z}</span>
              <button
                type="button"
                aria-label={`${z}を上へ`}
                disabled={i === 0}
                onClick={() => setOrder(moveSection(order, z, -1))}
                className="flex size-11 items-center justify-center text-sub disabled:opacity-25"
              >
                <ArrowUp className="size-4" />
              </button>
              <button
                type="button"
                aria-label={`${z}を下へ`}
                disabled={i === order.length - 1}
                onClick={() => setOrder(moveSection(order, z, 1))}
                className="flex size-11 items-center justify-center text-sub disabled:opacity-25"
              >
                <ArrowDown className="size-4" />
              </button>
            </li>
          ))}
        </ol>
        <p className="text-[11.5px] text-sub">常温の棚はいつも一番下です。</p>
        <button
          type="button"
          disabled={isDefault}
          onClick={() => setOrder([...INSIDE_ZONES])}
          className="min-h-11 text-sm text-sub underline disabled:opacity-40"
        >
          おすすめの順番に戻す
        </button>
      </fieldset>
      <PrimaryButton
        disabled={!changed}
        onClick={() =>
          onSave(
            {
              ...(nextSort !== sort ? { sort: nextSort } : {}),
              ...(zonesChanged ? { zones: isDefault ? null : order } : {}),
            },
            nextSort !== sort
              ? `${FRIDGE_SORT_LABELS[nextSort]}にしました`
              : "室の順番を変えました",
          )
        }
        className="h-12"
      >
        この並びにする
      </PrimaryButton>
      <SecondaryButton onClick={onClose}>やめる</SecondaryButton>
    </Sheet>
  );
}

/** 手で並べるときの行。同じ室の中で ↑↓ */
function ArrangeRow({
  item,
  first,
  last,
  onUp,
  onDown,
}: {
  item: PantryItem;
  first: boolean;
  last: boolean;
  onUp: () => void;
  onDown: () => void;
}) {
  return (
    <li className="flex items-center gap-1 border-t border-black/5 py-1 pr-1 pl-4">
      <span className="min-w-0 flex-1 truncate text-[15px]">{item.name}</span>
      <button
        type="button"
        aria-label={`${item.name}を上へ`}
        disabled={first}
        onClick={onUp}
        className="flex size-11 items-center justify-center rounded-lg text-sub disabled:opacity-25"
      >
        <ArrowUp className="size-4" />
      </button>
      <button
        type="button"
        aria-label={`${item.name}を下へ`}
        disabled={last}
        onClick={onDown}
        className="flex size-11 items-center justify-center rounded-lg text-sub disabled:opacity-25"
      >
        <ArrowDown className="size-4" />
      </button>
    </li>
  );
}

type ZonedItem = PantryItem & { zone: FridgeZone };

/** 室ごとの見た目（DEC-033）。冷蔵室は棚、野菜室・冷凍室は引き出し、常温は冷蔵庫の外の棚 */
const ZONE_LOOK: Record<
  FridgeZone,
  { hint: string; drawer?: boolean; box: string; head: string }
> = {
  冷蔵室: {
    hint: "卵・豆腐・作りおき",
    box: "border-frost-line bg-card",
    head: "text-frost-ink",
  },
  チルド: {
    hint: "肉・魚",
    box: "border-frost-line bg-frost",
    head: "text-frost-ink",
  },
  ドアポケット: {
    hint: "牛乳・飲み物・たれ",
    box: "border-frost-line bg-card border-t-4",
    head: "text-frost-ink",
  },
  野菜室: {
    hint: "野菜・果物",
    drawer: true,
    box: "border-herb-soft bg-herb-soft/60",
    head: "text-herb",
  },
  冷凍室: {
    hint: "冷凍したもの",
    drawer: true,
    box: "border-frost-line bg-frost-deep",
    head: "text-frost-ink",
  },
  常温: {
    hint: "じゃがいも・玉ねぎ・米・缶詰",
    box: "border-line-soft bg-memo",
    head: "text-memo-ink",
  },
};

function FridgeView({
  groups,
  renderItem,
}: {
  groups: { zone: FridgeZone; items: ZonedItem[] }[];
  renderItem: (item: ZonedItem) => React.ReactNode;
}) {
  const inside = groups.filter((g) => g.zone !== "常温");
  const shelf = groups.find((g) => g.zone === "常温");
  return (
    <div className="flex flex-col gap-3">
      {/* 冷蔵庫の本体。扉の下に引き出しが並ぶ */}
      <div
        role="group"
        aria-label="冷蔵庫"
        className="flex flex-col gap-2 rounded-[26px] border-2 border-frost-line bg-frost-deep/50 p-2"
      >
        {inside.map((g) => (
          <Compartment key={g.zone} zone={g.zone} items={g.items}>
            {g.items.map(renderItem)}
          </Compartment>
        ))}
      </div>
      {shelf && shelf.items.length > 0 && (
        <Compartment zone="常温" items={shelf.items}>
          {shelf.items.map(renderItem)}
        </Compartment>
      )}
    </div>
  );
}

function Compartment({
  zone,
  items,
  children,
}: {
  zone: FridgeZone;
  items: ZonedItem[];
  children: React.ReactNode;
}) {
  const look = ZONE_LOOK[zone];
  const title = zone === "常温" ? "常温（冷蔵庫の外）" : zone;
  return (
    <section
      aria-label={title}
      className={cn(
        "relative overflow-hidden border",
        zone === "常温" ? "rounded-2xl" : "rounded-[18px]",
        look.drawer && "rounded-t-md",
        look.box,
      )}
    >
      {look.drawer && (
        // 引き出しの取っ手
        <span
          aria-hidden
          className="mx-auto mt-1.5 block h-1.5 w-16 rounded-full bg-[#c9d6dc]"
        />
      )}
      <h3
        className={cn(
          "flex items-baseline gap-2 px-3.5 pt-2.5 pb-1 text-[13px] font-bold",
          look.head,
        )}
      >
        {title}
        <span className="text-[11px] font-normal text-sub">
          {items.length > 0 ? `${items.length}個` : look.hint}
        </span>
      </h3>
      {items.length > 0 ? (
        <ul className="bg-card/70">{children}</ul>
      ) : (
        <p className="px-3.5 pb-2.5 text-[11.5px] text-faint">空いています</p>
      )}
    </section>
  );
}

function FridgeRow({
  item,
  today,
  confirming,
  disabled,
  selected,
  onEdit,
  onToggleSelect,
  onFinishTap,
}: {
  item: PantryItem;
  today: string;
  confirming: boolean;
  disabled: boolean;
  selected: boolean;
  onEdit: () => void;
  onToggleSelect: () => void;
  onFinishTap: () => void;
}) {
  const soon = isExpiringSoon(item.expiresOn, today);
  return (
    <li className="flex items-center gap-1 border-t border-black/5 px-2.5 py-2">
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`${item.name}を選ぶ`}
        onClick={onToggleSelect}
        className="flex size-11 shrink-0 items-center justify-center"
      >
        <span
          className={cn(
            "flex size-7 items-center justify-center rounded-lg border-2",
            selected
              ? "border-herb-mid bg-herb-mid"
              : "border-[#cfc5b8] bg-card",
          )}
        >
          {selected && <Check className="size-4 text-white" strokeWidth={3} />}
        </span>
      </button>
      <button
        type="button"
        onClick={onEdit}
        className="min-h-11 min-w-0 flex-1 text-left"
      >
        <span className="block text-[15px]">{item.name}</span>
        <span className="block text-[11px] text-sub">
          {addedLabel(item.addedOn, today)}
          {item.expiresOn && (
            <span className={cn(soon && "font-bold text-danger")}>
              ・期限 {labelDate(item.expiresOn).md}
            </span>
          )}
          {item.amount && `・${item.amount}`}
        </span>
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onFinishTap}
        className={cn(
          "flex h-11 shrink-0 items-center rounded-xl border px-3 text-[13px] font-bold disabled:opacity-50",
          confirming
            ? "border-danger text-danger"
            : "border-field bg-card text-ink",
        )}
      >
        {confirming ? "本当に消す？" : "使い切った"}
      </button>
    </li>
  );
}

/** 選んだ食材を使うレシピを探し、献立に入れる */
function FindSection({
  terms,
  today,
  onToast,
}: {
  terms: string[];
  today: string;
  onToast: (msg: string) => void;
}) {
  const qc = useQueryClient();
  const to = today ? addDays(today, 13) : "";
  const plansQ = useQuery({
    queryKey: ["plans", today, to],
    queryFn: () => apiClient.plans(today, to),
    enabled: Boolean(today),
  });
  const findQ = useQuery({
    queryKey: ["find", terms],
    queryFn: () => apiClient.find(terms),
    enabled: terms.length > 0,
  });

  const addToPlan = useMutation({
    mutationFn: async (recipeId: string) => {
      const date = firstEmptyDinner(plansQ.data?.plans ?? [], today);
      await apiClient.addPlan(date, "dinner", recipeId);
      // 献立を読み直してから isPending を戻す。すぐ次を押しても
      // 古い献立のまま次の空き日を計算しないようにする
      await qc.invalidateQueries({ queryKey: ["plans"] });
      return date;
    },
    onSuccess: (date) => {
      const { md, dow } = labelDate(date);
      onToast(`${md}（${dow}）の夜に入れました`);
    },
    onError: (e) => onToast(apiErrorMessage(e)),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["recommend"] });
      qc.invalidateQueries({ queryKey: ["shopping"] });
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-[13px] font-bold text-sub">
        「{terms.join("・")}」を使うレシピ
      </h2>
      {findQ.isPending && <Loading />}
      {findQ.isError && (
        <ErrorState error={findQ.error} retry={() => findQ.refetch()} />
      )}
      {findQ.data && findQ.data.length === 0 && (
        <Empty>保存したレシピには、この食材を使うものがありません。</Empty>
      )}
      {findQ.data && findQ.data.length > 0 && (
        <ul className="flex flex-col gap-2.5">
          {findQ.data.map((r) => (
            <li
              key={r.id}
              className="flex items-center gap-2 rounded-2xl border border-line-soft bg-card p-3.5"
            >
              <Link
                to={`/recipes/${r.id}`}
                className="flex min-h-11 min-w-0 flex-1 flex-col justify-center"
              >
                <span className="block truncate text-[15px] font-bold">
                  {r.title}
                </span>
                <span className="mt-0.5 block text-[11.5px] font-bold text-herb">
                  {r.matched}個使う：{r.have.join("・")}
                </span>
              </Link>
              <button
                type="button"
                disabled={addToPlan.isPending}
                onClick={() => addToPlan.mutate(r.id)}
                className="flex h-11 shrink-0 items-center rounded-xl border border-field bg-card px-3 text-[13px] font-bold text-ink disabled:opacity-50"
              >
                献立へ
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Esc と背景タップで閉じる下からのシート。開いたら最初の入力欄にフォーカス */
function useSheetEsc(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

function AddSheet({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useSheetEsc(onClose);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const add = useMutation({
    mutationFn: (names: string[]) => apiClient.addPantry(names),
    onSuccess: (r) => {
      onClose();
      let msg =
        r.added.length > 0 ? `${r.added.length}個を冷蔵庫に入れました` : "";
      if (r.skipped.length > 0) {
        const skippedMsg = `${r.skipped.join("・")} は入れませんでした：調味料かすでにあります`;
        msg = msg ? `${msg}（${skippedMsg}）` : skippedMsg;
      }
      onDone(msg);
    },
    onError: (e) => onDone(apiErrorMessage(e)),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["pantry"] });
      qc.invalidateQueries({ queryKey: ["shopping"] });
      qc.invalidateQueries({ queryKey: ["recommend"] });
    },
  });

  const submit = () => {
    const names = splitPantryInput(draft);
    if (names.length === 0) return;
    add.mutate(names);
  };

  return (
    <div
      className="fixed inset-0 z-20 flex flex-col justify-end bg-ink/45"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="冷蔵庫に入れる"
        className="mx-auto flex w-full max-w-xl flex-col gap-3 rounded-t-3xl bg-card px-5 pt-5 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[17px] font-bold">冷蔵庫に入れる</h2>
        <p className="text-xs text-sub">
          スペースや「、」で区切るとまとめて入ります（例：玉ねぎ にんじん
          豚こま）
        </p>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            enterKeyHint="done"
            placeholder="玉ねぎ にんじん 豚こま"
            className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-paper px-3.5 text-base"
          />
          <MicButton value={draft} onChange={setDraft} label="話して入れる" />
        </div>
        <p className="text-xs text-sub">
          量と期限はあとから、書きたいものだけ。
        </p>
        <div className="flex gap-2">
          <SecondaryButton className="flex-1" onClick={onClose}>
            やめる
          </SecondaryButton>
          <PrimaryButton
            className="flex-1"
            disabled={add.isPending}
            onClick={submit}
          >
            入れる
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

function EditSheet({
  item,
  onClose,
  onDone,
}: {
  item: PantryItem;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState(item.amount ?? "");
  const [expires, setExpires] = useState(item.expiresOn ?? "");
  const auto = fridgeZone(item.name);
  // 次に買ったときに入る室（名前ごとに覚えた室があればそれ）
  const usual = item.zoneSet && !item.onlyThis && item.zone ? item.zone : auto;
  // null は「おまかせ」（名前から決める）
  const [zone, setZone] = useState<FridgeZone | null>(
    item.zoneSet ? (item.zone ?? null) : null,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  useSheetEsc(onClose);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const save = useMutation({
    mutationFn: () =>
      apiClient.updatePantry(item.id, {
        amount: amount.trim() || null,
        expiresOn: expires || null,
        // 変えたときだけ送る（同じ名前の食材の置き場所として家で覚える）
        ...(zone !== (item.zoneSet ? (item.zone ?? null) : null)
          ? { zone }
          : {}),
      }),
    onSuccess: () => onClose(),
    onError: (e) => onDone(apiErrorMessage(e)),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["pantry"] });
      qc.invalidateQueries({ queryKey: ["shopping"] });
      qc.invalidateQueries({ queryKey: ["recommend"] });
    },
  });

  return (
    <div
      className="fixed inset-0 z-20 flex flex-col justify-end bg-ink/45"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${item.name}の量・期限・置き場所`}
        className="mx-auto flex max-h-[90dvh] w-full max-w-xl flex-col gap-3 overflow-y-auto rounded-t-3xl bg-card px-5 pt-5 pb-[max(env(safe-area-inset-bottom),32px)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[17px] font-bold">{item.name}</h2>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold text-sub">量</span>
          <input
            ref={inputRef}
            value={amount}
            onChange={(e) => setAmount(e.target.value.slice(0, 40))}
            maxLength={40}
            enterKeyHint="done"
            placeholder="例：2個"
            className="h-11 rounded-xl border border-line bg-paper px-3.5 text-base"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold text-sub">期限</span>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={expires ?? ""}
              onChange={(e) => setExpires(e.target.value)}
              className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-paper px-3.5 text-base"
            />
            <SecondaryButton
              className="h-11 shrink-0 px-3 text-xs"
              onClick={() => setExpires("")}
            >
              期限なし
            </SecondaryButton>
          </div>
        </label>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-xs font-bold text-sub">置き場所</legend>
          <div className="flex flex-wrap gap-1.5">
            {FRIDGE_ZONES.map((z) => {
              const on = (zone ?? auto) === z;
              return (
                <button
                  key={z}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setZone(z === auto ? null : z)}
                  className={cn(
                    "min-h-11 rounded-full border px-3.5 text-sm",
                    on
                      ? "border-herb-mid bg-herb-soft font-bold text-herb"
                      : "border-field bg-card text-sub",
                  )}
                >
                  {z}
                </button>
              );
            })}
          </div>
          <p className="text-[11.5px] text-sub">
            {zone === null
              ? `おまかせ：「${item.name}」は${auto}に入れています`
              : zone === "冷凍室" && usual !== "冷凍室"
                ? `この品だけ冷凍室に移します（次に買った分は${usual}）`
                : `次に「${item.name}」を入れたときも${zone}に入ります`}
          </p>
        </fieldset>
        <div className="flex gap-2">
          <SecondaryButton className="flex-1" onClick={onClose}>
            やめる
          </SecondaryButton>
          <PrimaryButton
            className="flex-1"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            保存
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
