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

export type RowUiState = "idle" | "running" | "success" | "failure";

export interface ProjectView {
  id: string;
  path: string;
  displayName: string;
  shortPath: string;
  gitClean: boolean;
  gitStatusLabel: string;
  lastCommitMessage: string | null;
}

export interface CommitPushResult {
  success: boolean;
  commitMessage?: string | null;
  pushOutput: string;
  error?: string | null;
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
