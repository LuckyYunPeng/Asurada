use std::path::Path;
use std::process::Command;

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

fn git_output(project_path: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    Command::new("git")
        .args(["-c", "core.quotepath=off"])
        .args(args)
        // 文件名按字面匹配，不把 * ? [ 当通配符
        .env("GIT_LITERAL_PATHSPECS", "1")
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

/// 把这些文件恢复到 HEAD：已跟踪的（含暂存的新文件、重命名两端）用 restore，未跟踪的直接删除。不可撤销
pub fn git_discard(project_path: &Path, paths: &[String]) -> Result<(), String> {
    let run = |args: Vec<&str>| -> Result<std::process::Output, String> {
        let out = git_output(project_path, &args)?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        Ok(out)
    };
    let mut args = vec!["ls-files", "--others", "--exclude-standard", "-z", "--"];
    args.extend(paths.iter().map(String::as_str));
    let out = run(args)?;
    let untracked: Vec<String> = String::from_utf8_lossy(&out.stdout)
        .split('\0')
        .filter(|f| !f.is_empty())
        .map(str::to_string)
        .collect();
    let tracked: Vec<&str> = paths
        .iter()
        .filter(|p| !untracked.contains(p))
        .map(String::as_str)
        .collect();
    if !tracked.is_empty() {
        let mut args = vec!["restore", "--source=HEAD", "--staged", "--worktree", "--"];
        args.extend(tracked);
        run(args)?;
    }
    if !untracked.is_empty() {
        let mut args = vec!["clean", "-f", "-q", "--"];
        args.extend(untracked.iter().map(String::as_str));
        run(args)?;
    }
    Ok(())
}

/// paths 为 None 时提交全部改动；有值时只提交这些路径（重命名要带上新旧两个），其余改动留在工作区
pub fn git_add_commit_push(
    project_path: &Path,
    message: &str,
    paths: Option<&[String]>,
) -> Result<String, String> {
    let commit = match paths {
        None => format!("git add -A && git commit -m {}", shell_escape(message)),
        Some(paths) => {
            let list = paths.iter().map(|p| shell_escape(p)).collect::<Vec<_>>().join(" ");
            // 先 reset：git mv 过的旧路径已不在索引里，直接 add 会报 pathspec 不匹配。
            // commit -- 路径只提交这些文件，用户自己暂存的其他改动不会被带上
            format!(
                "export GIT_LITERAL_PATHSPECS=1\ngit reset -q -- {list} && git add -A -- {list} && git commit -m {} -- {list}",
                shell_escape(message)
            )
        }
    };
    // 只有远端有新提交导致的拒绝才 rebase 后重推；权限、hook 等其他拒绝直接报错，避免同一错误输出两遍。
    // rebase 冲突则撤回，保持本地提交不变；--autostash 让没提交的改动不挡 rebase
    let script = format!(
        r#"{commit} || exit 1
if out=$(git push 2>&1); then echo "$out" >&2; exit 0; fi
case "$out" in
  *"fetch first"*|*non-fast-forward*) ;;
  *) echo "$out" >&2; exit 1 ;;
esac
if ! git pull --rebase --autostash; then
  if git rev-parse -q --verify REBASE_HEAD >/dev/null; then
    git rebase --abort
    echo "远端有更新且与本地冲突，已取消 rebase，请手动处理" >&2
  fi
  exit 1
fi
git push"#
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
        assert!(git_add_commit_push(&a, "a", None).is_ok());
        fs::remove_dir_all(root).unwrap();
    }

    fn status(dir: &Path) -> String {
        let out = Command::new("git").args(["status", "--porcelain"]).current_dir(dir).output().unwrap();
        String::from_utf8_lossy(&out.stdout).into_owned()
    }

    #[test]
    fn partial_commit_keeps_unselected_after_rebase_retry() {
        let (root, a) = setup("partial", "b.txt");
        fs::write(a.join("base.txt"), "changed").unwrap();
        fs::write(a.join("keep [1].txt"), "keep").unwrap();
        fs::write(a.join("pick [1].txt"), "pick").unwrap();
        let paths = vec!["pick [1].txt".to_string()];
        // b 已推了新提交，这里会走 rebase 重推；未选中的 base.txt 修改不能挡住 rebase
        git_add_commit_push(&a, "a", Some(&paths)).unwrap();
        assert_eq!(status(&a), " M base.txt\n?? \"keep [1].txt\"\n");
        let out = Command::new("git").args(["show", "--name-only", "--format=", "HEAD"]).current_dir(&a).output().unwrap();
        assert_eq!(String::from_utf8_lossy(&out.stdout), "pick [1].txt\n");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn partial_commit_rename() {
        let (root, a) = setup("rename", "b.txt");
        git(&a, &["pull", "-q", "--rebase"]);
        git(&a, &["mv", "base.txt", "moved.txt"]);
        fs::write(a.join("other.txt"), "x").unwrap();
        let paths = vec!["moved.txt".to_string(), "base.txt".to_string()];
        git_add_commit_push(&a, "mv", Some(&paths)).unwrap();
        assert_eq!(status(&a), "?? other.txt\n");
        assert!(a.join("moved.txt").exists() && !a.join("base.txt").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn discard_restores_tracked_and_removes_untracked() {
        let (root, a) = setup("discard", "b.txt");
        git(&a, &["pull", "-q", "--rebase"]);
        fs::write(a.join("base.txt"), "changed").unwrap();
        fs::remove_file(a.join("b.txt")).unwrap();
        fs::write(a.join("staged.txt"), "s").unwrap();
        git(&a, &["add", "staged.txt"]);
        fs::write(a.join("new.txt"), "n").unwrap();
        fs::write(a.join("keep.txt"), "k").unwrap();
        let paths: Vec<String> = ["base.txt", "b.txt", "staged.txt", "new.txt"].map(String::from).to_vec();
        git_discard(&a, &paths).unwrap();
        assert_eq!(status(&a), "?? keep.txt\n");
        assert_eq!(fs::read_to_string(a.join("base.txt")).unwrap(), "base");
        assert!(a.join("b.txt").exists() && !a.join("staged.txt").exists() && !a.join("new.txt").exists());
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
        let err = git_add_commit_push(&a, "a", None).unwrap_err();
        assert_eq!(err.matches("denied-by-hook").count(), 1, "{err}");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rebase_conflict_is_aborted() {
        let (root, a) = setup("conflict", "base.txt");
        fs::write(a.join("base.txt"), "from a").unwrap();
        let err = git_add_commit_push(&a, "a", None).unwrap_err();
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
