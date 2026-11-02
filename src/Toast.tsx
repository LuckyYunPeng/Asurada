import { useEffect } from "react";

export type ToastKind = "ok" | "err";

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
    const t = window.setTimeout(onDismiss, 4200);
    return () => window.clearTimeout(t);
  }, [message, onDismiss]);

  return (
    <div className={`toast toast--${kind}`} role="status">
      {message}
    </div>
  );
}
