/** 设置「提交前确认」，主面板和 diff 窗口共用（同源 localStorage）；点按钮时现读，两个窗口不用同步 */
export const CONFIRM_COMMIT_KEY = "asurada.confirmBeforeCommit";

export function isConfirmCommitEnabled() {
  return localStorage.getItem(CONFIRM_COMMIT_KEY) === "1";
}

/** 设置「后台预生成提交信息」，默认打开 */
export const PREWARM_COMMIT_KEY = "asurada.prewarmCommitMessage";

export function isPrewarmCommitEnabled() {
  return localStorage.getItem(PREWARM_COMMIT_KEY) !== "0";
}

/** 预生成的检查间隔（秒）：改动连续两次检查不变才生成 */
export const PREWARM_INTERVAL_KEY = "asurada.prewarmIntervalSeconds";
export const PREWARM_INTERVAL_RANGE = { min: 10, max: 300, step: 10, default: 30 };

export function readPrewarmInterval() {
  const seconds = Number(localStorage.getItem(PREWARM_INTERVAL_KEY));
  return seconds >= PREWARM_INTERVAL_RANGE.min && seconds <= PREWARM_INTERVAL_RANGE.max
    ? seconds
    : PREWARM_INTERVAL_RANGE.default;
}
