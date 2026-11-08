import type {
  PreflightResult,
  ProjectRowState,
  ProjectView,
  RecentCommit,
} from "./types";

export type CaptureScene =
  | "intro-1"
  | "intro-2"
  | "intro-3"
  | "precheck"
  | "precheck-fail"
  | "list"
  | "empty"
  | "running"
  | "result"
  | "cloud-ok"
  | "cloud-err"
  | "settings"
  | "recent"
  | "recent-open"
  | "recent-loading"
  | "recent-empty";

export function getCaptureScene(): CaptureScene | null {
  if (!import.meta.env.DEV) return null;
  const raw = new URLSearchParams(window.location.search).get("capture");
  if (!raw) return null;
  return raw as CaptureScene;
}

const mockProjectA: ProjectView = {
  id: "cap-a",
  path: "/Users/dev/fe-ceranva-landing",
  displayName: "fe-ceranva-landing",
  shortPath: "…/fe-ceranva-landing",
  gitClean: false,
  gitStatusLabel: "有未提交变更",
  lastCommitMessage: "feat: 调整落地页导航间距",
  updatedAt: null,
};

const mockProjectB: ProjectView = {
  id: "cap-b",
  path: "/Users/dev/asurada",
  displayName: "asurada",
  shortPath: "…/asurada",
  gitClean: true,
  gitStatusLabel: "工作区干净",
  lastCommitMessage: null,
  updatedAt: null,
};

export const mockPreflightOk: PreflightResult = {
  ready: true,
  summary: "环境就绪",
  checks: [
    { id: "agent", ok: true, message: "pi" },
    { id: "git", ok: true, message: "git version 2.43.0" },
  ],
};

export const mockPreflightFail: PreflightResult = {
  ready: false,
  summary: "AI Agent 不可用：没有检测到可用的 AI Agent，请安装 pi、Claude Code、Codex 等任意一个",
  checks: [
    { id: "agent", ok: false, message: "没有检测到可用的 AI Agent，请安装 pi、Claude Code、Codex 等任意一个" },
    { id: "git", ok: true, message: "git version 2.43.0" },
  ],
};

export interface CaptureBootstrap {
  panelOpen: boolean;
  introComplete: boolean;
  introStep: number;
  loading: boolean;
  preflight: PreflightResult | null;
  preflightLoading: boolean;
  rows: ProjectRowState[];
  toast: { title: string; message: string; kind: "ok" | "err" } | null;
  skipInvoke: boolean;
  settingsOpen?: boolean;
  toggleShortcutDisplay?: string;
  recentProjectId?: string;
  recentPreview?: RecentCommitsPreview;
}

export interface RecentCommitsPreview {
  loading?: boolean;
  status: "ok" | "empty" | "notRepo" | "missing" | "failed";
  commits: RecentCommit[];
  expandedHash?: string;
}

const recentNow = Math.floor(Date.now() / 1000);

const mockRecentCommits: RecentCommit[] = [
  {
    shortHash: "a1b2c3d",
    subject: "feat: 项目行增加只读最近提交",
    message: "feat: 项目行增加只读最近提交\n\n只读查看最近 10 条本地提交，不访问远端。",
    author: "Ada",
    committedAt: recentNow - 12 * 60,
  },
  {
    shortHash: "b2c3d4e",
    subject: "fix: 面板顶部焦点框被裁切",
    message: "fix: 面板顶部焦点框被裁切",
    author: "Ada",
    committedAt: recentNow - 3 * 60 * 60,
  },
  {
    shortHash: "c3d4e5f",
    subject: "feat: 项目搜索",
    message: "feat: 项目搜索\n\n按名称或路径筛选，Esc 清空。",
    author: "Lin",
    committedAt: recentNow - 2 * 24 * 60 * 60,
  },
  {
    shortHash: "d4e5f6a",
    subject: "chore: 发布 v0.7.2",
    message: "chore: 发布 v0.7.2",
    author: "Ada",
    committedAt: recentNow - 6 * 24 * 60 * 60,
  },
  {
    shortHash: "e5f6a7b",
    subject: "perf: 差异窗口滚动不再卡顿",
    message: "perf: 差异窗口滚动不再卡顿",
    author: "Lin",
    committedAt: recentNow - 18 * 24 * 60 * 60,
  },
  {
    shortHash: "f6a7b8c",
    subject: "feat: 自选 AI Agent 写提交信息",
    message: "feat: 自选 AI Agent 写提交信息",
    author: "Ada",
    committedAt: recentNow - 40 * 24 * 60 * 60,
  },
];

export function bootstrapCapture(scene: CaptureScene): CaptureBootstrap {
  const base: CaptureBootstrap = {
    panelOpen: true,
    introComplete: true,
    introStep: -1,
    loading: false,
    preflight: mockPreflightOk,
    preflightLoading: false,
    rows: [],
    toast: null,
    skipInvoke: true,
  };

  switch (scene) {
    case "intro-1":
      return {
        ...base,
        introComplete: false,
        introStep: 0,
        preflight: null,
        skipInvoke: true,
      };
    case "intro-2":
      return {
        ...base,
        introComplete: false,
        introStep: 1,
        preflight: null,
        skipInvoke: true,
      };
    case "intro-3":
      return {
        ...base,
        introComplete: false,
        introStep: 2,
        preflight: null,
        skipInvoke: true,
      };
    case "precheck":
      return {
        ...base,
        introComplete: true,
        preflight: null,
        preflightLoading: true,
        skipInvoke: true,
      };
    case "precheck-fail":
      return {
        ...base,
        introComplete: true,
        preflight: mockPreflightFail,
        preflightLoading: false,
        skipInvoke: true,
      };
    case "empty":
      return { ...base, rows: [] };
    case "list":
      return {
        ...base,
        // 干净项目故意放前面，验证待提交的会被排到上面
        rows: [
          { project: mockProjectB, uiState: "idle" },
          { project: mockProjectA, uiState: "idle" },
        ],
      };
    case "running":
      return {
        ...base,
        rows: [
          { project: mockProjectA, uiState: "running" },
          { project: mockProjectB, uiState: "idle" },
        ],
      };
    case "result":
      return {
        ...base,
        toast: {
          title: "已推送",
          message: "feat: 调整落地页导航间距",
          kind: "ok",
        },
        rows: [
          {
            project: { ...mockProjectA, gitClean: true },
            uiState: "success",
            resultSummary: "已推送 · feat: 调整落地页导航间距",
          },
          {
            project: mockProjectB,
            uiState: "failure",
            resultSummary:
              "失败 · To https://github.com/LuckyYunPeng/asurada.git\n ! [remote rejected] main -> main (refusing to allow an OAuth App to create or update workflow `.github/workflows/build-macos.yml` without `workflow` scope)\nerror: failed to push some refs to 'https://github.com/LuckyYunPeng/asurada.git'",
          },
        ],
      };
    case "cloud-ok":
      return {
        ...base,
        panelOpen: false,
        toast: { title: "已推送", message: "feat: 调整落地页导航间距", kind: "ok" },
        rows: [{ project: mockProjectB, uiState: "idle" }],
      };
    case "cloud-err":
      return {
        ...base,
        panelOpen: false,
        toast: {
          title: "失败",
          message: "push 被拒（non-fast-forward）：远端包含本地没有的提交，请先 git pull --rebase 再重试",
          kind: "err",
        },
        rows: [
          { project: mockProjectB, uiState: "failure", resultSummary: "push 被拒（non-fast-forward）" },
        ],
      };
    case "settings":
      return {
        ...base,
        rows: [{ project: mockProjectB, uiState: "idle" }],
        settingsOpen: true,
        toggleShortcutDisplay: "⌃E",
        skipInvoke: true,
      };
    case "recent":
    case "recent-open":
      return {
        ...base,
        rows: [
          { project: mockProjectA, uiState: "idle" },
          { project: mockProjectB, uiState: "idle" },
        ],
        recentProjectId: mockProjectB.id,
        recentPreview: {
          status: "ok",
          commits: mockRecentCommits,
          expandedHash: scene === "recent-open" ? mockRecentCommits[0].shortHash : undefined,
        },
      };
    case "recent-loading":
      return {
        ...base,
        rows: [{ project: mockProjectB, uiState: "idle" }],
        recentProjectId: mockProjectB.id,
        recentPreview: { loading: true, status: "ok", commits: [] },
      };
    case "recent-empty":
      return {
        ...base,
        rows: [{ project: mockProjectB, uiState: "idle" }],
        recentProjectId: mockProjectB.id,
        recentPreview: { status: "empty", commits: [] },
      };
    default:
      return base;
  }
}
