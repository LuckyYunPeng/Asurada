use crate::agents::{self, AgentSpec};
use serde::{Deserialize, Serialize};
use std::process::Command;

pub const CHECK_AGENT: &str = "agent";
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

/// saved 是设置里选的 Agent id；没选过或已卸载时按默认优先级自动选
pub fn check_environment(saved: Option<&str>) -> PreflightResult {
    build_result(vec![check_agent(agents::resolve(saved)), check_git()])
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
        CHECK_AGENT => "AI Agent 不可用",
        CHECK_GIT => "git 不可用",
        _ => "环境检查失败",
    }
}

/// 真的调用一次：装了但没登录、额度用完这类问题在这里暴露，而不是等到提交时
fn check_agent(spec: Option<&AgentSpec>) -> PreflightItem {
    let Some(spec) = spec else {
        return PreflightItem {
            id: CHECK_AGENT.to_string(),
            ok: false,
            message: "没有检测到可用的 AI Agent，请安装 pi、Claude Code、Codex 等任意一个".to_string(),
        };
    };
    match agents::run_agent(spec, agents::PROBE_PROMPT, agents::PROBE_TIMEOUT) {
        Ok(_) => PreflightItem {
            id: CHECK_AGENT.to_string(),
            ok: true,
            message: spec.name.to_string(),
        },
        Err(e) => PreflightItem {
            id: CHECK_AGENT.to_string(),
            ok: false,
            message: e,
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
                id: CHECK_AGENT.to_string(),
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
                id: CHECK_AGENT.to_string(),
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
        assert!(summary.contains("AI Agent 不可用"));
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
}
