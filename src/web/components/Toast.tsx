import { useEffect, useState } from "react";

/** 短い通知メッセージ。2.2秒で自動的に消える */
export function useToast() {
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(timer);
  }, [toast]);
  return { toast, show: setToast };
}

/** 下のタブの上に出す小さな帯 */
export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-20 left-1/2 z-30 -translate-x-1/2 rounded-xl bg-ink px-4 py-2 text-[13px] text-white shadow-lg"
    >
      {message}
    </div>
  );
}
