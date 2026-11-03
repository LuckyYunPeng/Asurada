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

pub fn git_last_commit_subject(project_path: &Path) -> Option<String> {
    let output = Command::new("git")
        .args([
            "-C",
            project_path.to_string_lossy().as_ref(),
            "log",
            "-1",
            "--format=%s",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let subject = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if subject.is_empty() {
        None
    } else {
        Some(subject)
    }
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
    // push 被拒（远端有更新）时先 rebase 再推一次；rebase 冲突则撤回，保持本地提交不变
    let script = format!(
        r#"git add -A && git commit -m {} || exit 1
git push && exit 0
if ! git pull --rebase; then
  if git rev-parse -q --verify REBASE_HEAD >/dev/null; then
    git rebase --abort
    echo "远端有更新且与本地冲突，已取消 rebase，请手动处理" >&2
  fi
  exit 1
fi
git push"#,
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn git(dir: &Path, args: &[&str]) {
        let ok = Command::new("git")
            .args(args)
            .current_dir(dir)
            .output()
            .unwrap()
            .status
            .success();
        assert!(ok, "git {args:?} failed");
    }

    /// 建一个裸仓库和两个克隆，让 b 先推一个提交，a 的普通 push 会被拒
    fn setup(name: &str, b_file: &str) -> (PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!("asurada-git-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        git(&root, &["init", "--bare", "-q", "-b", "main", "remote.git"]);
        for c in ["a", "b"] {
            git(&root, &["clone", "-q", "remote.git", c]);
            let d = root.join(c);
            git(&d, &["config", "user.email", "t@t"]);
            git(&d, &["config", "user.name", "t"]);
            git(&d, &["checkout", "-q", "-b", "main"]);
        }
        let a = root.join("a");
        let b = root.join("b");
        fs::write(a.join("base.txt"), "base").unwrap();
        git(&a, &["add", "-A"]);
        git(&a, &["commit", "-qm", "base"]);
        git(&a, &["push", "-q", "-u", "origin", "main"]);
        git(&b, &["pull", "-q", "origin", "main"]);
        git(&b, &["branch", "-q", "--set-upstream-to=origin/main"]);
        fs::write(b.join(b_file), "from b").unwrap();
        git(&b, &["add", "-A"]);
        git(&b, &["commit", "-qm", "b"]);
        git(&b, &["push", "-q"]);
        (root, a)
    }

    #[test]
    fn push_rejected_then_rebase_and_retry() {
        let (root, a) = setup("retry", "b.txt");
        fs::write(a.join("a.txt"), "from a").unwrap();
        assert!(git_add_commit_push(&a, "a").is_ok());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rebase_conflict_is_aborted() {
        let (root, a) = setup("conflict", "base.txt");
        fs::write(a.join("base.txt"), "from a").unwrap();
        let err = git_add_commit_push(&a, "a").unwrap_err();
        assert!(err.contains("已取消 rebase"), "{err}");
        assert!(!a.join(".git/rebase-merge").exists());
        fs::remove_dir_all(root).unwrap();
    }
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
