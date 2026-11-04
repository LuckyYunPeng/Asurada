import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  isHighlighterLoaded,
  parsePatchFiles,
  preloadHighlighter,
  type FileDiffMetadata,
  type SupportedLanguages,
} from "@pierre/diffs";
import { FileDiff, Virtualizer, WorkerPoolContextProvider, useWorkerPool } from "@pierre/diffs/react";
import DiffsWorker from "@pierre/diffs/worker/worker-portable.js?worker";
import logoUrl from "./assets/asurada-logo.png";
import type { CommitPushResult, ICommitPushEvent } from "./types";
import { ChevronRight, Folder, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useThemeMode } from "./theme";
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
/* 颜色变量定义在 DiffWindow.css 的 .dw 上（随亮/暗切换），自定义属性会继承进 shadow DOM */
:host {
  --diffs-bg-addition-override: var(--dw-add-bg);
  --diffs-bg-deletion-override: var(--dw-del-bg);
  --diffs-bg-addition-emphasis-override: var(--dw-add-emphasis);
  --diffs-bg-deletion-emphasis-override: var(--dw-del-emphasis);
}
/* 深色时代码底色跟面板同色系，不用主题自带的纯黑；增删、行号等底色都由它混色得出 */
/* 主题把底色写在 pre 的内联样式里，只能 !important 盖；底色值在 DiffWindow.css 的 .dw 上 */
:host {
  --diffs-bg: var(--dw-code-bg) !important;
}
[data-line], [data-no-newline] {
  --mix-light: 0%;
  --mix-dark: 0%;
}
/* 改动行行号栏比代码区稍深，滚动时余光能扫到 */
[data-column-number] {
  --mix-light: 0%;
  --mix-dark: 0%;
}
[data-line-type="change-addition"][data-column-number] {
  --diffs-bg-addition-number-override: var(--dw-add-number);
}
[data-line-type="change-deletion"][data-column-number] {
  --diffs-bg-deletion-number-override: var(--dw-del-number);
}
/* 语法色降饱和，让红绿成为最显眼的颜色 */
[data-code] [data-line] span:not([data-diff-span]) {
  filter: saturate(0.55);
}
[data-code]::-webkit-scrollbar-thumb {
  background-color: rgba(128, 128, 140, 0.3);
  border: 2px solid transparent;
  background-clip: padding-box;
  border-radius: 999px;
}
[data-code]::-webkit-scrollbar-thumb:hover {
  background-color: rgba(128, 128, 140, 0.5);
}
`;

// 语法高亮放到 worker 里跑：大文件在主线程高亮一次要几百毫秒，切换文件会卡住界面。
// 这里的 theme / lineDiffType 必须和下面 FileDiff 的 options 一致
const DIFF_THEME = { light: "pierre-light", dark: "pierre-dark" } as const;
const LINE_DIFF_TYPE = "word";
// 后台预高亮的文件数上限（也决定高亮缓存大小）；文件再多时靠悬停预高亮兜底
const PREFETCH_LIMIT = 150;
// 后台只占 2 个 worker，留出其余的给用户点击的文件，点击不会排在预高亮后面
const PREFETCH_CONCURRENCY = 2;
const WORKER_POOL_OPTIONS = {
  workerFactory: () => new DiffsWorker(),
  poolSize: Math.min(4, navigator.hardwareConcurrency || 2),
  // 小文件主线程直接高亮更快，省掉先画纯文本再上色的闪烁
  mainThreadMaxCharacters: 4000,
  totalASTLRUCacheSize: PREFETCH_LIMIT + 50,
};
const HIGHLIGHTER_OPTIONS = { theme: DIFF_THEME, lineDiffType: LINE_DIFF_TYPE } as const;

const DIFF_STYLE_KEY = "asurada.diffStyle";
const SHOW_TESTS_KEY = "asurada.diffShowTests";

// 测试目录（tests/、__tests__/、spec/、e2e/ 等）和常见测试文件命名（*.test.ts、*_test.go、test_*.py、FooTest.java）
const TEST_FILE_RE =
  /(^|\/)(__tests__|__mocks__|__snapshots__|tests?|specs?|e2e)\/|\.(test|spec)\.[^/]+$|(^|\/)test_[^/]+\.py$|_test\.(go|py|rs|exs?)$|(Tests?|Spec)\.(java|kt|swift|cs|scala)$/i;

function isTestFile(name: string) {
  return TEST_FILE_RE.test(name);
}
const SIDEBAR_WIDTH_KEY = "asurada.diffSidebarWidth";

// 预热时先加载的语法，其余语言打开文件时按需加载
const PRELOAD_LANGS: SupportedLanguages[] = ["typescript", "tsx", "javascript", "json", "css", "rust"];

/** 53 位字符串哈希（cyrb53），给 patch 生成稳定的缓存前缀 */
function hashText(text: string) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function isSameDiff(a: IProjectDiff, b: IProjectDiff) {
  return (
    a.patch === b.patch &&
    a.path === b.path &&
    a.displayName === b.displayName &&
    a.untracked.join("\0") === b.untracked.join("\0")
  );
}

function toEntries(diff: IProjectDiff): IDiffEntry[] {
  const untracked = new Set(diff.untracked);
  // 带 cacheKey 才能预高亮并命中 worker 池的高亮缓存。前缀取 patch 的哈希：内容不变（重新聚焦、
  // 关掉再打开同一项目）就命中上次的高亮结果，内容变了自然换新 key，不会用到旧结果
  return parsePatchFiles(diff.patch, `p${hashText(diff.patch)}`)
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

interface ITreeDir {
  dirs: Map<string, ITreeDir>;
  files: IDiffEntry[];
}

type TTreeRow =
  | { kind: "dir"; path: string; name: string; depth: number }
  | { kind: "file"; entry: IDiffEntry; name: string; depth: number };

/** 按路径拼成目录树，再按「目录在前、同级按名称」展开成行；折叠的目录不展开子项 */
function toTreeRows(entries: IDiffEntry[], collapsedDirs: Set<string>): TTreeRow[] {
  const root: ITreeDir = { dirs: new Map(), files: [] };
  for (const entry of entries) {
    const parts = entry.file.name.split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.dirs.has(part)) {
        node.dirs.set(part, { dirs: new Map(), files: [] });
      }
      node = node.dirs.get(part)!;
    }
    node.files.push(entry);
  }
  const rows: TTreeRow[] = [];
  const walk = (node: ITreeDir, prefix: string, depth: number) => {
    for (const [name, child] of [...node.dirs].sort(([a], [b]) => a.localeCompare(b))) {
      const path = prefix + name;
      rows.push({ kind: "dir", path, name, depth });
      if (!collapsedDirs.has(path)) {
        walk(child, `${path}/`, depth + 1);
      }
    }
    for (const entry of [...node.files].sort((a, b) => a.file.name.localeCompare(b.file.name))) {
      rows.push({ kind: "file", entry, name: entry.file.name.slice(prefix.length), depth });
    }
  };
  walk(root, "", 0);
  return rows;
}

// 每级缩进
const TREE_INDENT = 14;

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

// 文件多时每次切换都会重渲染整个列表；只有选中态变化的两行需要更新
const FileItem = memo(function FileItem({
  entry,
  name,
  depth,
  isActive,
  onSelect,
  onPrefetch,
}: {
  entry: IDiffEntry;
  name: string;
  depth: number;
  isActive: boolean;
  onSelect: (name: string) => void;
  onPrefetch: (entry: IDiffEntry) => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={isActive ? "is-active" : undefined}
        // 文件比同级目录多缩进一个箭头的宽度，和目录名对齐
        style={{ paddingLeft: 8 + depth * TREE_INDENT + 18 }}
        data-name={entry.file.name}
        title={entry.file.name}
        onClick={() => onSelect(entry.file.name)}
        onPointerEnter={() => onPrefetch(entry)}
      >
        <span className={`dw-status is-${entry.status}`}>{entry.status}</span>
        {/* 开头省略：保留结尾的文件名和扩展名。外层 rtl 让省略号落在左边，bdi 保证文字本身仍按从左到右排 */}
        <span className="dw-file-base is-head-ellipsis">
          <bdi>{name}</bdi>
        </span>
        <DiffCount additions={entry.additions} deletions={entry.deletions} />
      </button>
    </li>
  );
});

function DirItem({
  path,
  name,
  depth,
  isCollapsed,
  onToggle,
}: {
  path: string;
  name: string;
  depth: number;
  isCollapsed: boolean;
  onToggle: (path: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        className="dw-dir"
        style={{ paddingLeft: 8 + depth * TREE_INDENT }}
        title={path}
        aria-expanded={!isCollapsed}
        onClick={() => onToggle(path)}
      >
        <ChevronRight className={`dw-dir-chevron${isCollapsed ? "" : " is-open"}`} aria-hidden />
        <Folder className="dw-dir-icon" aria-hidden />
        <span className="dw-file-base">{name}</span>
      </button>
    </li>
  );
}

function DiffView({ projectId }: { projectId: string }) {
  const workerPool = useWorkerPool();
  const { isDark } = useThemeMode();
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
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(() => new Set());
  // 首次语法高亮完成前，库会画灰色骨架线；用 logo 动画盖住。窗口已预热时高亮器早就加载好了
  const [isRendered, setIsRendered] = useState(isHighlighterLoaded);

  const fetchDiff = useCallback(async () => {
    setIsLoading(true);
    try {
      const next = await invoke<IProjectDiff>("get_project_diff", { id: projectId });
      // 内容没变就保留原对象：文件列表、选中项、已渲染的 diff 都不动
      setDiff((prev) => (prev && isSameDiff(prev, next) ? prev : next));
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

  function onResizeStart(event: React.PointerEvent<HTMLDivElement>) {
    // 不阻止默认行为会开始选中文字；捕获指针后拖过 diff 区或窗口外也不会丢事件
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    let width = startWidth;
    document.body.classList.add("is-resizing");
    const onMove = (e: PointerEvent) => {
      // 右侧 diff 至少留 360px
      width = Math.min(window.innerWidth - 360, Math.max(180, startWidth + e.clientX - startX));
      setSidebarWidth(width);
    };
    const onUp = () => {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
      document.body.classList.remove("is-resizing");
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
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

  const testCount = useMemo(
    () => entries.filter((e) => isTestFile(e.file.name)).length,
    [entries],
  );
  // 头部统计跟随开关：隐藏的测试文件不计入
  const countedEntries = useMemo(
    () => (isShowTests ? entries : entries.filter((e) => !isTestFile(e.file.name))),
    [entries, isShowTests],
  );
  const visibleEntries = useMemo(
    () =>
      countedEntries.filter((e) =>
        e.file.name.toLowerCase().includes(filter.trim().toLowerCase()),
      ),
    [countedEntries, filter],
  );
  const treeRows = useMemo(
    () => toTreeRows(visibleEntries, collapsedDirs),
    [visibleEntries, collapsedDirs],
  );
  // 键盘切换按目录树里看得到的文件顺序走，折叠目录里的跳过
  const treeFiles = useMemo(
    () => treeRows.flatMap((row) => (row.kind === "file" ? [row.entry] : [])),
    [treeRows],
  );
  // 只渲染选中的一个文件；选中的被筛掉或刷新后已不在变更里时回到树里第一个
  const selected =
    visibleEntries.find((e) => e.file.name === selectedName) ?? treeFiles[0] ?? visibleEntries[0];

  const onToggleDir = useCallback((path: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);
  // 悬停时就在 worker 里预先高亮，点下去直接命中缓存；失败了点击时会正常再高亮一次，不影响查看
  const onPrefetch = useCallback(
    (entry: IDiffEntry) => {
      workerPool?.primeDiffHighlightCache(entry.file).catch((e) => console.error("预高亮失败", e));
    },
    [workerPool],
  );

  // 打开后在后台按列表顺序把文件都预高亮好，之后点哪个都直接命中缓存
  useEffect(() => {
    if (!workerPool) {
      return;
    }
    let isCancelled = false;
    const queue = visibleEntries.slice(0, PREFETCH_LIMIT);
    const runPrefetch = async () => {
      while (!isCancelled && queue.length) {
        try {
          await workerPool.primeDiffHighlightCache(queue.shift()!.file);
        } catch (e) {
          console.error("预高亮失败", e);
        }
      }
    };
    for (let i = 0; i < PREFETCH_CONCURRENCY; i++) {
      void runPrefetch();
    }
    return () => {
      isCancelled = true;
    };
  }, [visibleEntries, workerPool]);

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
        !treeFiles.length
      ) {
        return;
      }
      event.preventDefault();
      const index = treeFiles.findIndex((e) => e === selected);
      const next =
        treeFiles[
          event.key === "ArrowDown"
            ? Math.min(index + 1, treeFiles.length - 1)
            : Math.max(index - 1, 0)
        ];
      setSelectedName(next.file.name);
      document
        .querySelector(`.dw-files [data-name="${CSS.escape(next.file.name)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [treeFiles, selected]);

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
              {treeRows.map((row) =>
                row.kind === "dir" ? (
                  <DirItem
                    key={`d:${row.path}`}
                    path={row.path}
                    name={row.name}
                    depth={row.depth}
                    isCollapsed={collapsedDirs.has(row.path)}
                    onToggle={onToggleDir}
                  />
                ) : (
                  <FileItem
                    key={row.entry.file.name}
                    entry={row.entry}
                    name={row.name}
                    depth={row.depth}
                    isActive={row.entry === selected}
                    onSelect={setSelectedName}
                    onPrefetch={onPrefetch}
                  />
                ),
              )}
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
                    theme: DIFF_THEME,
                    themeType: isDark ? "dark" : "light",
                    diffStyle,
                    overflow: "scroll",
                    // 行首用 +/- 号，不靠颜色也能分清增删
                    diffIndicators: "classic",
                    // 按整词标出行内改动，比默认 word-alt 更整齐
                    lineDiffType: LINE_DIFF_TYPE,
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

/**
 * 窗口常驻：启动时隐藏创建，worker 池和高亮器提前加载好；后端发 diff-open 切换项目，
 * 关闭时只是隐藏并发 diff-hidden，清掉内容，下次打开不会先闪一下上一个项目。
 * worker 池要包在外层，DiffView 里才能用 useWorkerPool 预高亮
 */
export default function DiffWindow() {
  const [projectId, setProjectId] = useState<string | null>(null);

  useEffect(() => {
    void preloadHighlighter({
      themes: [DIFF_THEME.light, DIFF_THEME.dark],
      langs: PRELOAD_LANGS,
    }).catch((e) => console.error("预加载高亮器失败", e));
    // 后端先记下项目再发事件；窗口还在加载时事件会丢，从这里补拿
    void invoke<string | null>("get_diff_project_id")
      .then((id) => setProjectId((current) => current ?? id))
      .catch((e) => console.error("读取 diff 项目失败", e));
    const pendingOpen = listen<string>("diff-open", ({ payload }) => setProjectId(payload));
    const pendingHidden = listen("diff-hidden", () => setProjectId(null));
    return () => {
      void pendingOpen.then((stop) => stop());
      void pendingHidden.then((stop) => stop());
    };
  }, []);

  return (
    <WorkerPoolContextProvider
      poolOptions={WORKER_POOL_OPTIONS}
      highlighterOptions={HIGHLIGHTER_OPTIONS}
    >
      {/* key 随项目变化：切项目时筛选、选中、折叠等状态都重置 */}
      {projectId ? <DiffView key={projectId} projectId={projectId} /> : null}
    </WorkerPoolContextProvider>
  );
}
