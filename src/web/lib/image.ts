// 写真は保存前にブラウザで縮める（長辺1600px・JPEG）。API は中身を触らない（DEC-008）。
const MAX_SIDE = 1600;
const MAX_BYTES = 1_000_000;

export async function shrinkImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像を処理できませんでした");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  for (const q of [0.8, 0.65, 0.5]) {
    const blob = await new Promise<Blob | null>((r) =>
      canvas.toBlob(r, "image/jpeg", q),
    );
    if (blob && blob.size <= MAX_BYTES) return blob;
  }
  throw new Error("画像が大きすぎます。別の写真を選んでください");
}
