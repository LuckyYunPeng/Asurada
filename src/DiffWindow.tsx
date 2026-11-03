import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openPath } from "@tauri-apps/plugin-opener";
import { isHighlighterLoaded, parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import { FileDiff, Virtualizer } from "@pierre/diffs/react";
import logoUrl from "./assets/asurada-logo.png";
import type { CommitPushResult, ICommitPushEvent } from "./types";
import { RefreshCw, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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

// 注入 diff 库 shadow DOM 的样式（外部 CSS 进不去）。库默认的增删底色只混入 12%、
// 行内改动词只有 15% 高亮，再加上鲜艳的语法色，改动很难一眼看出
const DIFF_UNSAFE_CSS = `
:host {
  /* 整行底色：88% -> 80% 背景，红绿更明显 */
  --diffs-bg-addition-override: #dbf6e3;
  --diffs-bg-deletion-override: #fde2e4;
  /* 行内改动词：加深到能一眼看出改了哪几个字 */
  --diffs-bg-addition-emphasis-override: rgba(13, 190, 78, 0.32);
  --diffs-bg-deletion-emphasis-override: rgba(255, 46, 63, 0.28);
}
[data-line], [data-no-newline] {
  --mix-light: 0%;
}
/* 改动行行号栏比代码区稍深，滚动时余光能扫到 */
[data-column-number] {
  --mix-light: 0%;
}
[data-line-type="change-addition"][data-column-number] {
  --diffs-bg-addition-number-override: #c4efd2;
}
[data-line-type="change-deletion"][data-column-number] {
  --diffs-bg-deletion-number-override: #fbcdd2;
}
/* 语法色降饱和，让红绿成为最显眼的颜色 */
[data-code] [data-line] span:not([data-diff-span]) {
  filter: saturate(0.55);
}
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
const SHOW_TESTS_KEY = "asurada.diffShowTests";

// 测试目录（tests/、__tests__/、spec/、e2e/ 等）和常见测试文件命名（*.test.ts、*_test.go、test_*.py、FooTest.java）
const TEST_FILE_RE =
  /(^|\/)(__tests__|__mocks__|__snapshots__|tests?|specs?|e2e)\/|\.(test|spec)\.[^/]+$|(^|\/)test_[^/]+\.py$|_test\.(go|py|rs|exs?)$|(Tests?|Spec)\.(java|kt|swift|cs|scala)$/i;

function isTestFile(name: string) {
  return TEST_FILE_RE.test(name);
}
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
  // 默认不看测试文件；只影响查看，提交时仍会一起提交
  const [isShowTests, setIsShowTests] = useState(
    () => localStorage.getItem(SHOW_TESTS_KEY) === "1",
  );
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


  function onToggleShowTests() {
    setIsShowTests(!isShowTests);
    localStorage.setItem(SHOW_TESTS_KEY, isShowTests ? "0" : "1");
  }

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

  // 提交状态以后端为准：主面板发起的提交也会在这里显示"提交中…"
  useEffect(() => {
    void invoke<string[]>("get_committing_ids")
      .then((ids) => setIsCommitting(ids.includes(projectId)))
      .catch((e) => console.error("读取提交状态失败", e));
    let unlisten: (() => void) | undefined;
    void listen<ICommitPushEvent>("commit-push", ({ payload }) => {
      if (payload.id !== projectId) {
        return;
      }
      setIsCommitting(payload.phase === "running");
      if (payload.phase === "running") {
        setNotice(null);
        return;
      }
      setNotice(
        payload.result?.success
          ? { kind: "ok", text: `已推送 · ${payload.result.commitMessage ?? ""}` }
          : { kind: "err", text: payload.result?.error ?? "提交失败" },
      );
      void fetchDiff();
    }).then((stop) => {
      unlisten = stop;
    });
    return () => unlisten?.();
  }, [projectId, fetchDiff]);

  async function onCommit() {
    try {
      await invoke<CommitPushResult>("run_commit_push", { id: projectId });
    } catch (e) {
      console.error("提交并推送失败", e);
      setNotice({ kind: "err", text: String(e) });
    }
  }

  const testCount = entries.filter((e) => isTestFile(e.file.name)).length;
  // 头部统计跟随开关：隐藏的测试文件不计入
  const countedEntries = isShowTests ? entries : entries.filter((e) => !isTestFile(e.file.name));
  const visibleEntries = entries.filter(
    (e) =>
      (isShowTests || !isTestFile(e.file.name)) &&
      e.file.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  // 只渲染选中的一个文件；选中的被筛掉或刷新后已不在变更里时回到第一个
  const selected =
    visibleEntries.find((e) => e.file.name === selectedName) ?? visibleEntries[0];
  const totalAdditions = countedEntries.reduce((n, e) => n + e.additions, 0);
  const totalDeletions = countedEntries.reduce((n, e) => n + e.deletions, 0);

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
              <span className="dw-sub">{countedEntries.length} 个文件</span>
              <DiffCount additions={totalAdditions} deletions={totalDeletions} />
            </>
          ) : null}
        </div>
        <div className="dw-actions">
          <Tooltip>
            <TooltipTrigger asChild>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground select-none">
                <Switch checked={isShowTests} onCheckedChange={onToggleShowTests} />
                <span>
                  显示测试文件
                  {!isShowTests && testCount ? (
                    <Badge variant="secondary" className="ml-1.5 h-4 px-1.5 text-[11px] font-normal">
                      已隐藏 {testCount}
                    </Badge>
                  ) : null}
                </span>
              </label>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              只影响查看，隐藏的测试文件提交时仍会一起提交
            </TooltipContent>
          </Tooltip>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            spacing={0}
            value={diffStyle}
            aria-label="对比方式"
            onValueChange={(v) => {
              if (v) {
                onChangeDiffStyle(v as TDiffStyle);
              }
            }}
          >
            <ToggleGroupItem value="unified" className="px-3 text-xs">
              上下
            </ToggleGroupItem>
            <ToggleGroupItem value="split" className="px-3 text-xs">
              左右
            </ToggleGroupItem>
          </ToggleGroup>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="刷新"
                disabled={isLoading}
                onClick={() => void fetchDiff()}
              >
                <RefreshCw className={isLoading ? "animate-spin" : undefined} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">刷新</TooltipContent>
          </Tooltip>
          <Button
            size="sm"
            className="px-4"
            disabled={isCommitting || !entries.length}
            onClick={() => void onCommit()}
          >
            {isCommitting ? <Loader2 className="animate-spin" /> : null}
            {isCommitting ? "提交中…" : "提交并推送"}
          </Button>
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
          <Button size="sm" onClick={() => void fetchDiff()}>
            重试
          </Button>
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
            {selected ? (
            /* key 随文件变化，切换文件时滚动位置回到顶部 */
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
                    overflow: "scroll",
                    // 行首用 +/- 号，不靠颜色也能分清增删
                    diffIndicators: "classic",
                    // 按整词标出行内改动，比默认 word-alt 更整齐
                    lineDiffType: "word",
                    unsafeCSS: DIFF_UNSAFE_CSS,
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
            ) : (
              <div className="dw-state">
                <p>{filter.trim() ? "没有匹配的文件" : "只有测试文件有变更，打开右上角开关查看"}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
