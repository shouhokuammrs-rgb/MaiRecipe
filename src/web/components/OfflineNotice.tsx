/** 電波が無く、この端末に残していたレシピを出しているときの知らせ */
export function OfflineNotice({ at }: { at?: number }) {
  if (!at) return null;
  const d = new Date(at);
  return (
    <p
      role="status"
      className="bg-memo px-4 py-2 text-xs leading-5 text-memo-ink"
    >
      電波が届かないので、この端末に残していたレシピを出しています（
      {d.getMonth() + 1}/{d.getDate()} {d.getHours()}:
      {String(d.getMinutes()).padStart(2, "0")}{" "}
      の内容）。タイマーと読み上げは使えます。
    </p>
  );
}
