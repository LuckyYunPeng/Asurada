import type { TMessages } from "./i18n";
import type { ProjectRowState } from "./types";

export type RowKind = "clean" | "dirty" | "run" | "ok" | "err";

export function getRowPresentation(row: ProjectRowState, t: TMessages): {
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
      statusText: t.committingRow,
      btnDisabled: true,
      btnBusy: true,
    };
  }

  if (uiState === "failure") {
    const summary = row.resultSummary ?? t.commitFailed;
    return {
      kind: "err",
      statusText: summary.startsWith(t.failed) ? summary : `${t.failed} · ${summary}`,
      btnDisabled: project.gitClean,
      btnBusy: false,
      btnTitle: project.gitClean ? t.noChanges : undefined,
    };
  }

  if (!project.gitClean) {
    return {
      kind: "dirty",
      statusText: t.uncommitted,
      btnDisabled: false,
      btnBusy: false,
    };
  }

  return {
    kind: uiState === "success" ? "ok" : "clean",
    statusText: project.lastCommitMessage ?? t.noChanges,
    btnDisabled: true,
    btnBusy: false,
    btnTitle: t.noChanges,
  };
}
