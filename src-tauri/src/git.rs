use std::path::Path;
use std::process::Command;

/// Fixed prompt for `pi --print` (configurable later). Documented in README.
pub const PI_COMMIT_PROMPT: &str = r#"你是 Asurada 提交助手。请根据当前仓库的 git status 与 git diff（含已暂存与未暂存）生成一条 Conventional Commits 格式的提交标题：type 使用英文（如 feat、fix、chore、docs），冒号后使用简体中文简述变更。只输出一行提交信息，不要引号、不要解释、不要 Markdown。"#;

pub fn git_is_clean(project_path: &Path) -> Result<bool, String> {
    let output = Command::new("git")
        .args(["-C", project_path.to_string_lossy().as_ref(), "status", "--porcelain"])
        .output()
        .map_err(|e| format!("无法执行 git: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git status 失败: {stderr}"));
    }

    Ok(output.stdout.is_empty())
}

pub fn run_pi_print(project_path: &Path) -> Result<String, String> {
    let output = Command::new("pi")
        .args(["--no-session", "--print", PI_COMMIT_PROMPT])
        .current_dir(project_path)
        .output()
        .map_err(|e| format!("无法执行 pi（请确认已安装并在 PATH 中）: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        return Err(if stderr.is_empty() {
            format!("pi 退出码 {}", output.status.code().unwrap_or(-1))
        } else {
            stderr
        });
    }

    if stdout.is_empty() {
        return Err("pi 未返回提交信息".to_string());
    }

    Ok(stdout.lines().next().unwrap_or(&stdout).trim().to_string())
}

pub fn git_add_commit_push(project_path: &Path, message: &str) -> Result<String, String> {
    let script = format!(
        "git add -A && git commit -m {} && git push",
        shell_escape(message)
    );

    let output = Command::new("sh")
        .args(["-c", &script])
        .current_dir(project_path)
        .output()
        .map_err(|e| format!("无法执行 git 流程: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        let detail = if stderr.is_empty() { &stdout } else { &stderr };
        return Err(detail.trim().to_string());
    }

    Ok(format!("{}{}", stdout, stderr).trim().to_string())
}

fn shell_escape(s: &str) -> String {
    let mut out = String::from("'");
    for c in s.chars() {
        if c == '\'' {
            out.push_str("'\\''");
        } else {
            out.push(c);
        }
    }
    out.push('\'');
    out
}
