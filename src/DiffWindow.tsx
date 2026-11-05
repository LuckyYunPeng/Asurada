import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Menu } from "@tauri-apps/api/menu";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { ask } from "@tauri-apps/plugin-dialog";
import { isConfirmCommitEnabled } from "./commitConfirm";
import {
  isHighlighterLoaded,
  parsePatchFiles,
  preloadHighlighter,
  DEFAULT_VIRTUAL_FILE_METRICS,
  type FileDiffMetadata,
  type SupportedLanguages,
} from "@pierre/diffs";
import { FileDiff, Virtualizer, WorkerPoolContextProvider, useWorkerPool } from "@pierre/diffs/react";
import DiffsWorker from "@pierre/diffs/worker/worker-portable.js?worker";
import logoUrl from "./assets/asurada-logo.png";
import type { CommitPushResult, ICommitPushEvent } from "./types";
import {
  ChevronRight,
  CloudDownload,
  CloudUpload,
  Folder,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useThemeMode } from "./theme";
import { getMessages, readLanguage, useLanguage } from "./i18n";
import { showToast } from "./Toast";
import { Toaster } from "@/components/ui/sonner";
import "./App.css";
import "./DiffWindow.css";

interface IProjectDiff {
  displayName: string;
  path: string;
  patch: string;
  untracked: string[];
}

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
/* 色弱模式下改动词的蓝/橙高亮底较亮，灰色注释等语法色压在上面看不清，统一换成高对比文字色；--dw-emphasis-fg 只在色弱模式定义 */
[data-diff-span], [data-diff-span] span {
  color: var(--dw-emphasis-fg, inherit) !important;
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

const SHOW_TESTS_KEY = "asurada.diffShowTests";
const COLORBLIND_KEY = "asurada.diffColorblind";

// 测试目录（tests/、__tests__/、spec/、e2e/ 等）和常见测试文件命名（*.test.ts、*_test.go、test_*.py、FooTest.java）
const TEST_FILE_RE =
  /(^|\/)(__tests__|__mocks__|__snapshots__|tests?|specs?|e2e)\/|\.(test|spec)\.[^/]+$|(^|\/)test_[^/]+\.py$|_test\.(go|py|rs|exs?)$|(Tests?|Spec)\.(java|kt|swift|cs|scala)$/i;

function isTestFile(name: string) {
  return TEST_FILE_RE.test(name);
}
const SIDEBAR_WIDTH_KEY = "asurada.diffSidebarWidth";
const CODE_ZOOM_KEY = "asurada.diffCodeZoom";
// ⌘+ / ⌘- 只缩放代码字号，不用 WebView 整页缩放：整页缩放会让 diff 库的虚拟滚动反复重算，画面闪烁变形
// 百分比，相对库默认的 13px 字号 / 20px 行高
const CODE_ZOOMS = [80, 90, 100, 110, 125, 150];

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

/** 交给 git 的路径：重命名要带上旧路径，旧文件的删除才会一起提交 / 恢复 */
function toPaths(entries: IDiffEntry[]) {
  return entries.flatMap((e) => (e.file.prevName ? [e.file.name, e.file.prevName] : [e.file.name]));
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
    <div className="logo-idle" aria-label={getMessages().loading}>
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

interface IOpenWithApp {
  name: string;
  path: string;
  isDefault: boolean;
}

/** 勾选框；部分选中时显示横线（indeterminate 只能通过 DOM 属性设置） */
function CommitCheck({
  isChecked,
  isMixed = false,
  label,
  onToggle,
}: {
  isChecked: boolean;
  isMixed?: boolean;
  label: string;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = isMixed;
    }
  }, [isMixed]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="dw-check"
      aria-label={label}
      checked={isChecked}
      onChange={onToggle}
    />
  );
}

/** 文件 / 目录行的右键菜单，用系统原生菜单。relPath 是相对项目根的路径，删除的文件没有「打开」类操作 */
async function popupPathMenu(
  root: string,
  relPath: string,
  kind: "file" | "dir",
  isDeleted: boolean,
  onDiscard: (() => void) | null,
) {
  const absPath = `${root}/${relPath}`;
  const t = getMessages();
  const run = (label: string, action: () => Promise<unknown>) => () => {
    action().catch((e) => console.error(`${label}失败`, e));
  };
  try {
    const apps =
      kind === "file" && !isDeleted
        ? await invoke<IOpenWithApp[]>("list_open_with_apps", { path: absPath })
        : [];
    const openItems =
      kind === "file" && !isDeleted
        ? [
            { text: t.menuOpen, action: run("打开文件", () => openPath(absPath)) },
            {
              text: t.menuOpenWith,
              enabled: apps.length > 0,
              items: apps.map((app) => ({
                text: app.isDefault ? t.menuDefaultApp(app.name) : app.name,
                action: run("打开文件", () =>
                  invoke("open_with_app", { path: absPath, app: app.path }),
                ),
              })),
            },
            { item: "Separator" as const },
          ]
        : [];
    const menu = await Menu.new({
      items: [
        ...openItems,
        {
          text: t.menuReveal,
          enabled: !isDeleted,
          action: run("在访达中显示", () => revealItemInDir(absPath)),
        },
        { item: "Separator" },
        { text: t.menuCopyPath, action: run("复制路径", () => invoke("copy_text", { text: absPath })) },
        {
          text: t.menuCopyRelativePath,
          action: run("复制相对路径", () => invoke("copy_text", { text: relPath })),
        },
        {
          text: t.menuCopyName,
          action: run("复制名称", () =>
            invoke("copy_text", { text: relPath.slice(relPath.lastIndexOf("/") + 1) }),
          ),
        },
        { item: "Separator" },
        // 提交中不能丢弃
        { text: t.menuDiscard, enabled: onDiscard !== null, action: () => onDiscard?.() },
      ],
    });
    await menu.popup();
  } catch (e) {
    console.error("打开右键菜单失败", e);
  }
}

// 文件多时每次切换都会重渲染整个列表；只有选中态变化的两行需要更新
const FileItem = memo(function FileItem({
  entry,
  name,
  depth,
  isActive,
  isChecked,
  onToggleCheck,
  onSelect,
  onPrefetch,
  onContextMenu,
}: {
  entry: IDiffEntry;
  name: string;
  depth: number;
  isActive: boolean;
  isChecked: boolean;
  onToggleCheck: (names: string[]) => void;
  onSelect: (name: string) => void;
  onPrefetch: (entry: IDiffEntry) => void;
  onContextMenu: (relPath: string, kind: "file" | "dir", isDeleted: boolean) => void;
}) {
  return (
    <li className="dw-row">
      <CommitCheck
        isChecked={isChecked}
        label={getMessages().selectForCommit}
        onToggle={() => onToggleCheck([entry.file.name])}
      />
      <button
        type="button"
        className={isActive ? "is-active" : undefined}
        // 文件比同级目录多缩进一个箭头的宽度，和目录名对齐
        style={{ paddingLeft: 8 + depth * TREE_INDENT + 18 }}
        data-name={entry.file.name}
        title={entry.file.name}
        onClick={() => onSelect(entry.file.name)}
        onPointerEnter={() => onPrefetch(entry)}
        onContextMenu={(event) => {
          event.preventDefault();
          onContextMenu(entry.file.name, "file", entry.status === "D");
        }}
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
  checkedCount,
  names,
  onToggle,
  onToggleCheck,
  onContextMenu,
}: {
  path: string;
  name: string;
  depth: number;
  isCollapsed: boolean;
  checkedCount: number;
  /** 目录下全部文件，含隐藏的测试文件和被筛选掉的 */
  names: string[];
  onToggle: (path: string) => void;
  onToggleCheck: (names: string[]) => void;
  onContextMenu: (relPath: string, kind: "file" | "dir", isDeleted: boolean) => void;
}) {
  return (
    <li className="dw-row">
      <CommitCheck
        isChecked={checkedCount === names.length}
        isMixed={checkedCount > 0 && checkedCount < names.length}
        label={getMessages().selectForCommit}
        onToggle={() => onToggleCheck(names)}
      />
      <button
        type="button"
        className="dw-dir"
        style={{ paddingLeft: 8 + depth * TREE_INDENT }}
        title={path}
        aria-expanded={!isCollapsed}
        onClick={() => onToggle(path)}
        onContextMenu={(event) => {
          event.preventDefault();
          onContextMenu(path, "dir", false);
        }}
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
  const [isPulling, setIsPulling] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(
    () => Number(localStorage.getItem(SIDEBAR_WIDTH_KEY)) || 260,
  );
  const [filter, setFilter] = useState("");
  // 默认不看测试文件；只影响查看，提交时仍会一起提交
  // 色弱模式：增删从红/绿换成蓝/橙，红绿色弱也能分清
  const [isColorblind, setIsColorblind] = useState(
    () => localStorage.getItem(COLORBLIND_KEY) === "1",
  );
  const [isShowTests, setIsShowTests] = useState(
    () => localStorage.getItem(SHOW_TESTS_KEY) === "1",
  );
  const [codeZoom, setCodeZoom] = useState(() => {
    const saved = Number(localStorage.getItem(CODE_ZOOM_KEY));
    return CODE_ZOOMS.includes(saved) ? saved : 100;
  });
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(() => new Set());
  // 记取消勾选的文件而不是勾选的：AI 新改的文件默认勾上，刷新后用户取消的保持取消
  const [uncheckedNames, setUncheckedNames] = useState<Set<string>>(() => new Set());
  // 首次语法高亮完成前，库会画灰色骨架线；用 logo 动画盖住。窗口已预热时高亮器早就加载好了
  const [isRendered, setIsRendered] = useState(isHighlighterLoaded);
  const { t } = useLanguage();

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
      document.title = t.diffTitle(diff.displayName);
    }
  }, [diff, t]);

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

  function onToggleColorblind() {
    setIsColorblind(!isColorblind);
    localStorage.setItem(COLORBLIND_KEY, isColorblind ? "0" : "1");
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

  const projectRoot = diff?.path;
  // 传给 memo 的行组件，引用要稳定
  const onPathContextMenu = useCallback(
    (relPath: string, kind: "file" | "dir", isDeleted: boolean) => {
      if (!projectRoot) {
        return;
      }
      // 目录作用于下面所有文件，含隐藏的测试文件；重命名要连旧路径一起恢复
      const targets = entries.filter((e) =>
        kind === "file" ? e.file.name === relPath : e.file.name.startsWith(`${relPath}/`),
      );
      void popupPathMenu(
        projectRoot,
        relPath,
        kind,
        isDeleted,
        isCommitting ? null : () => void onDiscard(targets),
      );
    },
    // onDiscard 每次渲染都会重建，只依赖 t、projectId、fetchDiff
    [projectRoot, entries, isCommitting, t, projectId, fetchDiff],
  );

  async function onDiscard(targets: IDiffEntry[]) {
    try {
      if (
        !(await ask(t.confirmDiscardDetail, {
          title: t.confirmDiscardTitle(targets.length),
          kind: "warning",
          okLabel: t.discard,
          cancelLabel: t.cancel,
        }))
      ) {
        return;
      }
      await invoke("discard_changes", { id: projectId, paths: toPaths(targets) });
      showToast("ok", t.discarded);
    } catch (e) {
      console.error("丢弃改动失败", e);
      showToast("err", t.discardFailed, String(e));
    }
    void fetchDiff();
  }

  const onToggleCheck = useCallback((names: string[]) => {
    setUncheckedNames((prev) => {
      const next = new Set(prev);
      // 全部勾着就全取消，否则全勾上
      if (names.every((n) => !prev.has(n))) {
        names.forEach((n) => next.add(n));
      } else {
        names.forEach((n) => next.delete(n));
      }
      return next;
    });
  }, []);

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
        return;
      }
      if (payload.result?.success) {
        setUncheckedNames(new Set());
        showToast("ok", getMessages().pushed, payload.result.commitMessage ?? undefined);
      } else {
        showToast("err", getMessages().commitFailed, payload.result?.error ?? undefined);
      }
      void fetchDiff();
    }).then((stop) => {
      unlisten = stop;
    });
    return () => unlisten?.();
  }, [projectId, fetchDiff]);

  async function onCommit() {
    try {
      // diff 窗口是普通窗口，用系统确认框；附在本窗口上，不会抢走主面板
      if (
        isConfirmCommitEnabled() &&
        !(await ask(isPartial ? t.confirmCommitSelectedDetail(checkedEntries.length) : t.confirmCommitDetail, {
          title: t.confirmCommitTitle,
          kind: "warning",
          okLabel: t.commit,
          cancelLabel: t.cancel,
        }))
      ) {
        return;
      }
      await invoke<CommitPushResult>("run_commit_push", {
        id: projectId,
        language: readLanguage(),
        // 全选时走原来的「提交全部」，期间新出现的改动也会带上
        paths: isPartial ? toPaths(checkedEntries) : null,
      });
    } catch (e) {
      console.error("提交并推送失败", e);
      showToast("err", t.commitFailed, String(e));
    }
  }

  async function onPull() {
    setIsPulling(true);
    try {
      const output = await invoke<string>("run_pull", { id: projectId });
      showToast("ok", t.pulled, output || undefined);
      void fetchDiff();
    } catch (e) {
      console.error("拉取失败", e);
      showToast("err", t.pullFailed, String(e));
    }
    setIsPulling(false);
  }

  const checkedEntries = useMemo(
    () => entries.filter((e) => !uncheckedNames.has(e.file.name)),
    [entries, uncheckedNames],
  );
  const isPartial = checkedEntries.length < entries.length;
  const hiddenCheckedCount = isShowTests
    ? 0
    : checkedEntries.filter((e) => isTestFile(e.file.name)).length;
  const commitLabel = isCommitting
    ? t.committing
    : isPartial
      ? t.commitSelected(checkedEntries.length, hiddenCheckedCount)
      : t.commitPush;

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

  const dirNames = (path: string) =>
    entries.filter((e) => e.file.name.startsWith(`${path}/`)).map((e) => e.file.name);

  const totalAdditions = countedEntries.reduce((n, e) => n + e.additions, 0);
  const totalDeletions = countedEntries.reduce((n, e) => n + e.deletions, 0);

  // 虚拟滚动按 metrics.lineHeight 估算位置，必须和 CSS 行高一致
  const codeLineHeight = Math.round((20 * codeZoom) / 100);

  function onChangeCodeZoom(next: number) {
    setCodeZoom(next);
    localStorage.setItem(CODE_ZOOM_KEY, String(next));
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey) {
        return;
      }
      const index = CODE_ZOOMS.indexOf(codeZoom);
      if (event.key === "=" || event.key === "+") {
        onChangeCodeZoom(CODE_ZOOMS[Math.min(index + 1, CODE_ZOOMS.length - 1)]);
      } else if (event.key === "-") {
        onChangeCodeZoom(CODE_ZOOMS[Math.max(index - 1, 0)]);
      } else if (event.key === "0") {
        onChangeCodeZoom(100);
      } else {
        return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [codeZoom]);

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
    <div
      className={isColorblind ? "dw is-colorblind" : "dw"}
      style={
        {
          "--diffs-font-size": `${Math.round((13 * codeZoom) / 100)}px`,
          "--diffs-line-height": `${codeLineHeight}px`,
          "--dw-zoom": codeZoom / 100,
        } as React.CSSProperties
      }
    >
      <header className="dw-top" data-tauri-drag-region>
        <div className="dw-title" data-tauri-drag-region>
          <div className="dw-brand" data-tauri-drag-region>
            <span className="brand">
              <img src={logoUrl} alt="" />
            </span>
            <span className="title">ASURADA</span>
          </div>
          <span className="dw-divider" aria-hidden />
          <strong>{diff?.displayName ?? t.loading}</strong>
          {entries.length ? (
            <>
              <span className="dw-sub">{t.fileCount(countedEntries.length)}</span>
              <DiffCount additions={totalAdditions} deletions={totalDeletions} />
            </>
          ) : null}
        </div>
        <div className="dw-actions">
          <Tooltip>
            <TooltipTrigger asChild>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground select-none">
                <Switch checked={isColorblind} onCheckedChange={onToggleColorblind} />
                <span>{t.colorblind}</span>
              </label>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t.colorblindTip}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground select-none">
                {/* 存储仍沿用 asurada.diffShowTests，旧的选择不丢；开关表示「正在隐藏」 */}
                <Switch checked={!isShowTests} onCheckedChange={onToggleShowTests} />
                <span>
                  {t.hideTests}
                  {!isShowTests && testCount ? (
                    <Badge variant="secondary" className="ml-1.5 h-4 px-1.5 text-[11px] font-normal">
                      {t.hiddenCount(testCount)}
                    </Badge>
                  ) : null}
                </span>
              </label>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {t.hideTestsTip}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t.refresh}
                disabled={isLoading}
                onClick={() => void fetchDiff()}
              >
                <RefreshCw className={isLoading ? "animate-spin" : undefined} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t.refresh}</TooltipContent>
          </Tooltip>
          <Tooltip>
            {/* 禁用的按钮不响应鼠标，包一层 span 才能显示 tooltip */}
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label={isPulling ? t.pulling : t.pull}
                  disabled={isPulling || isCommitting}
                  onClick={() => void onPull()}
                >
                  {isPulling ? <Loader2 className="animate-spin" /> : <CloudDownload />}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {isPulling ? t.pulling : t.pull}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label={commitLabel}
                  disabled={isCommitting || isPulling || !checkedEntries.length}
                  onClick={() => void onCommit()}
                >
                  {isCommitting ? <Loader2 className="animate-spin" /> : <CloudUpload />}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">{commitLabel}</TooltipContent>
          </Tooltip>
        </div>
      </header>

      <Toaster />

      {error ? (
        <div className="dw-state">
          <p>{t.loadDiffFailed}</p>
          <pre>{error}</pre>
          <Button size="sm" onClick={() => void fetchDiff()}>
            {t.retry}
          </Button>
        </div>
      ) : !diff ? (
        <div className="dw-state">
          <LogoLoading />
        </div>
      ) : !entries.length ? (
        <div className="dw-state">
          <img src={logoUrl} alt="" />
          <p>{t.workingTreeClean}</p>
        </div>
      ) : (
        <div className="dw-main">
          <aside className="dw-side" style={{ width: sidebarWidth }}>
            <input
              className="dw-filter"
              placeholder={t.filterFiles}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <p className="dw-selected">
              {t.selectedCount(checkedEntries.length, entries.length)}
              <button
                type="button"
                onClick={() =>
                  setUncheckedNames(
                    isPartial ? new Set() : new Set(entries.map((e) => e.file.name)),
                  )
                }
              >
                {isPartial ? t.selectAll : t.deselectAll}
              </button>
            </p>
            <ul className="dw-files">
              {treeRows.map((row) =>
                row.kind === "dir" ? (
                  <DirItem
                    key={`d:${row.path}`}
                    path={row.path}
                    name={row.name}
                    depth={row.depth}
                    isCollapsed={collapsedDirs.has(row.path)}
                    names={dirNames(row.path)}
                    checkedCount={dirNames(row.path).filter((n) => !uncheckedNames.has(n)).length}
                    onToggle={onToggleDir}
                    onToggleCheck={onToggleCheck}
                    onContextMenu={onPathContextMenu}
                  />
                ) : (
                  <FileItem
                    key={row.entry.file.name}
                    entry={row.entry}
                    name={row.name}
                    depth={row.depth}
                    isActive={row.entry === selected}
                    isChecked={!uncheckedNames.has(row.entry.file.name)}
                    onToggleCheck={onToggleCheck}
                    onSelect={setSelectedName}
                    onPrefetch={onPrefetch}
                    onContextMenu={onPathContextMenu}
                  />
                ),
              )}
            </ul>
            <div className="dw-resizer" onPointerDown={onResizeStart} />
          </aside>

          <div className="dw-diff">
            {/* 浮在代码区底部正中，不占布局高度；两侧快捷键也能点 */}
            <div className="dw-zoom">
              <button
                type="button"
                aria-label={t.zoomOut}
                disabled={codeZoom === CODE_ZOOMS[0]}
                onClick={() => onChangeCodeZoom(CODE_ZOOMS[CODE_ZOOMS.indexOf(codeZoom) - 1])}
              >
                <kbd>⌘−</kbd>
              </button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="dw-zoom-value"
                    aria-label={t.codeZoomTip}
                    onClick={() => onChangeCodeZoom(100)}
                  >
                    {codeZoom}%
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">{t.codeZoomTip}</TooltipContent>
              </Tooltip>
              <button
                type="button"
                aria-label={t.zoomIn}
                disabled={codeZoom === CODE_ZOOMS[CODE_ZOOMS.length - 1]}
                onClick={() => onChangeCodeZoom(CODE_ZOOMS[CODE_ZOOMS.indexOf(codeZoom) + 1])}
              >
                <kbd>⌘+</kbd>
              </button>
            </div>
            {isRendered ? null : (
              <div className="dw-loading">
                <LogoLoading />
              </div>
            )}
            {selected ? (
            /* key 随文件变化，切换文件时滚动位置回到顶部 */
            <Virtualizer
              // 字号变了要重建：库只在创建时读取 metrics
              key={`${selected.file.name}:${codeZoom}`}
              className="dw-scroll"
              contentClassName="dw-content"
            >
              <section className="dw-file">
                <FileDiff
                  fileDiff={selected.file}
                  metrics={{ ...DEFAULT_VIRTUAL_FILE_METRICS, lineHeight: codeLineHeight }}
                  options={{
                    theme: DIFF_THEME,
                    themeType: isDark ? "dark" : "light",
                    diffStyle: "split",
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
                      {t.openInEditor}
                    </button>
                  )}
                />
                {selected.file.hunks.length === 0 && selected.status !== "R" ? (
                  <p className="dw-binary">{t.binaryFile}</p>
                ) : null}
              </section>
            </Virtualizer>
            ) : (
              <div className="dw-state">
                <p>{filter.trim() ? t.noMatchingFiles : t.onlyTestsChanged}</p>
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
    // diff 窗口本身不透明，html/body 透明（App.css）时露出 WKWebView 默认的白底。
    // 关窗时内容会清空，下次显示的头一帧就只有这层白底，暗色下看起来像闪白；给根节点铺上主题底色
    document.documentElement.style.background = "var(--surface-2)";
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
