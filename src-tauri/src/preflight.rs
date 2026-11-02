use crate::git::PI_COMMIT_PROMPT;
use serde::{Deserialize, Serialize};
use std::process::{Command, Output, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

/// Non-interactive probe. Skips session, extensions, tools, and thinking so a
/// provider round-trip fits in PI_PROBE_TIMEOUT. Commit still uses full `pi --print`.
pub const PI_PROBE_PROMPT: &str = "只回复 OK，不要解释。";
pub const PI_PROBE_TIMEOUT: Duration = Duration::from_secs(12);

pub const CHECK_PI_PATH: &str = "pi_path";
pub const CHECK_PI_PRINT: &str = "pi_print";
pub const CHECK_GIT: &str = "git";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PreflightItem {
    pub id: String,
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PreflightResult {
    pub ready: bool,
    pub checks: Vec<PreflightItem>,
    pub summary: String,
}

pub fn check_environment() -> PreflightResult {
    debug_assert!(
        !PI_COMMIT_PROMPT.trim().is_empty(),
        "PI_COMMIT_PROMPT must be non-empty"
    );

    let pi_path = check_pi_in_path();
    let pi_print = if pi_path.ok {
        check_pi_print_probe()
    } else {
        PreflightItem {
            id: CHECK_PI_PRINT.to_string(),
            ok: false,
            message: "未检测：请先将 pi 安装并加入 PATH".to_string(),
        }
    };
    let git = check_git();

    build_result(vec![pi_path, pi_print, git])
}

pub fn build_result(checks: Vec<PreflightItem>) -> PreflightResult {
    let ready = aggregate_ready(&checks);
    let summary = if ready {
        "环境就绪".to_string()
    } else {
        build_failure_summary(&checks)
    };
    PreflightResult {
        ready,
        checks,
        summary,
    }
}

pub fn aggregate_ready(checks: &[PreflightItem]) -> bool {
    !checks.is_empty() && checks.iter().all(|c| c.ok)
}

pub fn build_failure_summary(checks: &[PreflightItem]) -> String {
    checks
        .iter()
        .find(|c| !c.ok)
        .map(|c| format!("{}：{}", check_label(&c.id), c.message))
        .unwrap_or_else(|| "环境未就绪".to_string())
}

fn check_label(id: &str) -> &'static str {
    match id {
        CHECK_PI_PATH => "pi 未找到",
        CHECK_PI_PRINT => "pi --print 不可用",
        CHECK_GIT => "git 不可用",
        _ => "环境检查失败",
    }
}

fn check_pi_in_path() -> PreflightItem {
    let lookup = if cfg!(target_os = "windows") {
        Command::new("where").arg("pi").output()
    } else {
        Command::new("sh")
            .args(["-lc", "command -v pi"])
            .output()
    };

    match lookup {
        Ok(output) if output.status.success() && !output.stdout.is_empty() => PreflightItem {
            id: CHECK_PI_PATH.to_string(),
            ok: true,
            message: "pi 已在 PATH 中".to_string(),
        },
        Ok(output) => {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
            PreflightItem {
                id: CHECK_PI_PATH.to_string(),
                ok: false,
                message: if detail.is_empty() {
                    "请安装 pi 并确保在终端可执行（PATH）".to_string()
                } else {
                    format!("请安装 pi 并加入 PATH（{detail}）")
                },
            }
        }
        Err(e) => PreflightItem {
            id: CHECK_PI_PATH.to_string(),
            ok: false,
            message: format!("无法检测 pi 是否在 PATH：{e}"),
        },
    }
}

fn check_pi_print_probe() -> PreflightItem {
    let mut cmd = Command::new("pi");
    cmd.args([
        "--no-session",
        "--no-extensions",
        "--no-mcp",
        "--no-skills",
        "--no-tools",
        "--thinking",
        "off",
        "--print",
        PI_PROBE_PROMPT,
    ])
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

    if let Ok(temp) = std::env::temp_dir().canonicalize() {
        cmd.current_dir(temp);
    }

    match run_with_timeout(cmd, PI_PROBE_TIMEOUT) {
        Ok(RunOutcome::Completed(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            if output.status.success() {
                PreflightItem {
                    id: CHECK_PI_PRINT.to_string(),
                    ok: true,
                    message: "pi --print 可非交互启动".to_string(),
                }
            } else {
                let detail = if stderr.trim().is_empty() {
                    stdout
                } else {
                    stderr
                };
                PreflightItem {
                    id: CHECK_PI_PRINT.to_string(),
                    ok: false,
                    message: if detail.trim().is_empty() {
                        format!(
                            "pi --print 退出码 {}",
                            output.status.code().unwrap_or(-1)
                        )
                    } else {
                        format!("pi --print 失败：{}", detail.trim())
                    },
                }
            }
        }
        Ok(RunOutcome::TimedOut) => PreflightItem {
            id: CHECK_PI_PRINT.to_string(),
            ok: false,
            message: format!(
                "pi --print 在 {} 秒内无响应，请检查 pi 配置或网络",
                PI_PROBE_TIMEOUT.as_secs()
            ),
        },
        Err(e) => PreflightItem {
            id: CHECK_PI_PRINT.to_string(),
            ok: false,
            message: format!("无法启动 pi --print：{e}"),
        },
    }
}

fn check_git() -> PreflightItem {
    match Command::new("git").arg("--version").output() {
        Ok(output) if output.status.success() => {
            let ver = String::from_utf8_lossy(&output.stdout)
                .trim()
                .to_string();
            PreflightItem {
                id: CHECK_GIT.to_string(),
                ok: true,
                message: if ver.is_empty() {
                    "git 可用".to_string()
                } else {
                    ver
                },
            }
        }
        Ok(output) => {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
            PreflightItem {
                id: CHECK_GIT.to_string(),
                ok: false,
                message: if detail.is_empty() {
                    "请安装 Xcode Command Line Tools 或 git".to_string()
                } else {
                    detail
                },
            }
        }
        Err(e) => PreflightItem {
            id: CHECK_GIT.to_string(),
            ok: false,
            message: format!("无法执行 git：{e}"),
        },
    }
}

enum RunOutcome {
    Completed(Output),
    TimedOut,
}

fn run_with_timeout(mut cmd: Command, timeout: Duration) -> Result<RunOutcome, String> {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }

    let child = cmd.spawn().map_err(|e| format!("spawn 失败: {e}"))?;
    let pid = child.id();
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let result = child.wait_with_output();
        let _ = tx.send(result);
    });

    match rx.recv_timeout(timeout) {
        Ok(Ok(output)) => Ok(RunOutcome::Completed(output)),
        Ok(Err(e)) => Err(format!("等待 pi 失败: {e}")),
        Err(mpsc::RecvTimeoutError::Timeout) => {
            kill_probe(pid);
            let _ = rx.recv_timeout(Duration::from_secs(2));
            Ok(RunOutcome::TimedOut)
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => Err("pi 探测线程异常退出".to_string()),
    }
}

fn kill_probe(pid: u32) {
    #[cfg(unix)]
    {
        let _ = Command::new("kill")
            .args(["-9", &format!("-{pid}")])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aggregate_ready_requires_all_ok() {
        let checks = vec![
            PreflightItem {
                id: CHECK_GIT.to_string(),
                ok: true,
                message: "ok".into(),
            },
            PreflightItem {
                id: CHECK_PI_PATH.to_string(),
                ok: false,
                message: "missing".into(),
            },
        ];
        assert!(!aggregate_ready(&checks));
        assert!(aggregate_ready(&[PreflightItem {
            id: CHECK_GIT.to_string(),
            ok: true,
            message: "x".into(),
        }]));
    }

    #[test]
    fn failure_summary_uses_first_failed_check() {
        let checks = vec![
            PreflightItem {
                id: CHECK_PI_PATH.to_string(),
                ok: false,
                message: "请安装 pi".into(),
            },
            PreflightItem {
                id: CHECK_GIT.to_string(),
                ok: false,
                message: "no git".into(),
            },
        ];
        let summary = build_failure_summary(&checks);
        assert!(summary.contains("pi 未找到"));
        assert!(summary.contains("请安装 pi"));
    }

    #[test]
    fn build_result_ready_summary() {
        let r = build_result(vec![PreflightItem {
            id: CHECK_GIT.to_string(),
            ok: true,
            message: "git version".into(),
        }]);
        assert!(r.ready);
        assert_eq!(r.summary, "环境就绪");
    }

    #[test]
    fn check_git_returns_structured_item() {
        let item = check_git();
        assert_eq!(item.id, CHECK_GIT);
        assert!(!item.message.is_empty());
    }

    #[test]
    fn builtin_commit_prompt_non_empty() {
        assert!(
            !PI_COMMIT_PROMPT.trim().is_empty(),
            "PI_COMMIT_PROMPT must ship non-empty"
        );
    }

    #[test]
    fn check_environment_returns_three_checks_in_order() {
        let result = check_environment();
        assert_eq!(result.checks.len(), 3);
        assert_eq!(result.checks[0].id, CHECK_PI_PATH);
        assert_eq!(result.checks[1].id, CHECK_PI_PRINT);
        assert_eq!(result.checks[2].id, CHECK_GIT);
        assert_eq!(result.ready, result.checks.iter().all(|c| c.ok));
        assert!(
            !result
                .checks
                .iter()
                .any(|c| c.id == "commit_prompt"),
            "commit_prompt must not appear in preflight UI list"
        );
    }
}
