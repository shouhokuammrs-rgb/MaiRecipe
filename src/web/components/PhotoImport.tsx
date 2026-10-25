import { useMutation } from "@tanstack/react-query";
import { Camera } from "lucide-react";
import { useRef } from "react";
import { apiClient, type ImportResult } from "@/api/client";
import { PrimaryButton } from "@/components/common";
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
 * 料理本・レシピカードの写真から読む（#15）。写真は端末で縮めてから送り、保存はしない。
 * 結果は取り込みと同じ確認画面で直してから保存する
 */
export function PhotoImport({
  onResult,
}: {
  onResult: (r: ImportResult) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const read = useMutation({
    mutationFn: async (file: File) => {
      const blob = await shrinkImage(file);
      return apiClient.importPhoto(await toBase64(blob));
    },
    onSuccess: onResult,
  });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-7 text-[#4a433c]">
        料理本やレシピカードのページを撮ると、AI（無料）が材料と作り方を読み取ります。写真は保存しません。文字がまっすぐ・はっきり写るように撮ってください。
      </p>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label="レシピの写真を選ぶ"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) read.mutate(f);
        }}
      />
      <PrimaryButton
        type="button"
        disabled={read.isPending}
        onClick={() => fileRef.current?.click()}
      >
        <Camera className="size-5" />
        {read.isPending ? "読み取っています…（10秒ほど）" : "写真を撮る・選ぶ"}
      </PrimaryButton>
      {read.isError && (
        <p role="alert" className="text-sm leading-6 text-danger">
          {read.error.message}
        </p>
      )}
    </div>
  );
}
