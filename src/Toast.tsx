import { useEffect } from "react";

export type ToastKind = "ok" | "err" | "info";

import { getCaptureScene } from "./captureMode";

const TOAST_CLASS: Record<ToastKind, string> = {
  ok: "border-[#c7efda] bg-[#eaf9f1] text-[#2f9a64]",
  info: "border-[#b8e6ec] bg-[#d4f4f7] text-accent-foreground",
  err: "border-[#ffc9d8] bg-[#ffe8ef] text-[#c43d5a]",
};

export function Toast({
  message,
  kind,
  onDismiss,
}: {
  message: string;
  kind: ToastKind;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (getCaptureScene()) return;
    const t = window.setTimeout(onDismiss, 4200);
    return () => window.clearTimeout(t);
  }, [message, onDismiss]);

  return (
    <div
      className={`fixed bottom-6 left-1/2 z-100 max-w-[min(320px,calc(100vw-32px))] -translate-x-1/2 truncate rounded-full border px-4 py-2.5 font-semibold shadow-[0_8px_28px_rgba(94,170,180,0.25)] animate-in fade-in slide-in-from-bottom-2 ${TOAST_CLASS[kind]}`}
      role="status"
    >
      {message}
    </div>
  );
}
