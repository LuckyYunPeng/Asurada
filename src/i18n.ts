import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

export enum LanguageEnum {
  Zh = "zh",
  En = "en",
}

const LANGUAGE_KEY = "asurada.language";
const LANGUAGE_EVENT = "language-changed";
const isTauri = "__TAURI_INTERNALS__" in window;

const zh = {
  // 设置
  shortcutUnavailable: "快捷键不可用",
  toggleShortcut: "自定义快捷键",
  pressNewShortcut: "按下新组合…",
  diffWindowSize: "Diff 窗口大小",
  customSize: "（自定义）",
  launchAtLogin: "开机自动启动",
  confirmBeforeCommit: "提交前确认",
  prewarmCommitMessage: "后台预生成提交信息",
  prewarmCommitMessageTip:
    "项目有改动，并且在一个检查间隔内没再变时，提前在后台生成提交信息，点提交时直接使用，不用等 AI Agent。没有改动时不会生成。会额外调用 Agent，消耗一些额度。",
  prewarmInterval: "检查间隔",
  seconds: (count: number) => `${count} 秒`,
  appearance: "外观",
  themeLight: "亮色",
  themeDark: "深色",
  themeSystem: "跟随系统",
  language: "语言",
  projectSort: "项目排序",
  settingsGeneral: "通用",
  settingsCommit: "提交",
  settingsAbout: "关于",
  projectCount: (count: number) => `${count} 个项目`,
  sortUpdated: "最近更新",
  sortDirty: "待提交优先",
  sortName: "名称",
  sortAdded: "添加顺序",
  searchProjects: "搜索项目…",
  clearSearch: "清除搜索",
  noMatchingProjects: "没有匹配的项目",
  version: "版本",
  checkUpdate: "检查更新",
  updateTo: (version: string) => `更新到 ${version}`,
  updateChecking: "检查中…",
  updateLatest: "已是最新",
  updateDownloading: (progress: number) => (progress ? `下载中 ${progress}%` : "下载中…"),
  updateCheckError: "检查失败，稍后再试",
  updateInstallError: "更新失败，稍后再试",
  newVersion: (version: string) => `有新版本 ${version}`,
  openSettingsToUpdate: "打开设置即可更新",
  viewIntro: "查看引导",
  back: "返回",
  agent: "Agent",
  agentTip: "用哪个本机 AI Agent 写提交信息",
  agentNone: "未检测到",
  testAgent: "测试",
  agentOk: (name: string) => `${name} 可以正常使用`,
  agentFailed: "Agent 不可用",
  agentSwitch: "换一个 Agent：",
  agentPickTitle: "选择 Agent",
  agentPickLead: "Asurada 用它生成提交信息，之后可以在设置里更换。",
  agentNoneTitle: "还没有 AI Agent",
  agentNoneLead: "Asurada 用它生成提交信息。在终端运行下面任意一条命令安装，装好后点「重新检测」。",
  copyCommand: "复制安装命令",
  copied: "已复制",
  copyLog: "复制日志",
  agentRescan: "重新检测",
  continue: "继续",
  // 主面板
  panel: "ASURADA 面板",
  backToMain: "回到主面板",
  tagFailed: "有项目提交失败",
  tagPending: "有项目待提交",
  envIssue: "环境异常，查看检查",
  addProject: "添加项目",
  addSingleProject: "添加单个项目",
  scanFolder: "扫描文件夹…",
  pickRepoTitle: "选择本地 git 仓库",
  pickScanRootTitle: "选择要扫描的文件夹",
  scanning: "正在扫描…",
  scanTitle: (count: number) => `找到 ${count} 个 git 仓库`,
  scanEmpty: "这个文件夹下没有找到 git 仓库",
  scanLead: (root: string) => `在 ${root} 里，勾选要添加的项目`,
  scanAdded: "已添加",
  addSelected: (count: number) => `添加 ${count} 个项目`,
  addedCount: (count: number) => `已添加 ${count} 个项目`,
  scanFailed: "扫描失败",
  settings: "设置",
  collapse: "收起",
  commitHint: "一键会暂存全部变更、提交并推送到远端",
  loading: "加载中…",
  emptyTitle: "还没有项目呢",
  emptyLead: "添加本地 git 仓库后，就能一键生成提交并推送啦",
  alreadyAdded: "已在列表中",
  alreadyAddedMessage: "这个项目之前加过啦",
  skip: "跳过",
  next: "下一步",
  introPage: (page: number) => `第 ${page} 页`,
  getStarted: "开始使用",
  checkingEnv: "正在检查本机环境",
  envCheck: "环境检查",
  envLead: "提交信息由本机的 AI Agent 生成，先确认能不能跑～",
  envFailTitle: "本机还差一点",
  envFailLead: "环境没齐的话没法提交并推送，先修好再来呀",
  recheck: "重新检查",
  viewChanges: "查看变更",
  diffHint: "点击有改动的项目，可查看本次改动",
  openFolder: "打开文件夹",
  removeProject: "移除项目",
  confirmCommit: "确认提交",
  confirmRemove: "确认移除",
  confirmCommitQuestion: "暂存全部变更、提交并推送？",
  confirmRemoveQuestion: "从列表移除？本地仓库还在",
  cancel: "取消",
  commit: "提交",
  remove: "移除",
  // 提交状态
  commitPush: "提交并推送",
  recentCommits: "最近提交",
  recentCommitsEmpty: "还没有任何提交",
  recentCommitsNotRepo: "这个路径不是 git 仓库",
  recentCommitsMissing: "项目路径不存在",
  recentCommitsFailed: "读取提交记录失败",
  justNow: "刚刚",
  minutesAgo: (count: number) => `${count} 分钟前`,
  hoursAgo: (count: number) => `${count} 小时前`,
  daysAgo: (count: number) => `${count} 天前`,
  monthsAgo: (count: number) => `${count} 个月前`,
  yearsAgo: (count: number) => `${count} 年前`,
  pull: "拉取",
  pulling: "拉取中…",
  pulled: "已拉取",
  pullFailed: "拉取失败",
  committing: "提交中…",
  committingRow: "提交中… 稍等一下呀",
  pushed: "已推送",
  failed: "失败",
  commitFailed: "提交失败",
  uncommitted: "有未提交变更",
  noChanges: "暂无变更",
  // 差异窗口
  diffTitle: (name: string) => `${name} 的变更`,
  fileCount: (count: number) => `${count} 个文件`,
  colorblind: "色弱模式",
  colorblindTip: "增删改用蓝色 / 橙色，红绿色弱也能分清",
  hideTests: "隐藏测试文件",
  hiddenCount: (count: number) => `已隐藏 ${count}`,
  hideTestsTip: "只影响列表显示，提交时测试文件仍会一起提交",
  refresh: "刷新",
  codeZoomTip: "点击恢复 100%（⌘0）",
  zoomIn: "放大代码",
  zoomOut: "缩小代码",
  loadDiffFailed: "读取变更失败",
  retry: "重试",
  workingTreeClean: "工作区很干净，没有要提交的变更",
  filterFiles: "筛选文件…",
  openInEditor: "在编辑器打开",
  binaryFile: "二进制文件或无文本变化",
  noMatchingFiles: "没有匹配的文件",
  onlyTestsChanged: "只有测试文件有变更，关闭右上角「隐藏测试文件」查看",
  confirmCommitTitle: "确认提交并推送？",
  confirmCommitDetail: "会暂存全部变更（含隐藏的测试文件）、提交并推送到远端。",
  menuOpen: "打开",
  menuOpenWith: "打开方式",
  menuDefaultApp: (name: string) => `${name}（默认）`,
  menuReveal: "在访达中显示",
  menuCopyPath: "复制路径",
  menuCopyRelativePath: "复制相对路径",
  menuCopyName: "复制名称",
  menuDiscard: "丢弃改动…",
  confirmDiscardTitle: (count: number) => `丢弃 ${count} 个文件的改动？`,
  confirmDiscardDetail: "文件会恢复到上次提交时的样子，新增的文件会被删除。无法撤销。",
  discard: "丢弃",
  discarded: "已丢弃改动",
  discardFailed: "丢弃失败",
  selectForCommit: "选中以提交",
  selectAll: "全选",
  deselectAll: "全不选",
  selectedCount: (count: number, total: number) => `已选 ${count}/${total}`,
  commitSelected: (count: number, hiddenCount: number) =>
    `提交选中的 ${count} 个文件并推送${hiddenCount ? `（含 ${hiddenCount} 个隐藏的测试文件）` : ""}`,
  confirmCommitSelectedDetail: (count: number) => `只会提交选中的 ${count} 个文件并推送到远端，其余改动留在工作区。`,
  // 引导与环境检查
  introSteps: [
    {
      title: "AI 写代码，你得看懂项目",
      sub: "别让项目变成黑盒",
      lead: "Review 不是挑错，是让你始终最懂这个项目。",
    },
    {
      title: "只看重点",
      sub: "噪音收起，关键改动留下",
      lead: "非重点文件一键收起，只提交勾选的文件。",
    },
    {
      title: "验收时，项目总在换",
      lead: "所有项目一屏看完，有改动的排在前面。",
    },
    {
      title: "主对话，留给真正的事",
      lead: "提交信息在独立短会话里生成，不弄脏你的上下文。",
    },
    {
      title: "贴在屏幕边，点一下就交",
      sub: "⌃E 随时呼出",
      lead: "一键提交并推送，冲突自动撤回。",
    },
  ] as { title: string; sub?: string; lead: string }[],
  preflightChecks: {
    agent: { label: "AI Agent", detail: "非交互可跑通" },
    git: { label: "git", detail: "本机可调用" },
  } as Record<string, { label: string; detail: string }>,
};

export type TMessages = typeof zh;

const en: TMessages = {
  shortcutUnavailable: "Shortcut unavailable",
  toggleShortcut: "Toggle shortcut",
  pressNewShortcut: "Press keys…",
  diffWindowSize: "Diff window size",
  customSize: " (custom)",
  launchAtLogin: "Launch at login",
  confirmBeforeCommit: "Confirm before commit",
  prewarmCommitMessage: "Pre-generate commit messages",
  prewarmCommitMessageTip:
    "When a project's changes stay the same for one check interval, Asurada writes the commit message in the background, so committing doesn't wait for your AI agent. Nothing is generated when there are no changes. This makes extra agent calls and uses some of your quota.",
  prewarmInterval: "Check interval",
  seconds: (count) => `${count}s`,
  appearance: "Appearance",
  themeLight: "Light",
  themeDark: "Dark",
  themeSystem: "System",
  language: "Language",
  projectSort: "Sort projects",
  settingsGeneral: "General",
  settingsCommit: "Commit",
  settingsAbout: "About",
  projectCount: (count) => (count === 1 ? "1 project" : `${count} projects`),
  sortUpdated: "Recently updated",
  sortDirty: "Uncommitted first",
  sortName: "Name",
  sortAdded: "Date added",
  searchProjects: "Search projects…",
  clearSearch: "Clear search",
  noMatchingProjects: "No matching projects",
  version: "Version",
  checkUpdate: "Check for updates",
  updateTo: (version) => `Update to ${version}`,
  updateChecking: "Checking…",
  updateLatest: "Up to date",
  updateDownloading: (progress) => (progress ? `Downloading ${progress}%` : "Downloading…"),
  updateCheckError: "Check failed, try again later",
  updateInstallError: "Update failed, try again later",
  newVersion: (version) => `Version ${version} available`,
  openSettingsToUpdate: "Open settings to update",
  viewIntro: "View intro",
  back: "Back",
  agent: "Agent",
  agentTip: "Which local AI agent writes commit messages",
  agentNone: "None found",
  testAgent: "Test",
  agentOk: (name) => `${name} works`,
  agentFailed: "Agent unavailable",
  agentSwitch: "Try another agent:",
  agentPickTitle: "Choose an agent",
  agentPickLead: "Asurada uses it to write commit messages. You can change it later in Settings.",
  agentNoneTitle: "No AI agent yet",
  agentNoneLead: "Asurada uses one to write commit messages. Run any command below in Terminal, then click Rescan.",
  copyCommand: "Copy install command",
  copied: "Copied",
  copyLog: "Copy log",
  agentRescan: "Rescan",
  continue: "Continue",
  panel: "ASURADA panel",
  backToMain: "Back to projects",
  tagFailed: "A commit failed",
  tagPending: "Uncommitted changes",
  envIssue: "Environment issue, view checks",
  addProject: "Add project",
  addSingleProject: "Add a project",
  scanFolder: "Scan a folder…",
  pickRepoTitle: "Choose a local git repository",
  pickScanRootTitle: "Choose a folder to scan",
  scanning: "Scanning…",
  scanTitle: (count) => (count === 1 ? "Found 1 git repository" : `Found ${count} git repositories`),
  scanEmpty: "No git repositories found in this folder",
  scanLead: (root) => `In ${root}, pick the projects to add`,
  scanAdded: "Added",
  addSelected: (count) => (count === 1 ? "Add 1 project" : `Add ${count} projects`),
  addedCount: (count) => (count === 1 ? "Added 1 project" : `Added ${count} projects`),
  scanFailed: "Scan failed",
  settings: "Settings",
  collapse: "Collapse",
  commitHint: "One click stages all changes, commits, and pushes",
  loading: "Loading…",
  emptyTitle: "No projects yet",
  emptyLead: "Add a local git repository to commit and push in one click",
  alreadyAdded: "Already added",
  alreadyAddedMessage: "This project is already in the list",
  skip: "Skip",
  next: "Next",
  introPage: (page) => `Page ${page}`,
  getStarted: "Get started",
  checkingEnv: "Checking environment",
  envCheck: "Environment check",
  envLead: "Commit messages are written by a local AI agent. Making sure it runs.",
  envFailTitle: "Almost there",
  envFailLead: "Commit and push won't work until these are fixed.",
  recheck: "Check again",
  viewChanges: "View changes",
  diffHint: "Click a project with changes to review them",
  openFolder: "Open folder",
  removeProject: "Remove project",
  confirmCommit: "Confirm commit",
  confirmRemove: "Confirm removal",
  confirmCommitQuestion: "Stage all changes, commit, and push?",
  confirmRemoveQuestion: "Remove from list? The local repo stays.",
  cancel: "Cancel",
  commit: "Commit",
  remove: "Remove",
  commitPush: "Commit & Push",
  recentCommits: "Recent commits",
  recentCommitsEmpty: "No commits yet",
  recentCommitsNotRepo: "This path is not a git repository",
  recentCommitsMissing: "Project path is missing",
  recentCommitsFailed: "Couldn't read commits",
  justNow: "just now",
  minutesAgo: (count) => (count === 1 ? "1 minute ago" : `${count} minutes ago`),
  hoursAgo: (count) => (count === 1 ? "1 hour ago" : `${count} hours ago`),
  daysAgo: (count) => (count === 1 ? "1 day ago" : `${count} days ago`),
  monthsAgo: (count) => (count === 1 ? "1 month ago" : `${count} months ago`),
  yearsAgo: (count) => (count === 1 ? "1 year ago" : `${count} years ago`),
  pull: "Pull",
  pulling: "Pulling…",
  pulled: "Pulled",
  pullFailed: "Pull failed",
  committing: "Committing…",
  committingRow: "Committing…",
  pushed: "Pushed",
  failed: "Failed",
  commitFailed: "Commit failed",
  uncommitted: "Uncommitted changes",
  noChanges: "No changes",
  diffTitle: (name) => `Changes in ${name}`,
  fileCount: (count) => (count === 1 ? "1 file" : `${count} files`),
  colorblind: "Colorblind mode",
  colorblindTip: "Show additions and deletions in blue / orange instead of green / red",
  hideTests: "Hide test files",
  hiddenCount: (count) => `${count} hidden`,
  hideTestsTip: "Only affects the list; test files are still committed",
  refresh: "Refresh",
  codeZoomTip: "Click to reset to 100% (⌘0)",
  zoomIn: "Zoom in code",
  zoomOut: "Zoom out code",
  loadDiffFailed: "Failed to load changes",
  retry: "Retry",
  workingTreeClean: "Working tree clean, nothing to commit",
  filterFiles: "Filter files…",
  openInEditor: "Open in editor",
  binaryFile: "Binary file or no text changes",
  noMatchingFiles: "No matching files",
  onlyTestsChanged: "Only test files changed. Turn off “Hide test files” at the top right to see them.",
  confirmCommitTitle: "Commit and push?",
  confirmCommitDetail: "All changes (including hidden test files) will be staged, committed, and pushed.",
  menuOpen: "Open",
  menuOpenWith: "Open With",
  menuDefaultApp: (name) => `${name} (default)`,
  menuReveal: "Reveal in Finder",
  menuCopyPath: "Copy Path",
  menuCopyRelativePath: "Copy Relative Path",
  menuCopyName: "Copy Name",
  menuDiscard: "Discard Changes…",
  confirmDiscardTitle: (count) => (count === 1 ? "Discard changes in 1 file?" : `Discard changes in ${count} files?`),
  confirmDiscardDetail: "Files go back to the last commit and new files are deleted. This can't be undone.",
  discard: "Discard",
  discarded: "Changes discarded",
  discardFailed: "Discard failed",
  selectForCommit: "Select for commit",
  selectAll: "Select all",
  deselectAll: "Deselect all",
  selectedCount: (count, total) => `${count}/${total} selected`,
  commitSelected: (count, hiddenCount) =>
    `Commit and push ${count === 1 ? "1 selected file" : `${count} selected files`}${hiddenCount ? ` (incl. ${hiddenCount} hidden test files)` : ""}`,
  confirmCommitSelectedDetail: (count) =>
    `Only the ${count === 1 ? "selected file" : `${count} selected files`} will be committed and pushed; other changes stay in the working tree.`,
  introSteps: [
    {
      title: "AI writes the code, you own the project",
      sub: "Don't let it turn into a black box",
      lead: "Review isn't about catching mistakes. It keeps you the one who knows the project best.",
    },
    {
      title: "Review only what matters",
      sub: "Fold the noise, keep the key changes",
      lead: "Fold away less important files and commit only the ones you pick.",
    },
    {
      title: "Reviewing means switching projects",
      lead: "All projects on one screen, changed ones on top.",
    },
    {
      title: "Keep the main chat for real work",
      lead: "Commit messages come from a separate short session, so your context stays clean.",
    },
    {
      title: "On the screen edge, one click to commit",
      sub: "Press ⌃E anytime",
      lead: "Commit and push in one click. Conflicts roll back automatically.",
    },
  ],
  preflightChecks: {
    agent: { label: "AI Agent", detail: "Runs non-interactively" },
    git: { label: "git", detail: "Available locally" },
  },
};

const MESSAGES: Record<LanguageEnum, TMessages> = { zh, en };

// 没手动选过时跟随系统语言（不写入存储，系统语言改了也跟着变）；先按浏览器语言猜，系统语言读到后再纠正
const storedLanguage = localStorage.getItem(LANGUAGE_KEY) as LanguageEnum | null;
let language =
  storedLanguage ?? (navigator.language.startsWith("zh") ? LanguageEnum.Zh : LanguageEnum.En);

/** 当前生效的语言，提交时传给后端决定提交信息的语言 */
export function readLanguage(): LanguageEnum {
  return language;
}
const subscribers = new Set<() => void>();

function applyLanguage(next: LanguageEnum) {
  language = next;
  document.documentElement.lang = next === LanguageEnum.Zh ? "zh-CN" : "en";
  subscribers.forEach((notify) => notify());
}

applyLanguage(language);

if (isTauri && !storedLanguage) {
  void invoke<LanguageEnum>("get_system_language")
    .then(applyLanguage)
    .catch((e) => console.error("读取系统语言失败", e));
}

// 主面板和 diff 窗口互相同步
if (isTauri) {
  void listen<LanguageEnum>(LANGUAGE_EVENT, ({ payload }) => applyLanguage(payload)).catch((e) =>
    console.error("监听语言切换失败", e),
  );
}

export function setLanguage(next: LanguageEnum) {
  localStorage.setItem(LANGUAGE_KEY, next);
  applyLanguage(next);
  if (isTauri) {
    emit(LANGUAGE_EVENT, next).catch((e) => console.error("同步语言失败", e));
  }
}

/** 非组件代码（右键菜单等）用：当前语言的文案 */
export function getMessages(): TMessages {
  return MESSAGES[language];
}

function subscribe(notify: () => void) {
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
  };
}

export function useLanguage() {
  const current = useSyncExternalStore(subscribe, () => language);
  return { language: current, t: MESSAGES[current] };
}
