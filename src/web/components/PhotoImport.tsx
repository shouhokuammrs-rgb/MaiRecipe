import { useMutation } from "@tanstack/react-query";
import { Camera, Image as ImageIcon } from "lucide-react";
import { useRef, useState } from "react";
import { apiClient, type ImportResult } from "@/api/client";
import { PrimaryButton, SecondaryButton } from "@/components/common";
import { shrinkImage } from "@/lib/image";

/** 縮めた JPEG を base64 の文字にする（"data:image/jpeg;base64," を外す） */
async function toBase64(blob: Blob): Promise<string> {
  const url = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("写真を読めませんでした"));
    r.readAsDataURL(blob);
  });
  return url.slice(url.indexOf(",") + 1);
}

/**
 * 料理本・レシピカードの写真から読む（#15）。写真は端末で縮めてから送り、MaiRecipe には保存しない。
 * 結果は取り込みと同じ確認画面で直してから保存する。本の名前は出典としてメモに残す
 */
export function PhotoImport({
  onResult,
}: {
  /** source：本の名前・ページ（任意。保存したらメモに「出典：…」として残す） */
  onResult: (r: ImportResult, source: string) => void;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState("");
  const read = useMutation({
    mutationFn: async (file: File) => {
      const blob = await shrinkImage(file);
      return apiClient.importPhoto(await toBase64(blob));
    },
    onSuccess: (r) => onResult(r, source.trim()),
  });
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) read.mutate(f);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-7 text-[#4a433c]">
        料理本やレシピカードのページを撮ると、AI（無料）が材料と作り方を読み取ります。文字がまっすぐ・はっきり写るように撮ってください。
      </p>
      <label className="flex flex-col gap-1.5 text-[13px] font-bold">
        本の名前・ページ（任意・出典として残します）
        <input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          maxLength={100}
          placeholder="例：はじめての和食 p.42"
          className="h-12 rounded-xl border border-field bg-card px-3.5 text-[15px] font-normal"
        />
      </label>
      {/* 撮る（カメラが開く）と、撮ってある写真から選ぶ、を分ける */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-label="レシピの写真を撮る"
        onChange={onFile}
      />
      <input
        ref={pickRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-label="レシピの写真を選ぶ"
        onChange={onFile}
      />
      <div className="grid grid-cols-2 gap-2.5">
        <PrimaryButton
          type="button"
          disabled={read.isPending}
          onClick={() => cameraRef.current?.click()}
        >
          <Camera className="size-5" />
          撮る
        </PrimaryButton>
        <SecondaryButton
          type="button"
          disabled={read.isPending}
          onClick={() => pickRef.current?.click()}
        >
          <ImageIcon className="size-5" />
          写真を選ぶ
        </SecondaryButton>
      </div>
      {read.isPending && (
        <p role="status" className="text-sm text-sub">
          読み取っています…（10秒ほど）
        </p>
      )}
      {read.isError && (
        <p role="alert" className="text-sm leading-6 text-danger">
          {read.error.message}
        </p>
      )}
      <p className="text-xs leading-5 text-sub">
        写真は MaiRecipe には保存しません（読み取りのため Google の AI
        に送ります）。家族の手書きのレシピなど、人に見せたくないものは気をつけてください。
      </p>
    </div>
  );
}
