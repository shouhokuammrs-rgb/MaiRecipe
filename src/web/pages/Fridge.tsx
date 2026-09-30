import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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
import { Toast, useToast } from "@/components/Toast";
import { apiErrorMessage, cn } from "@/lib/utils";
import { labelDate } from "../../shared/dates";
import {
  addedLabel,
  isExpiringSoon,
  splitPantryInput,
} from "../../shared/pantry";

/** 消す確認が自動で元に戻るまでの時間 */
const CONFIRM_MS = 4000;

export function Fridge() {
  const qc = useQueryClient();
  const { toast, show } = useToast();
  const q = useQuery({ queryKey: ["pantry"], queryFn: apiClient.pantry });
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<PantryItem | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

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
    },
    onError: (e) => show(apiErrorMessage(e)),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["pantry"] });
      qc.invalidateQueries({ queryKey: ["shopping"] });
      qc.invalidateQueries({ queryKey: ["recommend"] });
    },
  });

  const items = q.data?.items ?? [];
  const today = q.data?.today ?? "";

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
            <h2 className="text-[13px] font-bold text-sub">
              冷蔵庫の中（{items.length}）
            </h2>
            <ul className="overflow-hidden rounded-2xl border border-line-soft bg-card">
              {items.map((item) => (
                <FridgeRow
                  key={item.id}
                  item={item}
                  today={today}
                  confirming={confirming === item.id}
                  disabled={del.isPending}
                  onEdit={() => setEditing(item)}
                  onFinishTap={() =>
                    confirming === item.id
                      ? del.mutate(item)
                      : setConfirming(item.id)
                  }
                />
              ))}
            </ul>
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
      <Toast message={toast} />
    </>
  );
}

function FridgeRow({
  item,
  today,
  confirming,
  disabled,
  onEdit,
  onFinishTap,
}: {
  item: PantryItem;
  today: string;
  confirming: boolean;
  disabled: boolean;
  onEdit: () => void;
  onFinishTap: () => void;
}) {
  const soon = isExpiringSoon(item.expiresOn, today);
  return (
    <li className="flex items-center gap-3 border-b border-[#f3eee7] px-3.5 py-2.5 last:border-b-0">
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
        aria-label={`${item.name}の量と期限`}
        className="mx-auto flex w-full max-w-xl flex-col gap-3 rounded-t-3xl bg-card px-5 pt-5 pb-8"
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
