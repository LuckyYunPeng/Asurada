//! 本机 AI Agent：检测装了哪些，用选中的那个以非交互方式「给一段文字、要一行输出」。
//! 改动内容由 Asurada 读好放进提示词，Agent 不读仓库、不需要任何工具权限。
use serde::Serialize;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

pub struct AgentSpec {
    pub id: &'static str,
    pub name: &'static str,
    pub bin: &'static str,
    pub args: &'static [&'static str],
    /// true：提示词作为最后一个参数传（Kimi 不读 stdin）；false：从 stdin 传
    pub is_prompt_arg: bool,
}

/// 顺序就是默认优先级：没选过时用第一个装了的
pub const AGENTS: &[AgentSpec] = &[
    AgentSpec {
        id: "pi",
        name: "pi",
        bin: "pi",
        args: &[
            "--no-session",
            "--no-extensions",
            "--no-mcp",
            "--no-skills",
            "--no-tools",
            "--thinking",
            "off",
            "--print",
        ],
        is_prompt_arg: false,
    },
    AgentSpec {
        id: "claude",
        name: "Claude Code",
        bin: "claude",
        args: &["-p", "--no-session-persistence", "--tools", ""],
        is_prompt_arg: false,
    },
    AgentSpec {
        id: "codex",
        name: "Codex",
        bin: "codex",
        args: &[
            "exec",
            "--skip-git-repo-check",
            "--ephemeral",
            "--sandbox",
            "read-only",
            "--color",
            "never",
            "-",
        ],
        is_prompt_arg: false,
    },
    AgentSpec {
        id: "grok",
        name: "Grok",
        bin: "grok",
        args: &["-p", "-"],
        is_prompt_arg: false,
    },
    AgentSpec {
        id: "opencode",
        name: "OpenCode",
        bin: "opencode",
        args: &["run"],
        is_prompt_arg: false,
    },
    AgentSpec {
        id: "cursor",
        name: "Cursor Agent",
        bin: "cursor-agent",
        args: &["-p", "--output-format", "text"],
        // shortcut: 未登录无法实测是否读 stdin，按官方用法传参数；macOS 单个参数没有长度上限
        is_prompt_arg: true,
    },
    AgentSpec {
        id: "kimi",
        name: "Kimi",
        bin: "kimi",
        args: &["-p"],
        is_prompt_arg: true,
    },
];

/// 启动检查用：codex 冷启动实测要 20 秒
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(30);
pub const PROBE_PROMPT: &str = "只回复 OK，不要解释。";
pub const COMMIT_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub is_installed: bool,
}

pub fn list() -> Vec<AgentInfo> {
    AGENTS
        .iter()
        .map(|a| AgentInfo {
            id: a.id,
            name: a.name,
            is_installed: find_bin(a.bin).is_some(),
        })
        .collect()
}

pub fn find(id: &str) -> Option<&'static AgentSpec> {
    AGENTS.iter().find(|a| a.id == id)
}

/// 保存的 Agent 还装着就用它，否则按 AGENTS 顺序用第一个装了的
pub fn resolve(saved: Option<&str>) -> Option<&'static AgentSpec> {
    saved
        .and_then(find)
        .filter(|a| find_bin(a.bin).is_some())
        .or_else(|| AGENTS.iter().find(|a| find_bin(a.bin).is_some()))
}

/// PATH 在启动时已从登录 shell 继承（lib.rs），Finder 打开也能找到 nvm 等装的命令
fn find_bin(bin: &str) -> Option<PathBuf> {
    let paths = std::env::var_os("PATH")?;
    std::env::split_paths(&paths)
        .map(|dir| dir.join(bin))
        .find(|p| is_executable(p))
}

fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata()
        .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

/// 返回清理后的第一行输出；失败时错误信息带上 Agent 名字
pub fn run_agent(spec: &AgentSpec, prompt: &str, timeout: Duration) -> Result<String, String> {
    let bin = find_bin(spec.bin).ok_or_else(|| format!("{} 未安装或不在 PATH 中", spec.name))?;
    let mut cmd = Command::new(bin);
    cmd.args(spec.args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if spec.is_prompt_arg {
        cmd.arg(prompt).stdin(Stdio::null());
    } else {
        cmd.stdin(Stdio::piped());
    }
    // 在临时目录跑：不加载项目里的 AGENTS.md / CLAUDE.md 等，省 token 也更快
    if let Ok(temp) = std::env::temp_dir().canonicalize() {
        cmd.current_dir(temp);
    }
    let input = (!spec.is_prompt_arg).then(|| prompt.to_string());

    match run_with_timeout(cmd, input, timeout).map_err(|e| format!("{} {e}", spec.name))? {
        RunOutcome::Completed(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                let detail = tail_lines(if stderr.trim().is_empty() { &stdout } else { &stderr }, 3);
                return Err(if detail.is_empty() {
                    format!("{} 调用失败，退出码 {}", spec.name, output.status.code().unwrap_or(-1))
                } else {
                    format!("{} 调用失败：{detail}", spec.name)
                });
            }
            clean_line(&stdout).ok_or_else(|| format!("{} 没有返回内容", spec.name))
        }
        RunOutcome::TimedOut => Err(format!(
            "{} 在 {} 秒内没有响应，请检查它的登录状态或网络",
            spec.name,
            timeout.as_secs()
        )),
    }
}

/// 有的 Agent 失败时会把整段提示词回显到 stderr，只取最后几行
fn tail_lines(text: &str, count: usize) -> String {
    let lines: Vec<&str> = text.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    lines[lines.len().saturating_sub(count)..].join("\n")
}

/// 取第一行非空文本，去掉 Markdown 列表符、加粗、反引号和成对的引号（Kimi 会输出「• **OK**」）
fn clean_line(text: &str) -> Option<String> {
    let line = text.lines().map(str::trim).find(|l| !l.is_empty())?;
    let mut line = line
        .trim_start_matches(['•', '-', '*', ' '])
        .trim_matches(['*', '`'])
        .trim();
    for quote in ['"', '\'', '“'] {
        let close = if quote == '“' { '”' } else { quote };
        if line.len() > 1 && line.starts_with(quote) && line.ends_with(close) {
            line = line[quote.len_utf8()..line.len() - close.len_utf8()].trim();
        }
    }
    (!line.is_empty()).then(|| line.to_string())
}

enum RunOutcome {
    Completed(Output),
    TimedOut,
}

fn run_with_timeout(
    mut cmd: Command,
    input: Option<String>,
    timeout: Duration,
) -> Result<RunOutcome, String> {
    {
        use std::os::unix::process::CommandExt;
        // 独立进程组，超时能连同子进程一起杀掉
        cmd.process_group(0);
    }
    let mut child = cmd.spawn().map_err(|e| format!("无法启动：{e}"))?;
    // 另起线程写 stdin：输入很大时边写边让子进程输出，避免互相等管道
    if let (Some(mut stdin), Some(input)) = (child.stdin.take(), input) {
        thread::spawn(move || {
            if let Err(e) = stdin.write_all(input.as_bytes()) {
                eprintln!("Asurada: 写入 Agent stdin 失败 ({e})");
            }
        });
    }
    let pid = child.id();
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });

    match rx.recv_timeout(timeout) {
        Ok(Ok(output)) => Ok(RunOutcome::Completed(output)),
        Ok(Err(e)) => Err(format!("运行失败：{e}")),
        Err(mpsc::RecvTimeoutError::Timeout) => {
            let _ = Command::new("kill")
                .args(["-9", &format!("-{pid}")])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
            let _ = rx.recv_timeout(Duration::from_secs(2));
            Ok(RunOutcome::TimedOut)
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => Err("运行线程异常退出".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_line_strips_markdown_and_quotes() {
        assert_eq!(clean_line("• **OK**\n\n").unwrap(), "OK");
        assert_eq!(clean_line("\n  feat: add x\nmore").unwrap(), "feat: add x");
        assert_eq!(clean_line("`fix: y`").unwrap(), "fix: y");
        assert_eq!(clean_line("\"feat: z\"").unwrap(), "feat: z");
        assert_eq!(clean_line("“feat: 中文”").unwrap(), "feat: 中文");
        // 只去成对的引号，正文里的不动
        assert_eq!(clean_line("fix: handle 'foo'").unwrap(), "fix: handle 'foo'");
        assert!(clean_line(" \n \n").is_none());
    }

    #[test]
    fn tail_lines_keeps_last_non_empty() {
        assert_eq!(tail_lines("a\n\nb\nc\nd\n", 3), "b\nc\nd");
        assert_eq!(tail_lines("x", 3), "x");
    }

    #[test]
    fn agent_ids_unique() {
        let mut ids: Vec<&str> = AGENTS.iter().map(|a| a.id).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), AGENTS.len());
    }

    #[test]
    fn run_agent_via_stdin_and_timeout() {
        // 用 cat / sleep 模拟 Agent：stdin 原样回显、超时被杀
        let echo = AgentSpec { id: "t", name: "T", bin: "cat", args: &[], is_prompt_arg: false };
        let big = format!("feat: hi\n{}", "x".repeat(300_000));
        assert_eq!(run_agent(&echo, &big, Duration::from_secs(10)).unwrap(), "feat: hi");
        let slow = AgentSpec { id: "s", name: "S", bin: "sleep", args: &[], is_prompt_arg: true };
        let err = run_agent(&slow, "5", Duration::from_millis(300)).unwrap_err();
        assert!(err.contains("没有响应"), "{err}");
    }
}
