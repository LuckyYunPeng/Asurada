/** 设置「提交前确认」，主面板和 diff 窗口共用（同源 localStorage）；点按钮时现读，两个窗口不用同步 */
export const CONFIRM_COMMIT_KEY = "asurada.confirmBeforeCommit";

export function isConfirmCommitEnabled() {
  return localStorage.getItem(CONFIRM_COMMIT_KEY) === "1";
}
