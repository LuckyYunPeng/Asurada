import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { CommitPushResult, ProjectRowState, ProjectView } from "./types";
import "./App.css";

function summarizeCommitMessage(msg: string): string {
  const line = msg.split("\n")[0]?.trim() ?? msg;
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}

function App() {
  const [panelOpen, setPanelOpen] = useState(true);
  const [rows, setRows] = useState<ProjectRowState[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const hasUnreadFailure = useMemo(
    () => rows.some((r) => r.uiState === "failure"),
    [rows],
  );

  const refreshList = useCallback(async () => {
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
    void refreshList();
  }, [refreshList]);

  async function handleAddProject() {
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
    if (row.project.gitClean || row.uiState === "running") return;

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
        setRows((prev) =>
          prev.map((r) =>
            r.project.id === row.project.id
              ? {
                  project: refreshed,
                  uiState: "success",
                  resultSummary: summary,
                  resultDetail: [result.commitMessage, result.pushOutput]
                    .filter(Boolean)
                    .join("\n\n"),
                  resultExpanded: false,
                }
              : r,
          ),
        );
      } else {
        setRows((prev) =>
          prev.map((r) =>
            r.project.id === row.project.id
              ? {
                  project: refreshed,
                  uiState: "failure",
                  resultSummary: result.error ?? "提交失败",
                  resultDetail: result.pushOutput || result.error || "",
                  // TODO(design): failure expand default — collapsed for now
                  resultExpanded: false,
                }
              : r,
          ),
        );
      }
    } catch (e) {
      setRows((prev) =>
        prev.map((r) =>
          r.project.id === row.project.id
            ? {
                ...r,
                uiState: "failure",
                resultSummary: String(e),
                resultDetail: String(e),
                resultExpanded: false,
              }
            : r,
        ),
      );
    }
  }

  function toggleResult(id: string) {
    setRows((prev) =>
      prev.map((r) =>
        r.project.id === id
          ? { ...r, resultExpanded: !r.resultExpanded }
          : r,
      ),
    );
  }

  const projectCount = rows.length;

  return (
    <div className="shell">
      <button
        type="button"
        className="edge-tag"
        aria-expanded={panelOpen}
        aria-label="CommitDock"
        onClick={() => setPanelOpen((o) => !o)}
      >
        <span className="edge-tag-label">CD</span>
        {hasUnreadFailure && !panelOpen ? (
          <span className="edge-tag-dot" aria-hidden />
        ) : null}
      </button>

      {panelOpen ? (
        <div className="panel" role="dialog" aria-label="CommitDock 面板">
          <header className="panel-header">
            <h1 className="panel-title">CommitDock</h1>
            <div className="panel-header-actions">
              <button type="button" className="btn-text" onClick={() => void handleAddProject()}>
                添加项目
              </button>
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

          {projectCount > 0 ? (
            <div className="risk-banner" role="status">
              一键将暂存、提交并推送到远端，不再确认
            </div>
          ) : null}

          <div className="panel-body">
            {loading ? (
              <p className="muted">加载中…</p>
            ) : projectCount === 0 ? (
              <div className="empty-state">
                <p className="empty-title">还没有项目</p>
                <p className="empty-desc">
                  添加本地 git 仓库后，可一键生成中文提交并推送
                </p>
                <button type="button" className="btn-primary" onClick={() => void handleAddProject()}>
                  添加项目
                </button>
              </div>
            ) : (
              <ul className="project-list">
                {rows.map((row) => (
                  <ProjectRow
                    key={row.project.id}
                    row={row}
                    onCommit={() => void handleCommitPush(row)}
                    onRemove={() => void handleRemove(row.project.id)}
                    onToggleResult={() => toggleResult(row.project.id)}
                  />
                ))}
              </ul>
            )}
          </div>

          {/* TODO(design): clean-workspace bulk action — disabled stub */}
          {projectCount > 0 ? (
            <footer className="panel-footer">
              <button type="button" className="btn-text btn-disabled" disabled title="待产品设计">
                清理干净工作区（占位）
              </button>
            </footer>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ProjectRow({
  row,
  onCommit,
  onRemove,
  onToggleResult,
}: {
  row: ProjectRowState;
  onCommit: () => void;
  onRemove: () => void;
  onToggleResult: () => void;
}) {
  const { project, uiState } = row;
  const isRunning = uiState === "running";
  const isClean = project.gitClean;
  const primaryDisabled = isClean || isRunning;

  const statusClass = isClean ? "status-clean" : "status-dirty";

  return (
    <li className="project-row">
      <div className="row-main">
        <div className="row-info">
          <div className="row-name">{project.displayName}</div>
          <div className="row-path" title={project.path}>
            {project.shortPath}
          </div>
          <div className={`row-status ${statusClass}`}>
            {project.gitStatusLabel}
            {isClean ? (
              <span className="no-change-hint" title="无变更">
                无变更
              </span>
            ) : null}
          </div>
        </div>
        <div className="row-actions">
          <button
            type="button"
            className="btn-primary btn-commit"
            disabled={primaryDisabled}
            title={isClean ? "无变更" : undefined}
            aria-disabled={primaryDisabled}
            onClick={onCommit}
          >
            {isRunning ? (
              <>
                <span className="spinner" aria-hidden />
                提交中…
              </>
            ) : (
              "提交并推送"
            )}
          </button>
          <button
            type="button"
            className="btn-icon"
            aria-label="移除项目"
            onClick={onRemove}
            disabled={isRunning}
          >
            ⋯
          </button>
        </div>
      </div>

      {row.resultSummary ? (
        <div
          className={`row-result row-result--${uiState === "success" ? "success" : "failure"}`}
        >
          <button type="button" className="row-result-toggle" onClick={onToggleResult}>
            {uiState === "success" ? (
              <span className="result-dot success" aria-hidden />
            ) : null}
            <span>{row.resultSummary}</span>
            <span className="chevron">{row.resultExpanded ? "▾" : "▸"}</span>
          </button>
          {row.resultExpanded && row.resultDetail ? (
            <pre className="row-result-detail">{row.resultDetail}</pre>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export default App;
