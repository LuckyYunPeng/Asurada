import type { ProjectRowState } from "./types";

export type RowKind = "clean" | "dirty" | "run" | "ok" | "err";

export function getRowPresentation(row: ProjectRowState): {
  kind: RowKind;
  statusText: string;
  btnDisabled: boolean;
  btnBusy: boolean;
  btnTitle?: string;
} {
  const { project, uiState } = row;

  if (uiState === "running") {
    return {
      kind: "run",
      statusText: "提交中… 稍等一下呀",
      btnDisabled: true,
      btnBusy: true,
    };
  }

  if (uiState === "failure") {
    const summary = row.resultSummary ?? "提交失败";
    return {
      kind: "err",
      statusText: summary.startsWith("失败") ? summary : `失败 · ${summary}`,
      btnDisabled: project.gitClean,
      btnBusy: false,
      btnTitle: project.gitClean ? "无变更" : undefined,
    };
  }

  if (!project.gitClean) {
    return {
      kind: "dirty",
      statusText: "有未提交变更",
      btnDisabled: false,
      btnBusy: false,
    };
  }

  return {
    kind: uiState === "success" ? "ok" : "clean",
    statusText: project.lastCommitMessage ?? "暂无变更",
    btnDisabled: true,
    btnBusy: false,
    btnTitle: project.lastCommitMessage ? "无变更" : "暂无变更",
  };
}
