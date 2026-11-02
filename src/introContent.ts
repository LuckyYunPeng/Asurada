export const INTRO_STORAGE_KEY = "asurada_intro_complete";

/** 设置页「查看引导」行标签 */
export const VIEW_INTRO_LABEL = "查看引导";

export const INTRO_STEPS = [
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
    lead: "Asurada 用独立短会话生成中文 Conventional Commit 并 push；交完就散，不留尾巴。",
  },
] as const;

export const PREFLIGHT_CHECK_META: Record<
  string,
  { label: string; detail: string }
> = {
  pi_path: { label: "pi 在 PATH", detail: "which pi" },
  pi_print: { label: "pi --print", detail: "非交互可跑通" },
  git: { label: "git", detail: "本机可调用" },
};
