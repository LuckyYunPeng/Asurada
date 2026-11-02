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

function Mascot() {
  return (
    <div className="mascot" aria-hidden>
      <span className="blush-l" />
      <span className="blush-r" />
      <span className="mouth" />
    </div>
  );
}

const captureScene = getCaptureScene();
const captureBoot = captureScene ? bootstrapCapture(captureScene) : null;
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function App() {
  const [panelOpen, setPanelOpen] = useState(
    () => captureBoot?.panelOpen ?? false,
  );
  const [introComplete, setIntroComplete] = useState(
    () => captureBoot?.introComplete ?? readIntroComplete(),
  );
  const [introStep, setIntroStep] = useState(() => {
    if (captureBoot) return captureBoot.introStep;
    return readIntroComplete() ? -1 : 0;
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const panelOpenRef = useRef(panelOpen);
  panelOpenRef.current = panelOpen;

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
    void invoke("sync_dock_geometry", { expanded: panelOpen }).catch(() => {});
  }, [panelOpen]);

  useEffect(() => {
    if (captureBoot) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && panelOpenRef.current) {
        setPanelOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (captureBoot || !isTauri) return;

    let unlistenBlur: (() => void) | undefined;
    let unlistenDock: (() => void) | undefined;

    void (async () => {
      const win = getCurrentWindow();
      unlistenBlur = await win.listen("tauri://blur", () => {
        if (panelOpenRef.current) {
          setPanelOpen(false);
        }
      });
      unlistenDock = await listen("dock-blur", () => {
        if (panelOpenRef.current) {
          setPanelOpen(false);
        }
      });
    })();

    return () => {
      unlistenBlur?.();
      unlistenDock?.();
    };
  }, []);

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
    setSettingsOpen(false);
    setIntroStep(0);
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
  const showHeaderAdd = inMain;

  return (
    <div className={`desktop${panelOpen ? " desktop--expanded" : " desktop--tag"}`}>
      <span className="deco deco-a" aria-hidden>
        ✿
      </span>
      <span className="deco deco-b" aria-hidden>
        ✧
      </span>
      <span className="deco deco-c" aria-hidden>
        ♡
      </span>

      <button
        type="button"
        className="tag"
        aria-expanded={panelOpen}
        aria-label="Asurada"
        title="Asurada"
        onClick={() => setPanelOpen((o) => !o)}
      >
        {hasUnreadFailure && !panelOpen ? (
          <span className="tag-dot" aria-hidden />
        ) : null}
        <img className="tag-logo" src={logoUrl} alt="" />
        <span className="tag-mark">AS</span>
      </button>

      {panelOpen ? (
        <aside className="panel" role="dialog" aria-label="Asurada 面板">
          <header className="chrome">
            <div className="title-wrap">
              <div className="badge">
                <img src={logoUrl} alt="" />
              </div>
              <h1 className="title">Asurada</h1>
            </div>
            <div className="chrome-actions">
              {showHeaderAdd ? (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => void handleAddProject()}
                >
                  添加项目
                </button>
              ) : null}
              {inMain ? (
                <div className="settings-menu">
                  <button
                    type="button"
                    className="btn-text"
                    aria-expanded={settingsOpen}
                    onClick={() => setSettingsOpen((o) => !o)}
                  >
                    设置
                  </button>
                  {settingsOpen ? (
                    <div className="settings-pop">
                      <button type="button" onClick={replayIntro}>
                        重看引导
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <button
                type="button"
                className="btn-text"
                onClick={() => setPanelOpen(false)}
              >
                收起
              </button>
            </div>
          </header>

          {loadError ? <p className="banner-error">{loadError}</p> : null}

          {inMain && projectCount > 0 ? (
            <div className="env-pill">
              <span className="dot" aria-hidden />
              本机环境就绪
            </div>
          ) : null}

          {inMain && projectCount > 0 ? (
            <div className="risk" role="status">
              <span className="ico">!</span>
              <span>一键会暂存、提交并推送到远端哦，不会再确认～</span>
            </div>
          ) : null}

          <div className="panel-body">
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
                <Mascot />
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
      <Mascot />
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
      {loading ? <div className="spin" aria-hidden /> : null}
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
      <Mascot />
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
