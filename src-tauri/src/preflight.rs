use crate::git::PI_COMMIT_PROMPT;
use serde::{Deserialize, Serialize};
use std::process::{Command, Output, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

/// Short probe for `pi --print` (not the commit prompt).
pub const PI_PROBE_PROMPT: &str = "只回复 OK，不要解释。";
pub const PI_PROBE_TIMEOUT: Duration = Duration::from_secs(12);

pub const CHECK_PI_PRINT: &str = "pi_print";
pub const CHECK_GIT: &str = "git";
pub const CHECK_COMMIT_PROMPT: &str = "commit_prompt";

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
    let checks = vec![
        check_pi_print(),
        check_git(),
        check_commit_prompt(),
    ];
    build_result(checks)
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
        CHECK_PI_PRINT => "pi --print 不可用",
        CHECK_GIT => "git 不可用",
        CHECK_COMMIT_PROMPT => "提交提示词不可用",
        _ => "环境检查失败",
    }
}

fn pi_in_path() -> Result<(), String> {
    let lookup = if cfg!(target_os = "windows") {
        Command::new("where").arg("pi").output()
    } else {
        Command::new("sh")
            .args(["-lc", "command -v pi"])
            .output()
    };

    match lookup {
        Ok(output) if output.status.success() && !output.stdout.is_empty() => Ok(()),
        Ok(output) => {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
            Err(if detail.is_empty() {
                "请安装 pi 并确保在终端可执行（PATH）".to_string()
            } else {
                format!("请安装 pi 并加入 PATH（{detail}）")
            })
        }
        Err(e) => Err(format!("无法检测 pi 是否在 PATH：{e}")),
    }
}

fn check_pi_print() -> PreflightItem {
    if let Err(reason) = pi_in_path() {
        return PreflightItem {
            id: CHECK_PI_PRINT.to_string(),
            ok: false,
            message: reason,
        };
    }

    let mut cmd = Command::new("pi");
    cmd.args(["--print", PI_PROBE_PROMPT])
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
                    message: "pi 在 PATH 中，pi --print 可非交互启动".to_string(),
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

pub fn check_commit_prompt() -> PreflightItem {
    let trimmed = PI_COMMIT_PROMPT.trim();
    if trimmed.is_empty() {
        return PreflightItem {
            id: CHECK_COMMIT_PROMPT.to_string(),
            ok: false,
            message: "内置提交提示词为空，请检查应用配置".to_string(),
        };
    }

    PreflightItem {
        id: CHECK_COMMIT_PROMPT.to_string(),
        ok: true,
        message: format!(
            "固化提交提示词已加载（{} 字）",
            trimmed.chars().count()
        ),
    }
}

enum RunOutcome {
    Completed(Output),
    TimedOut,
}

fn run_with_timeout(mut cmd: Command, timeout: Duration) -> Result<RunOutcome, String> {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let result = cmd.output();
        let _ = tx.send(result);
    });

    match rx.recv_timeout(timeout) {
        Ok(Ok(output)) => Ok(RunOutcome::Completed(output)),
        Ok(Err(e)) => Err(format!("spawn 失败: {e}")),
        Err(mpsc::RecvTimeoutError::Timeout) => Ok(RunOutcome::TimedOut),
        Err(mpsc::RecvTimeoutError::Disconnected) => Err("pi 探测线程异常退出".to_string()),
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
                id: CHECK_PI_PRINT.to_string(),
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
                id: CHECK_PI_PRINT.to_string(),
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
        assert!(summary.contains("pi --print 不可用"));
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
    fn check_commit_prompt_is_non_empty() {
        let item = check_commit_prompt();
        assert_eq!(item.id, CHECK_COMMIT_PROMPT);
        assert!(item.ok);
        assert!(item.message.contains("固化提交提示词"));
    }

    #[test]
    fn check_environment_returns_three_checks_in_order() {
        let result = check_environment();
        assert_eq!(result.checks.len(), 3);
        assert_eq!(result.checks[0].id, CHECK_PI_PRINT);
        assert_eq!(result.checks[1].id, CHECK_GIT);
        assert_eq!(result.checks[2].id, CHECK_COMMIT_PROMPT);
        assert_eq!(result.ready, result.checks.iter().all(|c| c.ok));
    }
}
