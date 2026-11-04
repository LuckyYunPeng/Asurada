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
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { bootstrapCapture, getCaptureScene } from "./captureMode";
import logoUrl from "./assets/asurada-logo.png";
import { INTRO_STORAGE_KEY } from "./introContent";
import { getMessages, LanguageEnum, readLanguage, setLanguage, useLanguage } from "./i18n";
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

// 打开过一次 diff 窗口就算学会了，之后不再提示
const DIFF_HINT_SEEN_KEY = "asurada.diffHintSeen";
// 成功提交过一次就知道「一键会推送」了，顶部提示不再常驻
const COMMIT_HINT_SEEN_KEY = "asurada.commitHintSeen";

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
  "flex min-h-11 w-full items-center justify-between gap-2.5 rounded-lg px-3 py-2.5 text-left text-(--ink-2) hover:bg-accent disabled:hover:bg-transparent";

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
  const { t } = useLanguage();

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
            title: t.shortcutUnavailable,
            message: String(e),
            kind: "err",
          });
          setRecording(false);
        });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, skipInvoke, onToast, t]);

  return (
    <button
      type="button"
      className={SETTINGS_ROW_CLASS}
      onClick={() => setRecording(true)}
      disabled={recording}
    >
      <span>{t.toggleShortcut}</span>
      <Kbd
        className={
          recording
            ? "h-6 border border-dashed border-border bg-transparent px-2 font-normal"
            : "h-6 bg-accent px-2 font-mono font-semibold text-accent-foreground"
        }
      >
        {recording ? t.pressNewShortcut : display}
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
  const { t } = useLanguage();

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
      <span>{t.diffWindowSize}</span>
      <Select value={value} onValueChange={(v) => void onChangeSize(v)}>
        <SelectTrigger size="sm" className="min-w-32 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" align="end">
          {/* 拖拽出来的非预设尺寸也要能显示 */}
          {isPreset ? null : (
            <SelectItem value={value}>
              {size.width} × {size.height}
              {t.customSize}
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
  const { t } = useLanguage();

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
      <span>{t.launchAtLogin}</span>
      <Switch checked={isEnabled} onCheckedChange={() => void onToggleAutostart()} />
    </label>
  );
}

function SettingsConfirmCommitRow() {
  const [isEnabled, setIsEnabled] = useState(isConfirmCommitEnabled);
  const { t } = useLanguage();

  function onToggleConfirmCommit() {
    localStorage.setItem(CONFIRM_COMMIT_KEY, isEnabled ? "0" : "1");
    setIsEnabled(!isEnabled);
  }

  return (
    <label className={`${SETTINGS_ROW_CLASS} cursor-pointer`}>
      <span>{t.confirmBeforeCommit}</span>
      <Switch checked={isEnabled} onCheckedChange={onToggleConfirmCommit} />
    </label>
  );
}

/** 设置里的版本行：显示当前版本，点「检查更新」查 GitHub Release；有新版本时变成「更新到 x.y.z」，点了下载安装并重启 */
function SettingsUpdateRow({
  skipInvoke,
  pendingUpdate,
  onFoundUpdate,
}: {
  skipInvoke?: boolean;
  pendingUpdate: Update | null;
  onFoundUpdate: (update: Update | null) => void;
}) {
  const [version, setVersion] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "latest" | "installing" | "checkError" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const { t } = useLanguage();

  useEffect(() => {
    if (skipInvoke || !isTauri) {
      return;
    }
    void getVersion()
      .then(setVersion)
      .catch((e) => console.error("读取版本号失败", e));
  }, [skipInvoke]);

  async function onCheckUpdate() {
    setStatus("checking");
    try {
      const update = await check();
      onFoundUpdate(update);
      setStatus(update ? "idle" : "latest");
    } catch (e) {
      console.error("检查更新失败", e);
      setStatus("checkError");
    }
  }

  async function onInstallUpdate() {
    if (!pendingUpdate) {
      return;
    }
    setStatus("installing");
    let total = 0;
    let downloaded = 0;
    try {
      await pendingUpdate.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setProgress(total ? Math.round((downloaded / total) * 100) : 0);
        }
      });
      await relaunch();
    } catch (e) {
      console.error("安装更新失败", e);
      setStatus("error");
    }
  }

  const statusText = {
    idle: "",
    checking: t.updateChecking,
    latest: t.updateLatest,
    installing: t.updateDownloading(progress),
    checkError: t.updateCheckError,
    error: t.updateInstallError,
  }[status];

  return (
    <div className={SETTINGS_ROW_CLASS}>
      <span>
        {t.version} <span className="font-mono">{version || "—"}</span>
        {statusText ? <span className="ml-2 text-xs text-muted-foreground">{statusText}</span> : null}
      </span>
      {pendingUpdate ? (
        <Button size="sm" disabled={status === "installing"} onClick={() => void onInstallUpdate()}>
          {status === "installing" ? <Loader2 className="animate-spin" /> : null}
          {t.updateTo(pendingUpdate.version)}
        </Button>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          disabled={status === "checking"}
          onClick={() => void onCheckUpdate()}
        >
          {t.checkUpdate}
        </Button>
      )}
    </div>
  );
}

const THEME_OPTIONS = [
  { value: ThemeModeEnum.Light, labelKey: "themeLight", icon: Sun },
  { value: ThemeModeEnum.Dark, labelKey: "themeDark", icon: Moon },
  { value: ThemeModeEnum.System, labelKey: "themeSystem", icon: Monitor },
] as const;

function SettingsThemeRow() {
  const { mode, onChangeThemeMode } = useThemeMode();
  const { t } = useLanguage();

  return (
    <div className={SETTINGS_ROW_CLASS}>
      <span>{t.appearance}</span>
      <ToggleGroup
        type="single"
        size="sm"
        variant="outline"
        spacing={0}
        value={mode}
        aria-label={t.appearance}
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
            aria-label={t[o.labelKey]}
            title={t[o.labelKey]}
          >
            <o.icon />
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

const LANGUAGE_OPTIONS = [
  { value: LanguageEnum.Zh, label: "中文" },
  { value: LanguageEnum.En, label: "English" },
];

/** 界面语言，同时决定生成提交信息用的语言 */
function SettingsLanguageRow() {
  const { language, t } = useLanguage();

  return (
    <div className={SETTINGS_ROW_CLASS}>
      <span>{t.language}</span>
      <ToggleGroup
        type="single"
        size="sm"
        variant="outline"
        spacing={0}
        value={language}
        aria-label={t.language}
        onValueChange={(v) => {
          if (v) {
            setLanguage(v as LanguageEnum);
          }
        }}
      >
        {LANGUAGE_OPTIONS.map((o) => (
          <ToggleGroupItem key={o.value} value={o.value} className="px-2.5 text-xs">
            {o.label}
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
  const { t } = useLanguage();
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
  const [isDiffHintSeen, setIsDiffHintSeen] = useState(
    () => localStorage.getItem(DIFF_HINT_SEEN_KEY) === "1",
  );
  const [isCommitHintSeen, setIsCommitHintSeen] = useState(
    () => localStorage.getItem(COMMIT_HINT_SEEN_KEY) === "1",
  );
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

  // 启动后静默检查一次更新：有新版本只提示，不自动安装（会重启，可能打断正在进行的提交）
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  useEffect(() => {
    if (captureBoot || !isTauri) {
      return;
    }
    void check()
      .then((update) => {
        if (update) {
          setPendingUpdate(update);
          setToast({
            title: getMessages().newVersion(update.version),
            message: getMessages().openSettingsToUpdate,
            kind: "info",
          });
        }
      })
      // 离线、还没发过 Release 时都会失败，不打扰用户
      .catch((e) => console.error("检查更新失败", e));
  }, []);

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
    if (isSuccess) {
      localStorage.setItem(COMMIT_HINT_SEEN_KEY, "1");
      setIsCommitHintSeen(true);
    }
    const t = getMessages();
    const message = isSuccess
      ? summarizeCommitMessage(result?.commitMessage ?? "")
      : (result?.error ?? t.commitFailed);
    setToast(
      isSuccess
        ? { title: t.pushed, message, kind: "ok" }
        : { title: t.failed, message, kind: "err" },
    );
    setRows((prev) =>
      prev.map((r) =>
        r.project.id === id
          ? {
              project: refreshed ?? r.project,
              uiState: isSuccess ? "success" : "failure",
              resultSummary: isSuccess ? `${t.pushed} · ${message}` : message,
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
        setToast({ title: t.alreadyAdded, message: t.alreadyAddedMessage, kind: "info" });
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
      await invoke<CommitPushResult>("run_commit_push", {
        id: row.project.id,
        language: readLanguage(),
      });
    } catch (e) {
      console.error("提交并推送失败", e);
    }
  }

  // 按展开时定下的顺序；之后新加的项目排在末尾
  const sortedRows = [...rows].sort(
    (a, b) =>
      (rowOrder.indexOf(a.project.id) + 1 || rowOrder.length + 1) -
      (rowOrder.indexOf(b.project.id) + 1 || rowOrder.length + 1),
  );
  function onDiffOpened() {
    if (!isDiffHintSeen) {
      localStorage.setItem(DIFF_HINT_SEEN_KEY, "1");
      setIsDiffHintSeen(true);
    }
    onCollapsePanel();
  }

  // 新手提示依次出现：先教「点击查看改动」，再提醒「一键会推送」，都学会后整行不显示
  const topHint =
    !isDiffHintSeen && rows.some((r) => !r.project.gitClean)
      ? t.diffHint
      : isCommitHintSeen
        ? null
        : t.commitHint;

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
            <span className="tag-pending is-failed" aria-label={t.tagFailed} />
          ) : isAnyDirty ? (
            <span className="tag-pending" aria-label={t.tagPending} />
          ) : null}
        </button>
        </>
      )}

      {panelOpen ? (
        <aside
          className={`panel${isPanelFromBottom ? " panel--up" : ""}${
            isPanelClosing ? " panel--closing" : ""
          }`}
          role="dialog" aria-label={t.panel}>
          <header className="chrome">
            <div className="title-wrap">
              {/* 从设置、环境检查等子页回到项目列表 */}
              <button
                type="button"
                className="home"
                aria-label={t.backToMain}
                title={t.backToMain}
                onClick={() => {
                  setSettingsOpen(false);
                  setIsCheckOpen(false);
                }}
              >
                <span className="brand">
                  <img src={logoUrl} alt="" />
                </span>
                <span className="title">ASURADA</span>
              </button>
              {isEnvFailed ? (
                <Button
                  size="icon-xs"
                  className="rounded-full bg-(--warn-bg) text-(--warn-fg) hover:bg-(--risk-ico)"
                  aria-label={t.envIssue}
                  title={t.envIssue}
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
                  aria-label={t.addProject}
                  title={t.addProject}
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
                  aria-label={t.settings}
                  title={t.settings}
                  aria-pressed={settingsOpen}
                  onClick={() => setSettingsOpen((o) => !o)}
                >
                  <Settings />
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t.collapse}
                title={t.collapse}
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
            {inMain && projectCount > 0 && !settingsOpen && topHint ? (
              <div
                role="status"
                className="mb-3 flex items-center gap-1.5 px-1 text-xs leading-snug text-(--risk-fg)"
              >
                <Info className="size-3.5 flex-none" aria-hidden />
                {topHint}
              </div>
            ) : null}

            {inIntro ? (
              <IntroView
                step={introStep}
                onSkip={finishIntro}
                onNext={() =>
                  setIntroStep((s) =>
                    s >= t.introSteps.length - 1 ? s : s + 1,
                  )
                }
                onStart={finishIntro}
              />
            ) : settingsOpen && inMain ? (
              <div>
                <div className="flex flex-col gap-0.5 rounded-xl border bg-card p-1.5">
                  <SettingsShortcutRow
                    active={settingsOpen}
                    initialDisplay={captureBoot?.toggleShortcutDisplay}
                    skipInvoke={captureBoot?.skipInvoke}
                    onToast={setToast}
                    onRecordingChange={handleShortcutRecordingChange}
                  />
                  <SettingsThemeRow />
                  <SettingsLanguageRow />
                  <SettingsDiffSizeRow
                    active={settingsOpen}
                    skipInvoke={captureBoot?.skipInvoke}
                  />
                  <SettingsConfirmCommitRow />
                  <SettingsAutostartRow skipInvoke={captureBoot?.skipInvoke} />
                  <SettingsUpdateRow
                    skipInvoke={captureBoot?.skipInvoke}
                    pendingUpdate={pendingUpdate}
                    onFoundUpdate={setPendingUpdate}
                  />
                  <button type="button" className={SETTINGS_ROW_CLASS} onClick={replayIntro}>
                    <span>{t.viewIntro}</span>
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                  </button>
                </div>
                <div className="mt-2.5 flex justify-end">
                  <Button variant="secondary" onClick={() => setSettingsOpen(false)}>
                    {t.back}
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
              <p className="p-6 text-center text-muted-foreground">{t.loading}</p>
            ) : projectCount === 0 ? (
              <div className="px-1 pt-8 pb-3 text-center">
                <LogoHero badge="+" />
                <h2 className={HEADING_CLASS}>{t.emptyTitle}</h2>
                <p className={`${LEAD_CLASS} text-center`}>
                  {t.emptyLead}
                </p>
                <Button disabled={!inMain} onClick={() => void handleAddProject()}>
                  {t.addProject}
                </Button>
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {sortedRows.map((row) => (
                  <ProjectRow
                    key={row.project.id}
                    row={row}
                    canCommit={inMain}
                    onCommit={() => void handleCommitPush(row)}
                    onRemove={() => void handleRemove(row.project.id)}
                    isFlashing={flashId === row.project.id}
                    onFlashEnd={() => setFlashId(null)}
                    onDiffOpened={onDiffOpened}
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
  const { t } = useLanguage();
  const content = t.introSteps[step];
  const isLast = step === t.introSteps.length - 1;

  return (
    <div className="px-1 pt-2 pb-3 text-center">
      <LogoHero />
      <h2 className={HEADING_CLASS}>{content.title}</h2>
      {content.sub ? (
        <p className="mb-2 text-xs font-medium text-muted-foreground">{content.sub}</p>
      ) : null}
      <p className={LEAD_CLASS}>{content.lead}</p>
      <div className="mb-3 flex justify-center gap-1.5" aria-hidden>
        {t.introSteps.map((_, i) => (
          <span
            key={i}
            className={`h-[7px] rounded-full ${i === step ? "w-4 bg-ring" : "w-[7px] bg-(--dot-off)"}`}
          />
        ))}
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" className="text-muted-foreground" onClick={onSkip}>
          {t.skip}
        </Button>
        <Button onClick={isLast ? onStart : onNext}>
          {isLast ? t.getStarted : t.next}
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
  const { t } = useLanguage();
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
      <h2 className={HEADING_CLASS}>{loading ? t.checkingEnv : t.envCheck}</h2>
      <p className={`${LEAD_CLASS} text-center`}>{t.envLead}</p>
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
  const { t } = useLanguage();
  return (
    <div className={GATE_CLASS}>
      <LogoHero badge="!" />
      <h2 className={HEADING_CLASS}>{t.envFailTitle}</h2>
      <p className={`${LEAD_CLASS} text-center`}>{t.envFailLead}</p>
      <div className={CHECKS_CLASS}>
        {result.checks.map((c) => (
          <PreflightCheckRow key={c.id} item={c} loading={false} />
        ))}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="ghost" className="text-muted-foreground" onClick={onBack}>
          {t.back}
        </Button>
        <Button onClick={onRecheck}>{t.recheck}</Button>
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
  const { t } = useLanguage();
  const meta = t.preflightChecks[item.id] ?? {
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
  const { t } = useLanguage();
  const pres = getRowPresentation(row, t);
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
      title={isDiffable ? t.viewChanges : undefined}
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
        {pres.btnBusy ? t.committing : t.commitPush}
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
          aria-label={t.openFolder}
          title={t.openFolder}
          onClick={onOpenFolder}
        >
          <FolderOpen />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className="opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 hover:bg-destructive/10 hover:text-destructive"
          aria-label={t.removeProject}
          title={t.removeProject}
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
          aria-label={confirmAction === "commit" ? t.confirmCommit : t.confirmRemove}
        >
          <span>
            {confirmAction === "commit"
              ? t.confirmCommitQuestion
              : t.confirmRemoveQuestion}
          </span>
          <Button variant="outline" size="sm" onClick={() => setConfirmAction(null)}>
            {t.cancel}
          </Button>
          {confirmAction === "commit" ? (
            <Button
              size="sm"
              onClick={() => {
                setConfirmAction(null);
                onCommit();
              }}
            >
              {t.commit}
            </Button>
          ) : (
            <Button
              size="sm"
              className="bg-destructive text-white hover:bg-destructive/85"
              onClick={onRemove}
            >
              {t.remove}
            </Button>
          )}
        </div>
      ) : null}
    </li>
  );
}

export default App;
