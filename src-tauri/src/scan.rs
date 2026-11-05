//! 在一个目录下找 git 仓库，用于批量添加项目。
use std::fs;
use std::path::{Path, PathBuf};

/// 往下最多找几层：~/code/org/repo 这种结构够用，也不会扫到整个磁盘
const MAX_DEPTH: usize = 4;
/// 访问目录数上限，防止选了 ~ 这类巨大目录时卡住
const MAX_DIRS: usize = 20_000;
/// 依赖、构建产物等目录里不会有用户自己的项目
const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    "vendor",
    "Pods",
    "DerivedData",
    "Library",
    "Applications",
];

/// 返回按路径排序的仓库根目录。找到仓库后不再进入它内部（子模块、嵌套仓库不单独列出）。
/// 隐藏目录和软链接不进入；读不了的目录直接跳过
pub fn find_git_repos(root: &Path) -> Vec<PathBuf> {
    let mut repos = Vec::new();
    let mut stack = vec![(root.to_path_buf(), 0)];
    let mut visited = 0;
    while let Some((dir, depth)) = stack.pop() {
        visited += 1;
        if visited > MAX_DIRS {
            break;
        }
        // .git 可能是目录（普通仓库）或文件（worktree、子模块）
        if dir.join(".git").exists() {
            repos.push(dir);
            continue;
        }
        if depth >= MAX_DEPTH {
            continue;
        }
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            let is_dir = entry.file_type().is_ok_and(|t| t.is_dir());
            if is_dir && !name.starts_with('.') && !SKIP_DIRS.contains(&name.as_ref()) {
                stack.push((entry.path(), depth + 1));
            }
        }
    }
    repos.sort();
    repos
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_repos_and_skips_noise() {
        let root = std::env::temp_dir().join(format!("asurada-scan-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        for dir in [
            "a/.git",
            "group/b/.git",
            "group/b/inner/.git",       // 仓库内部不再找
            "node_modules/pkg/.git",    // 依赖目录跳过
            ".hidden/c/.git",           // 隐藏目录跳过
            "x/y/z/w/too-deep/.git",    // 超过深度
            "plain/folder",
        ] {
            fs::create_dir_all(root.join(dir)).unwrap();
        }
        fs::create_dir_all(root.join("wt")).unwrap();
        fs::write(root.join("wt/.git"), "gitdir: /elsewhere").unwrap(); // worktree 的 .git 是文件

        let found: Vec<String> = find_git_repos(&root)
            .iter()
            .map(|p| p.strip_prefix(&root).unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(found, vec!["a", "group/b", "wt"]);

        // 选中的目录本身就是仓库
        assert_eq!(find_git_repos(&root.join("a")), vec![root.join("a")]);
        fs::remove_dir_all(root).unwrap();
    }
}
