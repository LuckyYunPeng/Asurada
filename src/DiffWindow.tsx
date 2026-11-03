import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { isHighlighterLoaded, parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import { FileDiff, Virtualizer } from "@pierre/diffs/react";
import logoUrl from "./assets/asurada-logo.png";
import type { CommitPushResult } from "./types";
import "./App.css";
import "./DiffWindow.css";

interface IProjectDiff {
  displayName: string;
  path: string;
  patch: string;
  untracked: string[];
}

type TDiffStyle = "unified" | "split";

interface IDiffEntry {
  file: FileDiffMetadata;
  status: "M" | "A" | "D" | "R" | "U";
  additions: number;
  deletions: number;
}

const DIFF_SCROLLBAR_CSS = `
[data-code]::-webkit-scrollbar-thumb {
  background-color: rgba(94, 200, 212, 0.35);
  border: 2px solid transparent;
  background-clip: padding-box;
  border-radius: 999px;
}
[data-code]::-webkit-scrollbar-thumb:hover {
  background-color: rgba(94, 200, 212, 0.65);
}
`;

const DIFF_STYLE_KEY = "asurada.diffStyle";
const SIDEBAR_WIDTH_KEY = "asurada.diffSidebarWidth";

function toEntries(diff: IProjectDiff): IDiffEntry[] {
  const untracked = new Set(diff.untracked);
  return parsePatchFiles(diff.patch)
    .flatMap((p) => p.files)
    .map((file) => ({
      file,
      status:
        file.type === "new"
          ? untracked.has(file.name)
            ? "U"
            : "A"
          : file.type === "deleted"
            ? "D"
            : file.type.startsWith("rename")
              ? "R"
              : "M",
      additions: file.hunks.reduce((n, h) => n + h.additionLines, 0),
      deletions: file.hunks.reduce((n, h) => n + h.deletionLines, 0),
    }));
}

function splitPath(name: string) {
  const i = name.lastIndexOf("/");
  return { base: name.slice(i + 1), dir: i < 0 ? "" : name.slice(0, i) };
}

/** 与主面板 LogoHero 同款：虚线光环慢转 + logo 悬浮（样式在 App.css） */
function LogoLoading() {
  return (
    <div className="logo-idle" aria-label="加载中">
      <span className="logo-idle-ring" />
      <img src={logoUrl} alt="" />
    </div>
  );
}

function DiffCount({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="dw-count">
      {additions ? <span className="is-add">+{additions}</span> : null}
      {deletions ? <span className="is-del">−{deletions}</span> : null}
    </span>
  );
}

export default function DiffWindow({ projectId }: { projectId: string }) {
  const [diff, setDiff] = useState<IProjectDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCommitting, setIsCommitting] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [diffStyle, setDiffStyle] = useState<TDiffStyle>(
    () => (localStorage.getItem(DIFF_STYLE_KEY) as TDiffStyle | null) ?? "unified",
  );
  const [sidebarWidth, setSidebarWidth] = useState(
    () => Number(localStorage.getItem(SIDEBAR_WIDTH_KEY)) || 260,
  );
  const [filter, setFilter] = useState("");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  // 首次语法高亮完成前，库会画灰色骨架线；用 logo 动画盖住
  const [isRendered, setIsRendered] = useState(false);

  const fetchDiff = useCallback(async () => {
    setIsLoading(true);
    try {
      setDiff(await invoke<IProjectDiff>("get_project_diff", { id: projectId }));
      setError(null);
    } catch (e) {
      console.error("读取 diff 失败", e);
      setError(String(e));
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void fetchDiff();
    // 从编辑器切回来时拿最新改动
    const onFocus = () => void fetchDiff();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchDiff]);

  // WKWebView 根节点默认有弹性回弹，整窗（含顶栏）会被拖下来再弹回；只在 diff 窗口关掉
  useEffect(() => {
    document.documentElement.style.overscrollBehavior = "none";
    document.body.style.overscrollBehavior = "none";
  }, []);

  useEffect(() => {
    if (diff) {
      document.title = `${diff.displayName} 的变更`;
    }
  }, [diff]);

  const entries = useMemo(() => (diff ? toEntries(diff) : []), [diff]);

  // Shiki 加载完前库只画灰色骨架线，且没有完成回调；轮询加载状态，期间用 logo 动画盖住
  useEffect(() => {
    if (isRendered) {
      return;
    }
    const timer = window.setInterval(() => {
      if (isHighlighterLoaded()) {
        setIsRendered(true);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [isRendered]);


  function onChangeDiffStyle(style: TDiffStyle) {
    setDiffStyle(style);
    localStorage.setItem(DIFF_STYLE_KEY, style);
  }

  function onResizeStart(event: React.PointerEvent) {
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    let width = startWidth;
    const onMove = (e: PointerEvent) => {
      width = Math.min(480, Math.max(180, startWidth + e.clientX - startX));
      setSidebarWidth(width);
    };
    const onUp = () => {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  async function onOpenInEditor(name: string) {
    if (!diff) {
      return;
    }
    try {
      await openPath(`${diff.path}/${name}`);
    } catch (e) {
      console.error("打开文件失败", e);
    }
  }

  async function onCommit() {
    setIsCommitting(true);
    setNotice(null);
    try {
      const result = await invoke<CommitPushResult>("run_commit_push", { id: projectId });
      setNotice(
        result.success
          ? { kind: "ok", text: `已推送 · ${result.commitMessage ?? ""}` }
          : { kind: "err", text: result.error ?? "提交失败" },
      );
    } catch (e) {
      console.error("提交并推送失败", e);
      setNotice({ kind: "err", text: String(e) });
    } finally {
      setIsCommitting(false);
      void fetchDiff();
    }
  }

  const visibleEntries = entries.filter((e) =>
    e.file.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  // 只渲染选中的一个文件；刷新后原文件已不在变更里时回到第一个
  const selected = entries.find((e) => e.file.name === selectedName) ?? entries[0];
  const totalAdditions = entries.reduce((n, e) => n + e.additions, 0);
  const totalDeletions = entries.reduce((n, e) => n + e.deletions, 0);

  // ↑/↓ 在当前筛选结果里切换文件；筛选框里输入时也可用
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.key !== "ArrowUp" && event.key !== "ArrowDown") ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        !visibleEntries.length
      ) {
        return;
      }
      event.preventDefault();
      const index = visibleEntries.findIndex((e) => e === selected);
      const next =
        visibleEntries[
          event.key === "ArrowDown"
            ? Math.min(index + 1, visibleEntries.length - 1)
            : Math.max(index - 1, 0)
        ];
      setSelectedName(next.file.name);
      document
        .querySelector(`.dw-files [data-name="${CSS.escape(next.file.name)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visibleEntries, selected]);

  return (
    <div className="dw">
      <header className="dw-top" data-tauri-drag-region>
        <div className="dw-title" data-tauri-drag-region>
          <div className="dw-brand" data-tauri-drag-region>
            <span className="brand">
              <img src={logoUrl} alt="" />
            </span>
            <span className="title">ASURADA</span>
          </div>
          <span className="dw-divider" aria-hidden />
          <strong>{diff?.displayName ?? "加载中…"}</strong>
          {entries.length ? (
            <>
              <span className="dw-sub">{entries.length} 个文件</span>
              <DiffCount additions={totalAdditions} deletions={totalDeletions} />
            </>
          ) : null}
        </div>
        <div className="dw-actions">
          <div className="dw-seg" role="group" aria-label="对比方式">
            {(["unified", "split"] as const).map((style) => (
              <button
                key={style}
                type="button"
                className={diffStyle === style ? "is-on" : undefined}
                onClick={() => onChangeDiffStyle(style)}
              >
                {style === "unified" ? "上下" : "左右"}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="dw-icon-btn"
            aria-label="刷新"
            title="刷新"
            disabled={isLoading}
            onClick={() => void fetchDiff()}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8M21 3v5h-5" />
            </svg>
          </button>
          <button
            type="button"
            className={`btn-primary${isCommitting ? " busy" : ""}`}
            disabled={isCommitting || !entries.length}
            onClick={() => void onCommit()}
          >
            {isCommitting ? "提交中…" : "提交并推送"}
          </button>
        </div>
      </header>

      {notice ? (
        <div className={`dw-notice is-${notice.kind}`} role="status">
          <span>{notice.text}</span>
          <button type="button" aria-label="关闭" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="dw-state">
          <p>读取变更失败</p>
          <pre>{error}</pre>
          <button type="button" className="btn-primary" onClick={() => void fetchDiff()}>
            重试
          </button>
        </div>
      ) : !diff ? (
        <div className="dw-state">
          <LogoLoading />
        </div>
      ) : !entries.length ? (
        <div className="dw-state">
          <img src={logoUrl} alt="" />
          <p>工作区很干净，没有要提交的变更</p>
        </div>
      ) : (
        <div className="dw-main">
          <aside className="dw-side" style={{ width: sidebarWidth }}>
            <input
              className="dw-filter"
              placeholder="筛选文件…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <ul className="dw-files">
              {visibleEntries.map((entry) => {
                const { base, dir } = splitPath(entry.file.name);
                return (
                  <li key={entry.file.name}>
                    <button
                      type="button"
                      className={entry === selected ? "is-active" : undefined}
                      data-name={entry.file.name}
                      title={entry.file.name}
                      onClick={() => setSelectedName(entry.file.name)}
                    >
                      <span className={`dw-status is-${entry.status}`}>{entry.status}</span>
                      <span className="dw-file-text">
                        <span className="dw-file-base">{base}</span>
                        {dir ? <span className="dw-file-dir">{dir}</span> : null}
                      </span>
                      <DiffCount additions={entry.additions} deletions={entry.deletions} />
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="dw-resizer" onPointerDown={onResizeStart} />
          </aside>

          <div className="dw-diff">
            {isRendered ? null : (
              <div className="dw-loading">
                <LogoLoading />
              </div>
            )}
            {/* key 随文件变化，切换文件时滚动位置回到顶部 */}
            <Virtualizer
              key={selected.file.name}
              className="dw-scroll"
              contentClassName="dw-content"
            >
              <section className="dw-file">
                <FileDiff
                  fileDiff={selected.file}
                  options={{
                    theme: "pierre-light",
                    themeType: "light",
                    diffStyle,
                    stickyHeader: true,
                    overflow: "scroll",
                    // 代码区横向滚动条在 shadow DOM 里，外部 CSS 进不去，只能经库的 unsafeCSS 注入
                    unsafeCSS: DIFF_SCROLLBAR_CSS,
                  }}
                  renderHeaderMetadata={() => (
                    <button
                      type="button"
                      className="dw-open"
                      onClick={() => void onOpenInEditor(selected.file.name)}
                    >
                      在编辑器打开
                    </button>
                  )}
                />
                {selected.file.hunks.length === 0 && selected.status !== "R" ? (
                  <p className="dw-binary">二进制文件或无文本变化</p>
                ) : null}
              </section>
            </Virtualizer>
          </div>
        </div>
      )}
    </div>
  );
}
