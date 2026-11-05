use std::path::Path;
use std::process::Command;

/// `pi --print` 的提示词，按设置里的语言选；中文版也是预检的基准提示词
pub const PI_COMMIT_PROMPT: &str = r#"你是 Asurada 提交助手。请根据当前仓库的 git status 与 git diff（含已暂存与未暂存）生成一条 Conventional Commits 格式的提交标题：type 使用英文（如 feat、fix、chore、docs），冒号后使用简体中文简述变更。只输出一行提交信息，不要引号、不要解释、不要 Markdown。"#;
const PI_COMMIT_PROMPT_EN: &str = r#"You are the Asurada commit assistant. Based on the current repository's git status and git diff (staged and unstaged), write one Conventional Commits subject line: an English type (feat, fix, chore, docs, etc.), then a concise English description of the change after the colon. Output only that one line: no quotes, no explanation, no Markdown."#;

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

/// language 是前端当前生效的语言："zh" 用中文提交信息，其他一律英文
pub fn run_pi_print(project_path: &Path, language: &str) -> Result<String, String> {
    let prompt = if language == "zh" { PI_COMMIT_PROMPT } else { PI_COMMIT_PROMPT_EN };
    let output = Command::new("pi")
        .args(["--no-session", "--print", prompt])
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

fn git_output(project_path: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    Command::new("git")
        .args(["-c", "core.quotepath=off"])
        .args(args)
        .current_dir(project_path)
        .output()
        .map_err(|e| format!("无法执行 git: {e}"))
}

/// 工作区相对 HEAD 的完整 patch（即一键提交会带上的内容），含未跟踪文件；同时返回未跟踪文件列表。
pub fn git_working_diff(project_path: &Path) -> Result<(String, Vec<String>), String> {
    // 空仓库没有 HEAD，和空树比
    let has_head = git_output(project_path, &["rev-parse", "-q", "--verify", "HEAD"])?
        .status
        .success();
    let base = if has_head { "HEAD" } else { "4b825dc642cb6eb9a060e54bf8d69288fbee4904" };

    let tracked = git_output(project_path, &["diff", "--no-color", "--no-ext-diff", base])?;
    if !tracked.status.success() {
        return Err(format!(
            "git diff 失败: {}",
            String::from_utf8_lossy(&tracked.stderr).trim()
        ));
    }
    let mut patch = String::from_utf8_lossy(&tracked.stdout).into_owned();

    let untracked = git_output(
        project_path,
        &["ls-files", "--others", "--exclude-standard", "-z"],
    )?;
    let untracked: Vec<String> = String::from_utf8_lossy(&untracked.stdout)
        .split('\0')
        .filter(|f| !f.is_empty())
        .map(str::to_string)
        .collect();
    for file in &untracked {
        // --no-index 有差异时退出码为 1，属正常
        let out = git_output(
            project_path,
            &["diff", "--no-color", "--no-ext-diff", "--no-index", "--", "/dev/null", file],
        )?;
        patch.push_str(&String::from_utf8_lossy(&out.stdout));
    }
    Ok((patch, untracked))
}

/// 只做 fast-forward：未提交的改动原样保留；会覆盖本地改动或与本地提交分叉时 git 直接拒绝，不留冲突
pub fn git_pull(project_path: &Path) -> Result<String, String> {
    let output = git_output(project_path, &["pull", "--ff-only"])?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        return Err(if stderr.is_empty() { stdout } else { stderr });
    }
    Ok(stdout)
}

pub fn git_add_commit_push(project_path: &Path, message: &str) -> Result<String, String> {
    // 只有远端有新提交导致的拒绝才 rebase 后重推；权限、hook 等其他拒绝直接报错，避免同一错误输出两遍。
    // rebase 冲突则撤回，保持本地提交不变
    let script = format!(
        r#"git add -A && git commit -m {} || exit 1
if out=$(git push 2>&1); then echo "$out" >&2; exit 0; fi
case "$out" in
  *"fetch first"*|*non-fast-forward*) ;;
  *) echo "$out" >&2; exit 1 ;;
esac
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
    fn working_diff_includes_modified_and_untracked() {
        let (root, a) = setup("diff", "b.txt");
        fs::write(a.join("base.txt"), "changed").unwrap();
        fs::create_dir_all(a.join("新目录")).unwrap();
        fs::write(a.join("新目录/笔记.md"), "hi\n").unwrap();
        let (patch, untracked) = git_working_diff(&a).unwrap();
        assert_eq!(untracked, vec!["新目录/笔记.md".to_string()]);
        assert!(patch.contains("diff --git a/base.txt b/base.txt"), "{patch}");
        assert!(patch.contains("+changed"), "{patch}");
        assert!(patch.contains("b/新目录/笔记.md"), "{patch}");
        assert!(patch.contains("+hi"), "{patch}");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn push_rejected_then_rebase_and_retry() {
        let (root, a) = setup("retry", "b.txt");
        fs::write(a.join("a.txt"), "from a").unwrap();
        assert!(git_add_commit_push(&a, "a").is_ok());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn other_push_rejection_is_reported_once() {
        let (root, a) = setup("hook", "b.txt");
        let hook = root.join("remote.git/hooks/pre-receive");
        fs::write(&hook, "#!/bin/sh\necho denied-by-hook >&2\nexit 1\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
        }
        // 先让本地追上远端，push 被拒只会是 hook 的原因
        git(&a, &["pull", "-q", "--rebase"]);
        fs::write(a.join("a.txt"), "from a").unwrap();
        let err = git_add_commit_push(&a, "a").unwrap_err();
        assert_eq!(err.matches("denied-by-hook").count(), 1, "{err}");
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
