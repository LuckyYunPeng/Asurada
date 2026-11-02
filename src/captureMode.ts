import type {
  PreflightResult,
  ProjectRowState,
  ProjectView,
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
  | "result";

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
};

const mockProjectB: ProjectView = {
  id: "cap-b",
  path: "/Users/dev/asurada",
  displayName: "asurada",
  shortPath: "…/asurada",
  gitClean: true,
  gitStatusLabel: "工作区干净",
};

export const mockPreflightOk: PreflightResult = {
  ready: true,
  summary: "环境就绪",
  checks: [
    { id: "pi_path", ok: true, message: "pi 已在 PATH 中" },
    { id: "pi_print", ok: true, message: "pi --print 可非交互启动" },
    { id: "git", ok: true, message: "git version 2.43.0" },
  ],
};

export const mockPreflightFail: PreflightResult = {
  ready: false,
  summary: "pi 未找到：请安装 pi 并确保在终端可执行（PATH）",
  checks: [
    { id: "pi_path", ok: false, message: "请安装 pi 并确保在终端可执行（PATH）" },
    { id: "pi_print", ok: false, message: "未检测：请先将 pi 安装并加入 PATH" },
    { id: "git", ok: true, message: "git version 2.43.0" },
  ],
};

export interface CaptureBootstrap {
  introComplete: boolean;
  introStep: number;
  loading: boolean;
  preflight: PreflightResult | null;
  preflightLoading: boolean;
  rows: ProjectRowState[];
  toast: { message: string; kind: "ok" | "err" } | null;
  skipInvoke: boolean;
}

export function bootstrapCapture(scene: CaptureScene): CaptureBootstrap {
  const base: CaptureBootstrap = {
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
        rows: [
          { project: mockProjectA, uiState: "idle" },
          { project: mockProjectB, uiState: "idle" },
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
          message: "已推送 · feat: 调整落地页导航间距",
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
            resultSummary: "失败 · push 被拒（non-fast-forward）",
          },
        ],
      };
    default:
      return base;
  }
}
