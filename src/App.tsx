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
import { getRowPresentation, type RowKind } from "./rowPresentation";
import {
  DEFAULT_TOGGLE_SHORTCUT_DISPLAY,
  keyboardEventToShortcut,
} from "./shortcutSettings";
import { Toast, type ToastKind } from "./Toast";
import {
  Check,
  ChevronRight,
  FolderOpen,
  Info,
  Loader2,
  Monitor,
  Moon,
  Plus,
  Settings,
  Sun,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ThemeModeEnum, useThemeMode } from "./theme";
import { CONFIRM_COMMIT_KEY, isConfirmCommitEnabled } from "./commitConfirm";
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

/** 引导 / 环境检查 / 空态共用的标题与正文样式 */
const HEADING_CLASS = "mb-1.5 text-[15px] font-semibold text-(--ink-strong)";
const LEAD_CLASS = "mb-3.5 text-left leading-normal text-(--ink-2)";

/** 设置列表的一行 */
const SETTINGS_ROW_CLASS =
  "flex w-full items-center justify-between gap-2.5 rounded-lg px-2.5 py-2 text-left text-(--ink-2) hover:bg-accent disabled:hover:bg-transparent";

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
      className={SETTINGS_ROW_CLASS}
      onClick={() => setRecording(true)}
      disabled={recording}
    >
      <span>自定义快捷键</span>
      <Kbd
        className={
          recording
            ? "h-6 border border-dashed border-border bg-transparent px-2 font-normal"
            : "h-6 bg-accent px-2 font-mono font-semibold text-accent-foreground"
        }
      >
        {recording ? "按下新组合…" : display}
      </Kbd>
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
    <div className={SETTINGS_ROW_CLASS}>
      <span>变更窗口大小</span>
      <Select value={value} onValueChange={(v) => void onChangeSize(v)}>
        <SelectTrigger size="sm" className="min-w-32 text-xs">
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
    <label className={`${SETTINGS_ROW_CLASS} cursor-pointer`}>
      <span>开机自动启动</span>
      <Switch checked={isEnabled} onCheckedChange={() => void onToggleAutostart()} />
    </label>
  );
}

function SettingsConfirmCommitRow() {
  const [isEnabled, setIsEnabled] = useState(isConfirmCommitEnabled);

  function onToggleConfirmCommit() {
    localStorage.setItem(CONFIRM_COMMIT_KEY, isEnabled ? "0" : "1");
    setIsEnabled(!isEnabled);
  }

  return (
    <label className={`${SETTINGS_ROW_CLASS} cursor-pointer`}>
      <span>提交前确认</span>
      <Switch checked={isEnabled} onCheckedChange={onToggleConfirmCommit} />
    </label>
  );
}

const THEME_OPTIONS = [
  { value: ThemeModeEnum.Light, label: "亮色", icon: Sun },
  { value: ThemeModeEnum.Dark, label: "深色", icon: Moon },
  { value: ThemeModeEnum.System, label: "跟随系统", icon: Monitor },
];

function SettingsThemeRow() {
  const { mode, onChangeThemeMode } = useThemeMode();

  return (
    <div className={SETTINGS_ROW_CLASS}>
      <span>外观</span>
      <ToggleGroup
        type="single"
        size="sm"
        variant="outline"
        spacing={0}
        value={mode}
        aria-label="外观"
        onValueChange={(v) => {
          if (v) {
            onChangeThemeMode(v as ThemeModeEnum);
          }
        }}
      >
        {THEME_OPTIONS.map((o) => (
          <ToggleGroupItem
            key={o.value}
            value={o.value}
            className="px-2.5"
            aria-label={o.label}
            title={o.label}
          >
            <o.icon />
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

const captureScene = getCaptureScene();
const captureBoot = captureScene ? bootstrapCapture(captureScene) : null;
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function App() {
  // 常驻：跟随系统切换、接收 diff 窗口里改的主题
  useThemeMode();
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
                {toast.kind === "ok" ? <Check /> : toast.kind === "info" ? <Info /> : <X />}
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
                <Button
                  size="icon-xs"
                  className="rounded-full bg-(--warn-bg) text-(--warn-fg) hover:bg-(--risk-ico)"
                  aria-label="环境异常，查看检查"
                  title="环境异常，查看检查"
                  onClick={() => setIsCheckOpen((open) => !open)}
                >
                  <TriangleAlert />
                </Button>
              ) : null}
            </div>
            <div className="flex items-center gap-0.5 text-muted-foreground">
              {showHeaderAdd ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="添加项目"
                  title="添加项目"
                  onClick={() => void handleAddProject()}
                >
                  <Plus />
                </Button>
              ) : null}
              {inMain ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="aria-pressed:bg-accent aria-pressed:text-accent-foreground"
                  aria-label="设置"
                  title="设置"
                  aria-pressed={settingsOpen}
                  onClick={() => setSettingsOpen((o) => !o)}
                >
                  <Settings />
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="收起"
                title="收起"
                onClick={onCollapsePanel}
              >
                <ChevronRight />
              </Button>
            </div>
          </header>

          {loadError ? (
            <Alert variant="destructive" className="mx-4 mb-2.5 w-auto">
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          ) : null}

          <div
            className="panel-body"
            style={bodyHeight === null ? undefined : { height: bodyHeight }}
          >
            <div ref={bodyInnerRef} className="panel-body-inner">
            {inMain && projectCount > 0 && !settingsOpen ? (
              <div
                role="status"
                className="mb-3 flex items-center gap-1.5 px-1 text-xs leading-snug text-(--risk-fg)"
              >
                <Info className="size-3.5 flex-none" aria-hidden />
                一键会暂存全部变更、提交并推送到远端
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
              <div>
                <div className="rounded-xl border bg-card p-1.5">
                  <SettingsShortcutRow
                    active={settingsOpen}
                    initialDisplay={captureBoot?.toggleShortcutDisplay}
                    skipInvoke={captureBoot?.skipInvoke}
                    onToast={setToast}
                    onRecordingChange={handleShortcutRecordingChange}
                  />
                  <SettingsThemeRow />
                  <SettingsDiffSizeRow
                    active={settingsOpen}
                    skipInvoke={captureBoot?.skipInvoke}
                  />
                  <SettingsConfirmCommitRow />
                  <SettingsAutostartRow skipInvoke={captureBoot?.skipInvoke} />
                  <button type="button" className={SETTINGS_ROW_CLASS} onClick={replayIntro}>
                    <span>查看引导</span>
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                  </button>
                </div>
                <div className="mt-2.5 flex justify-end">
                  <Button variant="secondary" onClick={() => setSettingsOpen(false)}>
                    返回
                  </Button>
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
              <p className="p-6 text-center text-muted-foreground">加载中…</p>
            ) : projectCount === 0 ? (
              <div className="px-1 pt-8 pb-3 text-center">
                <LogoHero badge="+" />
                <h2 className={HEADING_CLASS}>还没有项目呢</h2>
                <p className={`${LEAD_CLASS} text-center`}>
                  添加本地 git 仓库后，就能一键生成提交并推送啦
                </p>
                <Button disabled={!inMain} onClick={() => void handleAddProject()}>
                  添加项目
                </Button>
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
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
                    onDiffOpened={onCollapsePanel}
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
    <div className="px-1 pt-2 pb-3 text-center">
      <LogoHero />
      <h2 className={HEADING_CLASS}>{content.title}</h2>
      {"sub" in content && content.sub ? (
        <p className="mb-2 text-xs font-medium text-muted-foreground">{content.sub}</p>
      ) : null}
      <p className={LEAD_CLASS}>{content.lead}</p>
      <div className="mb-3 flex justify-center gap-1.5" aria-hidden>
        {INTRO_STEPS.map((_, i) => (
          <span
            key={i}
            className={`h-[7px] rounded-full ${i === step ? "w-4 bg-ring" : "w-[7px] bg-(--dot-off)"}`}
          />
        ))}
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" className="text-muted-foreground" onClick={onSkip}>
          跳过
        </Button>
        <Button onClick={isLast ? onStart : onNext}>
          {isLast ? "开始使用" : "下一步"}
        </Button>
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
    <div className={GATE_CLASS}>
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
      <h2 className={HEADING_CLASS}>{loading ? "正在检查本机环境" : "环境检查"}</h2>
      <p className={`${LEAD_CLASS} text-center`}>依赖本机 pi agent，先确认能不能跑～</p>
      <div className={CHECKS_CLASS}>
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
    <div className={GATE_CLASS}>
      <LogoHero badge="!" />
      <h2 className={HEADING_CLASS}>本机还差一点</h2>
      <p className={`${LEAD_CLASS} text-center`}>环境没齐的话没法提交并推送，先修好再来呀</p>
      <div className={CHECKS_CLASS}>
        {result.checks.map((c) => (
          <PreflightCheckRow key={c.id} item={c} loading={false} />
        ))}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="ghost" className="text-muted-foreground" onClick={onBack}>
          返回
        </Button>
        <Button onClick={onRecheck}>重新检查</Button>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">{result.summary}</p>
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
  return (
    <div className="flex items-start gap-2 py-1.5 text-(--ink-2) not-first:border-t not-first:border-dashed">
      <span
        className={`grid size-[18px] flex-none place-items-center rounded-full [&_svg]:size-3 [&_svg]:stroke-3 ${
          loading
            ? "bg-accent text-accent-foreground"
            : item.ok
              ? "bg-(--ok-bg) text-(--ok)"
              : "bg-(--err-bg) text-(--err)"
        }`}
      >
        {loading ? <Loader2 className="animate-spin" /> : item.ok ? <Check /> : <X />}
      </span>
      <div>
        <div className="font-semibold text-(--ink-strong)">{meta.label}</div>
        <div className="mt-0.5 text-xs leading-snug text-muted-foreground">
          {!item.ok && item.message ? item.message : meta.detail}
        </div>
      </div>
    </div>
  );
}

const GATE_CLASS = "flex flex-col items-center px-1 pt-2 pb-3 text-center";
const CHECKS_CLASS = "mb-3.5 self-stretch rounded-xl border bg-card px-3 py-2.5 text-left";

/** 项目行状态文字与圆点的颜色 */
const STATUS_CLASS: Record<RowKind, { text: string; pip: string }> = {
  // 提交信息用等宽，更像开发工具里的 commit 列表
  clean: { text: "font-mono text-[12.5px] text-(--ink-2)", pip: "mt-[7.5px] bg-(--pip-off)" },
  dirty: {
    text: "text-(--ink-2)",
    pip: "size-1.5 bg-(--warn)",
  },
  run: { text: "text-accent-foreground", pip: "bg-ring animate-pulse" },
  ok: { text: "font-mono text-[12.5px] text-(--ok)", pip: "mt-[7.5px] bg-(--ok)" },
  err: { text: "text-(--err)", pip: "mt-[7.5px] bg-(--err)" },
};

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
        <span ref={ref} className="line-clamp-2 min-w-0 flex-1">
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="max-w-[300px] whitespace-pre-wrap">
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
  onDiffOpened,
}: {
  row: ProjectRowState;
  canCommit: boolean;
  onCommit: () => void;
  onRemove: () => void;
  isFlashing: boolean;
  onFlashEnd: () => void;
  onDiffOpened: () => void;
}) {
  // 行内确认浮层：移除项目，或开了「提交前确认」时的提交
  const [confirmAction, setConfirmAction] = useState<"remove" | "commit" | null>(null);
  const isConfirming = confirmAction !== null;
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
      onDiffOpened();
    } catch (error) {
      console.error("打开 diff 窗口失败", error);
    }
  }

  return (
    <li
      ref={rowRef}
      className={`group/row relative grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-1.5 rounded-xl border bg-card p-3 transition-[border-color,box-shadow] ${
        isDiffable
          ? "cursor-pointer hover:border-ring/60 hover:bg-(--surface-2)"
          : ""
      }${isFlashing ? " animate-[row-flash_0.7s_ease-in-out_2]" : ""}`}
      title={isDiffable ? "查看变更" : undefined}
      onClick={(event) => void onOpenDiff(event)}
      onAnimationEnd={(e) => {
        if (e.animationName === "row-flash") {
          onFlashEnd();
        }
      }}
    >
      <div
        className="min-w-0 self-center truncate text-sm font-semibold text-(--ink-strong)"
        title={row.project.path}
      >
        {row.project.displayName}
      </div>
      <Button
        size="sm"
        className={
          pres.btnBusy
            ? "disabled:bg-accent disabled:text-accent-foreground disabled:opacity-100"
            : "disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
        }
        disabled={primaryDisabled}
        title={pres.btnTitle}
        onClick={() => {
          if (isConfirmCommitEnabled()) {
            setConfirmAction("commit");
          } else {
            onCommit();
          }
        }}
      >
        {pres.btnBusy ? <Loader2 className="animate-spin" /> : null}
        {pres.btnBusy ? "提交中…" : "提交并推送"}
      </Button>
      <div
        className={`col-span-full row-start-2 mr-14 flex min-w-0 gap-1.5 leading-snug ${
          pres.kind === "dirty" || pres.kind === "run" ? "items-center" : "items-start"
        } ${STATUS_CLASS[pres.kind].text}`}
      >
        <span
          className={`size-1 flex-none rounded-full ${STATUS_CLASS[pres.kind].pip}`}
          aria-hidden
        />
        <CommitTip text={pres.statusText} />
      </div>
      {/* 提交中不允许打开/移除，直接不显示 */}
      {isRunning ? null : (
      <div className="col-start-2 row-start-2 flex gap-0.5 self-center justify-self-end text-muted-foreground">
        <Button
          variant="ghost"
          size="icon-xs"
          className="opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100"
          aria-label="打开文件夹"
          title="打开文件夹"
          onClick={onOpenFolder}
        >
          <FolderOpen />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className="opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 hover:bg-destructive/10 hover:text-destructive"
          aria-label="移除项目"
          title="移除项目"
          onClick={() => setConfirmAction("remove")}
        >
          <Trash2 />
        </Button>
      </div>
      )}
      {isConfirming ? (
        <div
          className="absolute inset-0 z-2 flex items-center justify-end gap-2 rounded-[inherit] bg-(--surface)/95 px-3 text-xs text-(--ink-strong)"
          role="alertdialog"
          aria-label={confirmAction === "commit" ? "确认提交" : "确认移除"}
        >
          <span>
            {confirmAction === "commit"
              ? "暂存全部变更、提交并推送？"
              : "从列表移除？本地仓库还在"}
          </span>
          <Button variant="outline" size="sm" onClick={() => setConfirmAction(null)}>
            取消
          </Button>
          {confirmAction === "commit" ? (
            <Button
              size="sm"
              onClick={() => {
                setConfirmAction(null);
                onCommit();
              }}
            >
              提交
            </Button>
          ) : (
            <Button
              size="sm"
              className="bg-destructive text-white hover:bg-destructive/85"
              onClick={onRemove}
            >
              移除
            </Button>
          )}
        </div>
      ) : null}
    </li>
  );
}

export default App;
