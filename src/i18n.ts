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
  diffWindowSize: "变更窗口大小",
  customSize: "（自定义）",
  launchAtLogin: "开机自动启动",
  confirmBeforeCommit: "提交前确认",
  appearance: "外观",
  themeLight: "亮色",
  themeDark: "深色",
  themeSystem: "跟随系统",
  language: "语言",
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
  // 主面板
  panel: "ASURADA 面板",
  backToMain: "回到主面板",
  tagFailed: "有项目提交失败",
  tagPending: "有项目待提交",
  envIssue: "环境异常，查看检查",
  addProject: "添加项目",
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
  getStarted: "开始使用",
  checkingEnv: "正在检查本机环境",
  envCheck: "环境检查",
  envLead: "依赖本机 pi agent，先确认能不能跑～",
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
  // 引导与环境检查
  introSteps: [
    {
      title: "验收时，项目总在换",
      lead: "本地同时盯着好几个仓库，改一批、验一批、再切下一个。节奏很快，提交却总打断手感。",
    },
    {
      title: "主对话，留给真正的事",
      lead: "让 Agent 代写 commit 很方便，但塞进主会话会弄脏上下文和历史记录。验收来回切时尤其烦。",
    },
    {
      title: "贴在屏幕边，点一下就交",
      sub: "验收完就交，别为了 commit 再开一场聊",
      lead: "ASURADA 用独立短会话生成 Conventional Commit 并 push；交完就散，不留尾巴。",
    },
  ] as { title: string; sub?: string; lead: string }[],
  preflightChecks: {
    pi_path: { label: "pi 在 PATH", detail: "which pi" },
    pi_print: { label: "pi --print", detail: "非交互可跑通" },
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
  appearance: "Appearance",
  themeLight: "Light",
  themeDark: "Dark",
  themeSystem: "System",
  language: "Language",
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
  panel: "ASURADA panel",
  backToMain: "Back to projects",
  tagFailed: "A commit failed",
  tagPending: "Uncommitted changes",
  envIssue: "Environment issue, view checks",
  addProject: "Add project",
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
  getStarted: "Get started",
  checkingEnv: "Checking environment",
  envCheck: "Environment check",
  envLead: "Asurada relies on the local pi agent. Making sure it runs.",
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
  introSteps: [
    {
      title: "Reviewing means switching projects",
      lead: "You're watching several repos at once: change a batch, check it, move on. The pace is fast, and committing keeps breaking the flow.",
    },
    {
      title: "Keep the main chat for real work",
      lead: "Letting an agent write commits is handy, but doing it in your main session clutters its context and history, especially while jumping between reviews.",
    },
    {
      title: "On the screen edge, one click to commit",
      sub: "Commit when the review is done, no extra chat needed",
      lead: "ASURADA writes a Conventional Commit in a separate short session and pushes it. Nothing left behind.",
    },
  ],
  preflightChecks: {
    pi_path: { label: "pi in PATH", detail: "which pi" },
    pi_print: { label: "pi --print", detail: "Runs non-interactively" },
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
