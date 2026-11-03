import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openPath } from "@tauri-apps/plugin-opener";
import { bootstrapCapture, getCaptureScene } from "./captureMode";
import logoUrl from "./assets/asurada-logo.png";
import {
  INTRO_STEPS,
  INTRO_STORAGE_KEY,
  PREFLIGHT_CHECK_META,
} from "./introContent";
import { getRowPresentation } from "./rowPresentation";
import {
  DEFAULT_TOGGLE_SHORTCUT_DISPLAY,
  keyboardEventToShortcut,
} from "./shortcutSettings";
import { Toast, type ToastKind } from "./Toast";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  CommitPushResult,
  ICommitPushEvent,
  PreflightItem,
  PreflightResult,
  ProjectRowState,
  ProjectView,
  ToggleShortcutInfo,
} from "./types";
import "./App.css";

function summarizeCommitMessage(msg: string): string {
  const line = msg.split("\n")[0]?.trim() ?? msg;
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}

function readIntroComplete(): boolean {
  try {
    return localStorage.getItem(INTRO_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** 以 logo 为中心的插画：虚线光环慢转 + logo 悬浮 + 可选角标 */
function LogoHero({ badge }: { badge?: "+" | "!" }) {
  return (
    <div className="logo-idle" aria-hidden>
      <span className="logo-idle-ring" />
      <img src={logoUrl} alt="" />
      {badge ? (
        <span className={`logo-idle-badge${badge === "!" ? " is-warn" : ""}`}>
          {badge}
        </span>
      ) : null}
    </div>
  );
}

/** Lucide 风格线性图标（24×24 viewBox） */
function Icon({ d }: { d: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

function SettingsShortcutRow({
  active,
  initialDisplay,
  skipInvoke,
  onToast,
  onRecordingChange,
}: {
  active: boolean;
  initialDisplay?: string;
  skipInvoke?: boolean;
  onToast: (toast: { title: string; message: string; kind: ToastKind }) => void;
  onRecordingChange: (recording: boolean) => void;
}) {
  const [display, setDisplay] = useState(
    initialDisplay ?? DEFAULT_TOGGLE_SHORTCUT_DISPLAY,
  );
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    onRecordingChange(recording);
  }, [recording, onRecordingChange]);

  useEffect(() => {
    if (!active || skipInvoke || !isTauri) {
      return;
    }
    void invoke<ToggleShortcutInfo>("get_toggle_shortcut")
      .then((info) => setDisplay(info.display))
      .catch(() => {});
  }, [active, skipInvoke]);

  useEffect(() => {
    if (!recording) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setRecording(false);
        return;
      }
      const shortcut = keyboardEventToShortcut(event);
      if (!shortcut) {
        return;
      }
      if (skipInvoke || !isTauri) {
        setDisplay("⌥⌘K");
        setRecording(false);
        return;
      }
      void invoke<ToggleShortcutInfo>("set_toggle_shortcut", { shortcut })
        .then((info) => {
          setDisplay(info.display);
          setRecording(false);
        })
        .catch((e) => {
          onToast({
            title: "快捷键不可用",
            message: String(e),
            kind: "err",
          });
          setRecording(false);
        });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, skipInvoke, onToast]);

  return (
    <button
      type="button"
      className={`settings-row settings-row--shortcut${recording ? " is-recording" : ""}`}
      onClick={() => setRecording(true)}
      disabled={recording}
    >
      <span className="settings-row-label">自定义快捷键</span>
      <span className="settings-kbd-pill">
        {recording ? "按下新组合…" : display}
      </span>
    </button>
  );
}

interface IDiffWindowSize {
  width: number;
  height: number;
}

const DIFF_WINDOW_PRESETS: IDiffWindowSize[] = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1680, height: 1050 },
  { width: 1920, height: 1200 },
];

/** diff 窗口默认尺寸；用户拖拽窗口后后端会自动记下，这里显示的就是最新值 */
function SettingsDiffSizeRow({ active, skipInvoke }: { active: boolean; skipInvoke?: boolean }) {
  const [size, setSize] = useState<IDiffWindowSize>({ width: 1680, height: 1050 });

  useEffect(() => {
    if (!active || skipInvoke || !isTauri) {
      return;
    }
    void invoke<IDiffWindowSize>("get_diff_window_size")
      .then(setSize)
      .catch((e) => console.error("读取 diff 窗口尺寸失败", e));
  }, [active, skipInvoke]);

  async function onChangeSize(value: string) {
    const [width, height] = value.split("x").map(Number);
    setSize({ width, height });
    if (skipInvoke || !isTauri) {
      return;
    }
    try {
      setSize(await invoke<IDiffWindowSize>("set_diff_window_size", { width, height }));
    } catch (e) {
      console.error("设置 diff 窗口尺寸失败", e);
    }
  }

  const value = `${size.width}x${size.height}`;
  const isPreset = DIFF_WINDOW_PRESETS.some((p) => `${p.width}x${p.height}` === value);

  return (
    <div className="settings-row">
      <span className="settings-row-label">变更窗口大小</span>
      <Select value={value} onValueChange={(v) => void onChangeSize(v)}>
        <SelectTrigger size="sm" className="settings-select">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" align="end">
          {/* 拖拽出来的非预设尺寸也要能显示 */}
          {isPreset ? null : (
            <SelectItem value={value}>
              {size.width} × {size.height}（自定义）
            </SelectItem>
          )}
          {DIFF_WINDOW_PRESETS.map((p) => (
            <SelectItem key={`${p.width}x${p.height}`} value={`${p.width}x${p.height}`}>
              {p.width} × {p.height}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function SettingsAutostartRow({ skipInvoke }: { skipInvoke?: boolean }) {
  const [isEnabled, setIsEnabled] = useState(false);

  useEffect(() => {
    if (skipInvoke || !isTauri) {
      return;
    }
    void invoke<boolean>("plugin:autostart|is_enabled")
      .then(setIsEnabled)
      .catch((e) => console.error("读取开机启动状态失败", e));
  }, [skipInvoke]);

  async function onToggleAutostart() {
    const next = !isEnabled;
    setIsEnabled(next);
    if (skipInvoke || !isTauri) {
      return;
    }
    try {
      await invoke(next ? "plugin:autostart|enable" : "plugin:autostart|disable");
    } catch (e) {
      console.error("设置开机启动失败", e);
      setIsEnabled(!next);
    }
  }

  return (
    <label className="settings-row">
      <span className="settings-row-label">开机自动启动</span>
      <Switch checked={isEnabled} onCheckedChange={() => void onToggleAutostart()} />
    </label>
  );
}

const captureScene = getCaptureScene();
const captureBoot = captureScene ? bootstrapCapture(captureScene) : null;
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function App() {
  const [panelOpen, setPanelOpen] = useState(
    () => captureBoot?.panelOpen ?? true,
  );
  const [introComplete, setIntroComplete] = useState(
    () => captureBoot?.introComplete ?? readIntroComplete(),
  );
  const [introStep, setIntroStep] = useState(() => {
    if (captureBoot) return captureBoot.introStep;
    return readIntroComplete() ? -1 : 0;
  });
  const [settingsOpen, setSettingsOpen] = useState(
    () => captureBoot?.settingsOpen ?? false,
  );
  const shortcutRecordingRef = useRef(false);
  const handleShortcutRecordingChange = useCallback((recording: boolean) => {
    shortcutRecordingRef.current = recording;
  }, []);
  const [rows, setRows] = useState<ProjectRowState[]>(
    () => captureBoot?.rows ?? [],
  );
  const [loading, setLoading] = useState(() => captureBoot?.loading ?? true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<PreflightResult | null>(
    () => captureBoot?.preflight ?? null,
  );
  const [preflightLoading, setPreflightLoading] = useState(
    () => captureBoot?.preflightLoading ?? false,
  );
  const [toast, setToast] = useState<{
    title: string;
    message: string;
    kind: ToastKind;
  } | null>(() => captureBoot?.toast ?? null);
  const cloudRef = useRef<HTMLDivElement>(null);
  const bodyInnerRef = useRef<HTMLDivElement>(null);
  const [bodyHeight, setBodyHeight] = useState<number | null>(null);
  const [rowOrder, setRowOrder] = useState<string[]>([]);
  // 重复添加时闪烁高亮的已有项目
  const [flashId, setFlashId] = useState<string | null>(null);
  // 启动后首次拿到列表也排一次
  const [isOrderPending, setIsOrderPending] = useState(true);
  const [cloudBand, setCloudBand] = useState(0);
  const [isPanelClosing, setIsPanelClosing] = useState(false);
  const [isTagHot, setIsTagHot] = useState(false);
  const [isTagDragging, setIsTagDragging] = useState(false);
  const [isPanelFromBottom, setIsPanelFromBottom] = useState(false);
  const panelOpenRef = useRef(panelOpen);
  panelOpenRef.current = panelOpen;
  const isPickingRef = useRef(false);
  const isClosingRef = useRef(false);

  // 先播放收起动画，结束后再缩窗
  const onCollapsePanel = useCallback(() => {
    if (!panelOpenRef.current || isPickingRef.current || isClosingRef.current) {
      return;
    }
    isClosingRef.current = true;
    setIsPanelClosing(true);
    window.setTimeout(() => {
      isClosingRef.current = false;
      setPanelOpen(false);
      setIsPanelClosing(false);
    }, 220);
  }, []);

  // 先把壳窗拉到展开尺寸，再挂上面板。否则面板会在收起态的矮窗口里排一次，高度被 100vh 压住，窗变大后再撑开。
  const onExpandPanel = useCallback(() => {
    if (panelOpenRef.current) {
      return;
    }
    const show = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setPanelOpen(true));
      });
    };
    if (!isTauri) {
      setPanelOpen(true);
      return;
    }
    void invoke("sync_dock_geometry", { expanded: true }).then(show, show);
  }, []);

  const [isCheckOpen, setIsCheckOpen] = useState(false);
  const envReady = preflight?.ready === true;
  const inIntro = introStep >= 0;
  const inMain = introComplete && !inIntro && envReady && !preflightLoading;
  const isEnvFailed =
    introComplete && !inIntro && !preflightLoading && preflight?.ready === false;

  const hasUnreadFailure = useMemo(
    () => rows.some((r) => r.uiState === "failure"),
    [rows],
  );
  const isAnyDirty = rows.some((r) => !r.project.gitClean);
  const isAnyRunning = rows.some((r) => r.uiState === "running");

  const refreshList = useCallback(async () => {
    if (captureBoot?.skipInvoke) {
      setLoading(false);
      return;
    }
    setLoadError(null);
    try {
      const projects = await invoke<ProjectView[]>("list_projects");
      setRows((prev) => {
        const prevById = new Map(prev.map((r) => [r.project.id, r]));
        return projects.map((project) => {
          const old = prevById.get(project.id);
          if (old && old.uiState === "running") {
            return { ...old, project };
          }
          if (old && (old.uiState === "success" || old.uiState === "failure")) {
            return { ...old, project };
          }
          return { project, uiState: "idle" as const };
        });
      });
    } catch (e) {
      setLoadError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (captureBoot) return;
    if (introComplete) {
      void refreshList();
    }
  }, [introComplete, refreshList]);

  useEffect(() => {
    if (captureBoot || !panelOpen || !inMain) {
      return;
    }
    void refreshList().then(() => setIsOrderPending(true));
  }, [panelOpen, inMain, refreshList]);

  // 只在展开面板（及启动）时排一次：待提交在前；之后刷新、提交不再换位置
  useEffect(() => {
    // 列表还没加载时先等着，否则会拿空列表把这次排序用掉
    if (!isOrderPending || rows.length === 0) {
      return;
    }
    setIsOrderPending(false);
    setRowOrder(
      [...rows]
        .sort((a, b) => Number(a.project.gitClean) - Number(b.project.gitClean))
        .map((r) => r.project.id),
    );
  }, [isOrderPending, rows]);

  // 收起时定时刷新，让 Tag 上的待提交圆点跟上外部改动；展开时已由上面的 effect 刷新
  useEffect(() => {
    if (captureBoot || panelOpen || !introComplete) {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshList();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [panelOpen, introComplete, refreshList]);

  const runPreflight = useCallback(async () => {
    if (captureBoot?.skipInvoke) return;
    setPreflightLoading(true);
    try {
      const result = await invoke<PreflightResult>("preflight");
      setPreflight(result);
      if (result.ready) {
        setIsCheckOpen(false);
      }
    } catch (e) {
      setPreflight({
        ready: false,
        checks: [],
        summary: String(e),
      });
    } finally {
      setPreflightLoading(false);
    }
  }, []);

  useEffect(() => {
    if (captureBoot) return;
    if (introComplete && !inIntro) {
      void runPreflight();
    }
  }, [introComplete, inIntro, runPreflight]);

  useEffect(() => {
    if (captureBoot || !isTauri) return;

    let unlistenPanel: (() => void) | undefined;

    void (async () => {
      unlistenPanel = await listen<boolean>("set-panel-open", (event) => {
        if (event.payload) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => setPanelOpen(true));
          });
        } else {
          onCollapsePanel();
        }
      });
    })();

    return () => {
      unlistenPanel?.();
    };
  }, [onCollapsePanel]);

  const onCommitPushEvent = useCallback(async (event: ICommitPushEvent) => {
    const { id, phase, result } = event;
    if (phase === "running") {
      setRows((prev) =>
        prev.map((r) => (r.project.id === id ? { ...r, uiState: "running" } : r)),
      );
      return;
    }
    let refreshed: ProjectView | null = null;
    try {
      refreshed = await invoke<ProjectView>("refresh_project_status", { id });
    } catch (e) {
      console.error("刷新项目状态失败", e);
    }
    const isSuccess = !!(result?.success && result.commitMessage);
    const message = isSuccess
      ? summarizeCommitMessage(result?.commitMessage ?? "")
      : (result?.error ?? "提交失败");
    setToast(
      isSuccess
        ? { title: "已推送", message, kind: "ok" }
        : { title: "失败", message, kind: "err" },
    );
    setRows((prev) =>
      prev.map((r) =>
        r.project.id === id
          ? {
              project: refreshed ?? r.project,
              uiState: isSuccess ? "success" : "failure",
              resultSummary: isSuccess ? `已推送 · ${message}` : message,
            }
          : r,
      ),
    );
    if (isSuccess) {
      // 成功绿色只短暂提示，之后回到普通灰色
      setTimeout(() => {
        setRows((prev) =>
          prev.map((r) =>
            r.project.id === id && r.uiState === "success"
              ? { project: r.project, uiState: "idle" }
              : r,
          ),
        );
      }, 3000);
    }
  }, []);

  useEffect(() => {
    if (captureBoot || !isTauri) return;
    let unlisten: (() => void) | undefined;
    void listen<ICommitPushEvent>("commit-push", (event) => {
      void onCommitPushEvent(event.payload);
    }).then((stop) => {
      unlisten = stop;
    });
    return () => unlisten?.();
  }, [onCommitPushEvent]);

  useEffect(() => {
    if (captureBoot || !isTauri) return;
    let unlisten: (() => void) | undefined;
    void listen<boolean>("tag-hot", (event) => {
      setIsTagHot(event.payload);
    }).then((stop) => {
      unlisten = stop;
    });
    let unlistenDrag: (() => void) | undefined;
    void listen<boolean>("tag-dragging", (event) => {
      setIsTagDragging(event.payload);
    }).then((stop) => {
      unlistenDrag = stop;
    });
    let unlistenAnchor: (() => void) | undefined;
    void listen<boolean>("panel-from-bottom", (event) => {
      setIsPanelFromBottom(event.payload);
    }).then((stop) => {
      unlistenAnchor = stop;
      void invoke("sync_dock_geometry", {
        expanded: panelOpenRef.current,
      }).catch(() => {});
    });
    return () => {
      unlisten?.();
      unlistenDrag?.();
      unlistenAnchor?.();
    };
  }, []);

  useEffect(() => {
    if (captureBoot || !isTauri) return;
    if (panelOpen) {
      return;
    }
    void invoke("sync_dock_geometry", { expanded: false }).catch(() => {});
  }, [panelOpen]);

  useEffect(() => {
    if (!toast || captureBoot) {
      return;
    }
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // 按云朵实际高度给窗口留位，文案长短不同时 Tag 不会被盖住
  // 面板内容高度变化（切页、增删项目）时，用显式高度做过渡动画
  useLayoutEffect(() => {
    const el = bodyInnerRef.current;
    if (!panelOpen || !el) {
      setBodyHeight(null);
      return;
    }
    const observer = new ResizeObserver(() => setBodyHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [panelOpen]);

  useLayoutEffect(() => {
    const el = cloudRef.current;
    if (panelOpen || !el) {
      setCloudBand(0);
      return;
    }
    // Tag 顶边 = band + 22，尾巴尖 = 8 + 高度 + 6；+4 让尾巴尖停在 Tag 上方 12px
    setCloudBand(Math.ceil(el.offsetHeight + 4));
  }, [panelOpen, toast]);

  useEffect(() => {
    if (captureBoot || !isTauri) {
      return;
    }
    void invoke("set_result_cloud", { band: cloudBand }).catch((error) => {
      console.error("同步结果提示高度失败", error);
    });
  }, [cloudBand]);

  useEffect(() => {
    if (captureBoot) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (shortcutRecordingRef.current) {
          return;
        }
        if (settingsOpen) {
          setSettingsOpen(false);
          return;
        }
        onCollapsePanel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCollapsePanel, settingsOpen]);

  useEffect(() => {
    if (captureBoot || !isTauri) return;

    let unlistenBlur: (() => void) | undefined;
    let unlistenDock: (() => void) | undefined;

    void (async () => {
      const win = getCurrentWindow();
      unlistenBlur = await win.listen("tauri://blur", onCollapsePanel);
      unlistenDock = await listen("dock-blur", onCollapsePanel);
    })();

    return () => {
      unlistenBlur?.();
      unlistenDock?.();
    };
  }, [onCollapsePanel]);

  function finishIntro() {
    try {
      localStorage.setItem(INTRO_STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
    setIntroComplete(true);
    setIntroStep(-1);
    void refreshList();
  }

  function replayIntro() {
    setSettingsOpen(false);
    setIntroStep(0);
  }

  async function handleAddProject() {
    if (!inMain) return;
    isPickingRef.current = true;
    let selected: string | null = null;
    try {
      selected = await invoke<string | null>("pick_project_directory");
    } finally {
      isPickingRef.current = false;
    }
    if (selected == null) return;
    try {
      const added = await invoke<ProjectView>("add_project", { path: selected });
      setRows((prev) => [...prev, { project: added, uiState: "idle" }]);
    } catch (e) {
      const message = String(e);
      // 与 commands.rs 的 DUPLICATE_PROJECT_PREFIX 一致
      if (message.startsWith("DUPLICATE_PROJECT:")) {
        setToast({ title: "已在列表中", message: "这个项目之前加过啦", kind: "info" });
        setFlashId(message.slice("DUPLICATE_PROJECT:".length));
        return;
      }
      console.error("添加项目失败", e);
      setLoadError(message);
    }
  }

  async function handleRemove(id: string) {
    try {
      await invoke("remove_project", { id });
      setRows((prev) => prev.filter((r) => r.project.id !== id));
    } catch (e) {
      setLoadError(String(e));
    }
  }

  // 状态由后端 commit-push 事件驱动（见下方 useEffect），diff 窗口发起的提交也会同步过来
  async function handleCommitPush(row: ProjectRowState) {
    if (!inMain || row.project.gitClean || row.uiState === "running") {
      return;
    }
    try {
      await invoke<CommitPushResult>("run_commit_push", { id: row.project.id });
    } catch (e) {
      console.error("提交并推送失败", e);
    }
  }

  const projectCount = rows.length;
  const showHeaderAdd = inMain;

  return (
    <div
      className={`desktop${panelOpen ? " desktop--expanded" : " desktop--tag"}${
        isTagHot ? " is-hot" : ""
      }${isTagDragging ? " is-dragging" : ""}`}
      style={{ "--cloud-band": `${cloudBand}px` } as CSSProperties}
    >
      {panelOpen ? null : (
        <>
          {toast ? (
            <div ref={cloudRef} className={`cloud cloud--${toast.kind}`} role="status">
              <span className="cloud-icon" aria-hidden>
                <Icon
                  d={
                    toast.kind === "ok"
                      ? "M20 6 9 17l-5-5"
                      : toast.kind === "info"
                        ? "M12 7v6M12 17h.01"
                        : "M18 6 6 18M6 6l12 12"
                  }
                />
              </span>
              <span className="cloud-body">
                <strong>{toast.title}</strong>
                <span>{toast.message}</span>
              </span>
              <svg className="cloud-timer" aria-hidden>
                <defs>
                  <linearGradient id="cloud-timer-grad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" />
                    <stop offset="1" />
                  </linearGradient>
                </defs>
                <rect width="100%" height="100%" rx="15" pathLength="100" />
              </svg>
            </div>
          ) : null}
          <div className="tag-handle" aria-hidden>
            <span />
            <span />
            <span />
          </div>
          <button
            type="button"
            className={`tag${isTagHot ? " tag--hot" : ""}`}
            aria-expanded={false}
            aria-label="ASURADA"
            title="ASURADA"
            onClick={onExpandPanel}
          >
          <span className={`tag-logo-wrap${isAnyRunning ? " is-running" : ""}`}>
            <img className="tag-logo" src={logoUrl} alt="" />
          </span>
          {hasUnreadFailure ? (
            <span className="tag-pending is-failed" aria-label="有项目提交失败" />
          ) : isAnyDirty ? (
            <span className="tag-pending" aria-label="有项目待提交" />
          ) : null}
        </button>
        </>
      )}

      {panelOpen ? (
        <aside
          className={`panel${isPanelFromBottom ? " panel--up" : ""}${
            isPanelClosing ? " panel--closing" : ""
          }`}
          role="dialog" aria-label="ASURADA 面板">
          <header className="chrome">
            <div className="title-wrap">
              <div className="brand">
                <img src={logoUrl} alt="" />
              </div>
              <h1 className="title">ASURADA</h1>
              {isEnvFailed ? (
                <button
                  type="button"
                  className="env-warn"
                  aria-label="环境异常，查看检查"
                  title="环境异常，查看检查"
                  onClick={() => setIsCheckOpen((open) => !open)}
                >
                  <Icon d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" />
                </button>
              ) : null}
            </div>
            <div className="chrome-actions">
              {showHeaderAdd ? (
                <button
                  type="button"
                  className="btn-icon"
                  aria-label="添加项目"
                  title="添加项目"
                  onClick={() => void handleAddProject()}
                >
                  <Icon d="M12 5v14M5 12h14" />
                </button>
              ) : null}
              {inMain ? (
                <button
                  type="button"
                  className={`btn-icon${settingsOpen ? " is-active" : ""}`}
                  aria-label="设置"
                  title="设置"
                  aria-pressed={settingsOpen}
                  onClick={() => setSettingsOpen((o) => !o)}
                >
                    <Icon d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
                </button>
              ) : null}
              <button
                type="button"
                className="btn-icon"
                aria-label="收起"
                title="收起"
                onClick={onCollapsePanel}
              >
                <Icon d="m9 18 6-6-6-6" />
              </button>
            </div>
          </header>

          {loadError ? <p className="banner-error">{loadError}</p> : null}

          <div
            className="panel-body"
            style={bodyHeight === null ? undefined : { height: bodyHeight }}
          >
            <div ref={bodyInnerRef} className="panel-body-inner">
            {inMain && projectCount > 0 && !settingsOpen ? (
              <div className="risk" role="status">
                <span className="ico">!</span>
                <span>一键会暂存、提交并推送到远端哦</span>
              </div>
            ) : null}

            {inIntro ? (
              <IntroView
                step={introStep}
                onSkip={finishIntro}
                onNext={() =>
                  setIntroStep((s) =>
                    s >= INTRO_STEPS.length - 1 ? s : s + 1,
                  )
                }
                onStart={finishIntro}
              />
            ) : settingsOpen && inMain ? (
              <div className="settings">
                <div className="settings-list">
                  <SettingsShortcutRow
                    active={settingsOpen}
                    initialDisplay={captureBoot?.toggleShortcutDisplay}
                    skipInvoke={captureBoot?.skipInvoke}
                    onToast={setToast}
                    onRecordingChange={handleShortcutRecordingChange}
                  />
                  <SettingsDiffSizeRow
                    active={settingsOpen}
                    skipInvoke={captureBoot?.skipInvoke}
                  />
                  <SettingsAutostartRow skipInvoke={captureBoot?.skipInvoke} />
                  <button type="button" className="settings-row" onClick={replayIntro}>
                    <span className="settings-row-label">查看引导</span>
                    <span className="settings-chevron" aria-hidden>
                      ›
                    </span>
                  </button>
                </div>
                <div className="settings-foot">
                  <button
                    type="button"
                    className="btn-text"
                    onClick={() => setSettingsOpen(false)}
                  >
                    返回
                  </button>
                </div>
              </div>
            ) : preflightLoading ? (
              <PreflightGateView loading checks={preflight?.checks} />
            ) : isCheckOpen && isEnvFailed && preflight ? (
              <PreflightFailView
                result={preflight}
                onRecheck={() => void runPreflight()}
                onBack={() => setIsCheckOpen(false)}
              />
            ) : loading ? (
              <p className="muted">加载中…</p>
            ) : projectCount === 0 ? (
              <div className="empty">
                <LogoHero badge="+" />
                <h2>还没有项目呢</h2>
                <p>添加本地 git 仓库后，就能一键生成提交并推送啦</p>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!inMain}
                  onClick={() => void handleAddProject()}
                >
                  添加项目
                </button>
              </div>
            ) : (
              <ul className="list">
                {/* 按展开时定下的顺序；之后新加的项目排在末尾 */}
                {[...rows]
                  .sort(
                    (a, b) =>
                      (rowOrder.indexOf(a.project.id) + 1 || rowOrder.length + 1) -
                      (rowOrder.indexOf(b.project.id) + 1 || rowOrder.length + 1),
                  )
                  .map((row) => (
                  <ProjectRow
                    key={row.project.id}
                    row={row}
                    canCommit={inMain}
                    onCommit={() => void handleCommitPush(row)}
                    onRemove={() => void handleRemove(row.project.id)}
                    isFlashing={flashId === row.project.id}
                    onFlashEnd={() => setFlashId(null)}
                  />
                ))}
              </ul>
            )}
            </div>
          </div>
        </aside>
      ) : null}

      {toast && panelOpen ? (
        <Toast
          message={`${toast.title} · ${toast.message}`}
          kind={toast.kind}
          onDismiss={() => setToast(null)}
        />
      ) : null}
    </div>
  );
}

function IntroView({
  step,
  onSkip,
  onNext,
  onStart,
}: {
  step: number;
  onSkip: () => void;
  onNext: () => void;
  onStart: () => void;
}) {
  const content = INTRO_STEPS[step];
  const isLast = step === INTRO_STEPS.length - 1;

  return (
    <div className="intro step">
      <LogoHero />
      <h2>{content.title}</h2>
      {"sub" in content && content.sub ? (
        <p className="sub">{content.sub}</p>
      ) : null}
      <p className="lead">{content.lead}</p>
      <div className="dots" aria-hidden>
        {INTRO_STEPS.map((_, i) => (
          <span key={i} className={i === step ? "on" : undefined} />
        ))}
      </div>
      <div className="intro-actions">
        <button type="button" className="linkish" onClick={onSkip}>
          跳过
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={isLast ? onStart : onNext}
        >
          {isLast ? "开始使用" : "下一步"}
        </button>
      </div>
    </div>
  );
}

function PreflightGateView({
  loading,
  checks,
}: {
  loading: boolean;
  checks?: PreflightItem[];
}) {
  const items = checks?.length
    ? checks
    : [
        { id: "pi_path", ok: false, message: "" },
        { id: "pi_print", ok: false, message: "" },
        { id: "git", ok: false, message: "" },
      ];

  return (
    <div className="gate">
      {loading ? (
        <div className="logo-loader" aria-hidden>
          <span className="logo-loader-ring" />
          <span className="logo-loader-orbit">
            <i />
            <i />
          </span>
          <img src={logoUrl} alt="" />
        </div>
      ) : null}
      <h2>{loading ? "正在检查本机环境" : "环境检查"}</h2>
      <p>依赖本机 pi agent，先确认能不能跑～</p>
      <div className="checks">
        {items.map((c) => (
          <PreflightCheckRow key={c.id} item={c} loading={loading} />
        ))}
      </div>
    </div>
  );
}

function PreflightFailView({
  result,
  onRecheck,
  onBack,
}: {
  result: PreflightResult;
  onRecheck: () => void;
  onBack: () => void;
}) {
  return (
    <div className="gate">
      <LogoHero badge="!" />
      <h2>本机还差一点</h2>
      <p>环境没齐的话没法提交并推送，先修好再来呀</p>
      <div className="checks">
        {result.checks.map((c) => (
          <PreflightCheckRow key={c.id} item={c} loading={false} />
        ))}
      </div>
      <div className="gate-actions">
        <button type="button" className="btn-text" onClick={onBack}>
          返回
        </button>
        <button type="button" className="btn-primary" onClick={onRecheck}>
          重新检查
        </button>
      </div>
      <p className="muted" style={{ marginTop: 12, fontSize: 11 }}>
        {result.summary}
      </p>
    </div>
  );
}

function PreflightCheckRow({
  item,
  loading,
}: {
  item: PreflightItem;
  loading: boolean;
}) {
  const meta = PREFLIGHT_CHECK_META[item.id] ?? {
    label: item.id,
    detail: item.message,
  };
  const state = loading ? "wait" : item.ok ? "ok" : "bad";
  const mark = loading ? "…" : item.ok ? "✓" : "!";

  return (
    <div className={`check ${state}`}>
      <span className="mark">{mark}</span>
      <div>
        <div className="label">{meta.label}</div>
        <div className="detail">
          {!item.ok && item.message ? item.message : meta.detail}
        </div>
      </div>
    </div>
  );
}

/** 提交信息最多两行；被截断时悬停显示完整内容 */
function CommitTip({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Tooltip
      open={isOpen}
      onOpenChange={(open) => {
        const el = ref.current;
        setIsOpen(open && !!el && el.scrollHeight > el.clientHeight + 1);
      }}
    >
      <TooltipTrigger asChild>
        <span ref={ref} className="status-text">
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="max-w-[220px]">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

function ProjectRow({
  row,
  canCommit,
  onCommit,
  onRemove,
  isFlashing,
  onFlashEnd,
}: {
  row: ProjectRowState;
  canCommit: boolean;
  onCommit: () => void;
  onRemove: () => void;
  isFlashing: boolean;
  onFlashEnd: () => void;
}) {
  const [isConfirming, setIsConfirming] = useState(false);
  const rowRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (isFlashing) {
      rowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [isFlashing]);
  const pres = getRowPresentation(row);
  const isRunning = row.uiState === "running";
  const primaryDisabled = pres.btnDisabled || !canCommit || isRunning;

  async function onOpenFolder() {
    try {
      await openPath(row.project.path);
    } catch (error) {
      console.error("打开文件夹失败", error);
    }
  }

  // 只有有变更的条目可点；点在行内按钮上时交给按钮自己处理
  const isDiffable = !row.project.gitClean && !isRunning;

  async function onOpenDiff(event: React.MouseEvent) {
    if (!isDiffable || isConfirming || (event.target as HTMLElement).closest("button")) {
      return;
    }
    try {
      await invoke("open_diff_window", { id: row.project.id });
    } catch (error) {
      console.error("打开 diff 窗口失败", error);
    }
  }

  return (
    <li
      ref={rowRef}
      className={`row${isFlashing ? " is-flashing" : ""}${isDiffable ? " is-diffable" : ""}`}
      title={isDiffable ? "查看变更" : undefined}
      onClick={(event) => void onOpenDiff(event)}
      onAnimationEnd={(e) => {
        if (e.animationName === "row-flash") {
          onFlashEnd();
        }
      }}
    >
      <div className="meta">
        <div className="name" title={row.project.path}>
          {row.project.displayName}
        </div>
      </div>
      <button
        type="button"
        className={`btn-primary${pres.btnBusy ? " busy" : ""}`}
        disabled={primaryDisabled}
        title={pres.btnTitle}
        onClick={onCommit}
      >
        {pres.btnBusy ? "提交中…" : "提交并推送"}
      </button>
      <div className={`git-status ${pres.kind}`}>
        <span className="pip" aria-hidden />
        <CommitTip text={pres.statusText} />
      </div>
      <div className="row-tools">
        <button
          type="button"
          className="row-open"
          aria-label="打开文件夹"
          title="打开文件夹"
          disabled={isRunning}
          onClick={onOpenFolder}
        >
          <Icon d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
        </button>
        <button
          type="button"
          className={`row-remove${isConfirming ? " is-open" : ""}`}
          aria-label="移除项目"
          disabled={isRunning}
          onClick={() => setIsConfirming(true)}
        >
          <Icon d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />
        </button>
      </div>
      {isConfirming ? (
        <div className="row-confirm" role="alertdialog" aria-label="确认移除">
          <span>从列表移除？本地仓库还在</span>
          <button type="button" onClick={() => setIsConfirming(false)}>
            取消
          </button>
          <button type="button" className="is-danger" onClick={onRemove}>
            移除
          </button>
        </div>
      ) : null}
    </li>
  );
}

export default App;
