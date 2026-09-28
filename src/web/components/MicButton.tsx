import { Mic } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { speechSupported, startListening } from "@/lib/speech";
import { cn } from "@/lib/utils";

/**
 * 話した内容を、今ある文のうしろに足していくボタン。
 * 使えないブラウザでは出さない（キーボードのマイクで代わりにできる）。
 */
export function MicButton({
  value,
  onChange,
  label = "話して入力",
}: {
  value: string;
  onChange: (text: string) => void;
  label?: string;
}) {
  const [listening, setListening] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const [supported] = useState(() => speechSupported());

  useEffect(() => () => stopRef.current?.(), []);

  if (!supported) return null;

  const toggle = () => {
    if (listening) {
      stopRef.current?.();
      return;
    }
    const base = value.trim();
    const stop = startListening(
      (spoken) => onChange(base ? `${base} ${spoken}` : spoken),
      () => {
        setListening(false);
        stopRef.current = null;
      },
    );
    if (stop) {
      stopRef.current = stop;
      setListening(true);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={listening}
      className={cn(
        "flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-bold",
        listening
          ? "border-[#e3b7a5] bg-accent-soft text-accent-deep"
          : "border-field bg-card text-ink",
      )}
    >
      <Mic className="size-4" />
      {listening ? "聞き取り中…タップで終了" : label}
    </button>
  );
}
