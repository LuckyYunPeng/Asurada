export interface PreflightItem {
  id: string;
  ok: boolean;
  message: string;
}

export interface PreflightResult {
  ready: boolean;
  checks: PreflightItem[];
  summary: string;
}

export interface IAgentInfo {
  id: string;
  name: string;
  isInstalled: boolean;
}

export interface IAgentList {
  agents: IAgentInfo[];
  /** 当前生效的 Agent；一个都没装时为空 */
  current: string | null;
  /** 用户是否亲自选过 */
  isChosen: boolean;
}

export interface IScannedRepo {
  path: string;
  name: string;
  relativePath: string;
  isAdded: boolean;
}

export type RowUiState = "idle" | "running" | "success" | "failure";

export interface ProjectView {
  id: string;
  path: string;
  displayName: string;
  shortPath: string;
  gitClean: boolean;
  gitStatusLabel: string;
  lastCommitMessage: string | null;
  /** 最近一次变动的 Unix 秒 */
  updatedAt: number | null;
}

export interface CommitPushResult {
  success: boolean;
  commitMessage?: string | null;
  pushOutput: string;
  error?: string | null;
}

/** 后端广播的提交进度，主面板和 diff 窗口共用 */
export interface ICommitPushEvent {
  id: string;
  phase: "running" | "done";
  result: CommitPushResult | null;
}

export interface ProjectRowState {
  project: ProjectView;
  uiState: RowUiState;
  resultSummary?: string;
  resultDetail?: string;
  resultExpanded?: boolean;
}

export interface ToggleShortcutInfo {
  shortcut: string;
  display: string;
}

/** 一条本地提交，只读列表用 */
export interface RecentCommit {
  shortHash: string;
  subject: string;
  /** 完整提交说明（标题加正文） */
  message: string;
  author: string;
  /** 提交时间，Unix 秒 */
  committedAt: number;
}

export type RecentCommitsResponse =
  | { status: "ok"; commits: RecentCommit[] }
  | { status: "empty" }
  | { status: "notRepo" }
  | { status: "missing" }
  | { status: "failed" };
