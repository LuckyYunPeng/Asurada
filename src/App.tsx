import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { bootstrapCapture, getCaptureScene } from "./captureMode";
import logoUrl from "./assets/asurada-logo.png";
import {
  INTRO_STEPS,
  INTRO_STORAGE_KEY,
  PREFLIGHT_CHECK_META,
  VIEW_INTRO_LABEL,
} from "./introContent";
import { getRowPresentation } from "./rowPresentation";
import { Toast, type ToastKind } from "./Toast";
import type {
  CommitPushResult,
  PreflightItem,
  PreflightResult,
  ProjectRowState,
  ProjectView,
} from "./types";
import {
  persistThemePreference,
  readThemePreference,
  syncThemeFromPreference,
  type ThemePreference,
} from "./theme";
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
  const [inSettings, setInSettings] = useState(
    () => captureBoot?.inSettings ?? false,
  );
  const [themePreference, setThemePreference] = useState<ThemePreference>(
    () => readThemePreference(),
  );
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
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(
    () => captureBoot?.toast ?? null,
  );
  const [isPanelClosing, setIsPanelClosing] = useState(false);
  const panelOpenRef = useRef(panelOpen);
  panelOpenRef.current = panelOpen;
  const inSettingsRef = useRef(inSettings);
  inSettingsRef.current = inSettings;

  // 先播放收起动画，结束后再缩窗
  const onCollapsePanel = useCallback(() => {
    if (!panelOpenRef.current) {
      return;
    }
    setIsPanelClosing(true);
    window.setTimeout(() => {
      setPanelOpen(false);
      setIsPanelClosing(false);
      setInSettings(false);
    }, 220);
  }, []);

  const envReady = preflight?.ready === true;
  const inIntro = introStep >= 0;
  const inMain = introComplete && !inIntro && envReady && !preflightLoading;

  const hasUnreadFailure = useMemo(
    () => rows.some((r) => r.uiState === "failure"),
    [rows],
  );

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

  const runPreflight = useCallback(async () => {
    if (captureBoot?.skipInvoke) return;
    setPreflightLoading(true);
    try {
      const result = await invoke<PreflightResult>("preflight");
      setPreflight(result);
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
    if (panelOpen && introComplete && !inIntro) {
      void runPreflight();
    }
  }, [panelOpen, introComplete, inIntro, runPreflight]);

  useEffect(() => {
    if (captureBoot || !isTauri) return;

    let unlistenPanel: (() => void) | undefined;

    void (async () => {
      unlistenPanel = await listen<boolean>("set-panel-open", (event) => {
        if (event.payload) {
          setPanelOpen(true);
        } else {
          onCollapsePanel();
        }
      });
    })();

    return () => {
      unlistenPanel?.();
    };
  }, [onCollapsePanel]);

  useEffect(() => {
    if (captureBoot || !isTauri) return;
    void invoke("sync_dock_geometry", { expanded: panelOpen }).catch(() => {});
  }, [panelOpen]);

  useEffect(() => {
    syncThemeFromPreference(themePreference);
  }, [themePreference]);

  useEffect(() => {
    if (themePreference !== "system") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      syncThemeFromPreference("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [themePreference]);

  function setTheme(next: ThemePreference) {
    setThemePreference(next);
    persistThemePreference(next);
  }

  useEffect(() => {
    if (captureBoot) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (inSettingsRef.current) {
          setInSettings(false);
          return;
        }
        onCollapsePanel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCollapsePanel]);

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
    void runPreflight();
    void refreshList();
  }

  function replayIntro() {
    setInSettings(false);
    setIntroStep(0);
  }

  function openSettings() {
    setInSettings(true);
  }

  function closeSettings() {
    setInSettings(false);
  }

  async function handleAddProject() {
    if (!inMain) return;
    const selected = await open({
      directory: true,
      multiple: false,
      title: "选择本地 git 仓库",
    });
    if (selected == null || Array.isArray(selected)) return;
    try {
      const added = await invoke<ProjectView>("add_project", { path: selected });
      setRows((prev) => [...prev, { project: added, uiState: "idle" }]);
    } catch (e) {
      setLoadError(String(e));
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

  async function handleCommitPush(row: ProjectRowState) {
    if (!inMain || row.project.gitClean || row.uiState === "running") {
      return;
    }

    setRows((prev) =>
      prev.map((r) =>
        r.project.id === row.project.id ? { ...r, uiState: "running" } : r,
      ),
    );

    try {
      const result = await invoke<CommitPushResult>("run_commit_push", {
        id: row.project.id,
      });
      const refreshed = await invoke<ProjectView>("refresh_project_status", {
        id: row.project.id,
      });

      if (result.success && result.commitMessage) {
        const summary = `已推送 · ${summarizeCommitMessage(result.commitMessage)}`;
        setToast({ message: summary, kind: "ok" });
        setRows((prev) =>
          prev.map((r) =>
            r.project.id === row.project.id
              ? {
                  project: refreshed,
                  uiState: "success",
                  resultSummary: summary,
                }
              : r,
          ),
        );
      } else {
        const errMsg = result.error ?? "提交失败";
        setToast({ message: errMsg, kind: "err" });
        setRows((prev) =>
          prev.map((r) =>
            r.project.id === row.project.id
              ? {
                  project: refreshed,
                  uiState: "failure",
                  resultSummary: errMsg,
                }
              : r,
          ),
        );
      }
    } catch (e) {
      const errMsg = String(e);
      setToast({ message: errMsg, kind: "err" });
      setRows((prev) =>
        prev.map((r) =>
          r.project.id === row.project.id
            ? {
                ...r,
                uiState: "failure",
                resultSummary: errMsg,
              }
            : r,
        ),
      );
    }
  }

  const projectCount = rows.length;
  const showHeaderAdd = inMain && !inSettings;
  const showMainChrome = inMain && !inSettings;
  const panelLabel = inSettings ? "设置" : "Asurada 面板";

  return (
    <div className={`desktop${panelOpen ? " desktop--expanded" : " desktop--tag"}`}>
      {panelOpen ? null : (
        <button
          type="button"
          className="tag"
          aria-expanded={false}
          aria-label="Asurada"
          title="Asurada"
          onClick={() => setPanelOpen(true)}
        >
          {hasUnreadFailure ? <span className="tag-dot" aria-hidden /> : null}
          <img className="tag-logo" src={logoUrl} alt="" />
          <span className="tag-chevron" aria-hidden>
            ‹
          </span>
        </button>
      )}

      {panelOpen ? (
        <aside
          className={`panel${isPanelClosing ? " panel--closing" : ""}`}
          role="dialog"
          aria-label={panelLabel}
        >
          <header className="chrome">
            <div className="title-wrap">
              <div className="badge">
                <img src={logoUrl} alt="" />
              </div>
              {inSettings ? (
                <div className="title-cluster">
                  <button
                    type="button"
                    className="btn-icon btn-chrome-back"
                    aria-label="返回"
                    title="返回"
                    onClick={closeSettings}
                  >
                    <Icon d="m15 18-6-6 6-6" />
                  </button>
                  <h1 className="title-plain">设置</h1>
                </div>
              ) : (
                <h1 className="title">Asurada</h1>
              )}
            </div>
            <div className="chrome-actions">
              {showHeaderAdd ? (
                <button
                  type="button"
                  className="btn-text btn-chrome"
                  onClick={() => void handleAddProject()}
                >
                  添加项目
                </button>
              ) : null}
              {showMainChrome ? (
                <button
                  type="button"
                  className="btn-icon"
                  aria-label="设置"
                  title="设置"
                  onClick={openSettings}
                >
                  <Icon d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
                </button>
              ) : null}
              <button
                type="button"
                className="btn-text btn-chrome-muted"
                onClick={onCollapsePanel}
              >
                收起
              </button>
            </div>
          </header>

          {loadError ? <p className="banner-error">{loadError}</p> : null}

          {showMainChrome && projectCount > 0 ? (
            <div className="env-pill">
              <span className="dot" aria-hidden />
              本机环境就绪
            </div>
          ) : null}

          {showMainChrome && projectCount > 0 ? (
            <div className="risk" role="status">
              <span className="ico">!</span>
              <span>一键会暂存、提交并推送到远端哦，不会再确认～</span>
            </div>
          ) : null}

          <div className="panel-body">
            {inMain && inSettings ? (
              <SettingsView
                themePreference={themePreference}
                onThemeChange={setTheme}
                onViewIntro={replayIntro}
              />
            ) : inIntro ? (
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
            ) : preflightLoading ? (
              <PreflightGateView loading checks={preflight?.checks} />
            ) : preflight && !preflight.ready ? (
              <PreflightFailView
                result={preflight}
                onRecheck={() => void runPreflight()}
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
                {rows.map((row) => (
                  <ProjectRow
                    key={row.project.id}
                    row={row}
                    canCommit={inMain}
                    onCommit={() => void handleCommitPush(row)}
                    onRemove={() => void handleRemove(row.project.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        </aside>
      ) : null}

      {toast ? (
        <Toast
          message={toast.message}
          kind={toast.kind}
          onDismiss={() => setToast(null)}
        />
      ) : null}
    </div>
  );
}

const THEME_OPTIONS = [
  ["light", "浅色"],
  ["dark", "深色"],
  ["system", "系统"],
] as const;

function SettingsView({
  themePreference,
  onThemeChange,
  onViewIntro,
}: {
  themePreference: ThemePreference;
  onThemeChange: (next: ThemePreference) => void;
  onViewIntro: () => void;
}) {
  return (
    <div className="settings-page">
      <div className="settings-theme">
        <div className="settings-row">
          <span className="settings-label">主题</span>
          <div className="theme-segment" role="radiogroup" aria-label="主题">
            {THEME_OPTIONS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={themePreference === value}
                className={themePreference === value ? "on" : undefined}
                onClick={() => onThemeChange(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <p className="settings-hint">跟随系统时按 macOS 外观自动切换</p>
      </div>
      <button
        type="button"
        className="settings-row settings-row-action"
        onClick={onViewIntro}
      >
        <span className="settings-label">{VIEW_INTRO_LABEL}</span>
        <span className="settings-chevron" aria-hidden>
          ›
        </span>
      </button>
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
}: {
  result: PreflightResult;
  onRecheck: () => void;
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

function ProjectRow({
  row,
  canCommit,
  onCommit,
  onRemove,
}: {
  row: ProjectRowState;
  canCommit: boolean;
  onCommit: () => void;
  onRemove: () => void;
}) {
  const pres = getRowPresentation(row);
  const primaryDisabled =
    pres.btnDisabled || !canCommit || row.uiState === "running";

  return (
    <li className="row">
      <div className="meta">
        <div className="name">{row.project.displayName}</div>
        <div className="path" title={row.project.path}>
          {row.project.shortPath}
        </div>
        <div className={`status ${pres.kind}`}>
          <span className="pip" aria-hidden />
          <span>{pres.statusText}</span>
        </div>
      </div>
      <div className="actions">
        <button
          type="button"
          className="menu"
          aria-label="移除项目"
          disabled={row.uiState === "running"}
          onClick={onRemove}
        >
          ⋯
        </button>
        <button
          type="button"
          className={`btn-primary${pres.btnBusy ? " busy" : ""}`}
          disabled={primaryDisabled}
          title={pres.btnTitle}
          onClick={onCommit}
        >
          {pres.btnBusy ? "提交中…" : "提交并推送"}
        </button>
      </div>
    </li>
  );
}

export default App;
