import { toast } from "sonner";

export type ToastKind = "ok" | "err" | "info";

const SONNER_KIND = { ok: "success", err: "error", info: "info" } as const;

/** 固定 id：同一时间只留一条提示，新提示替换旧的，重复调用也不会叠出多条 */
export function showToast(kind: ToastKind, title: string, description?: string) {
  toast[SONNER_KIND[kind]](title, { id: "app-toast", description });
}
