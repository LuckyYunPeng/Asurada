//! 生成提交信息的提示词：Asurada 自己读好改动、按额度裁剪后交给 Agent，Agent 不碰仓库。
use crate::git::git_working_diff;
use std::path::Path;

const PROMPT_ZH: &str = "你是 Asurada 提交助手。根据下面的改动，写一条 Conventional Commits 格式的提交标题：type 用英文（如 feat、fix、chore、docs、refactor、style），冒号后用简体中文简述变更。只输出这一行，不要引号、不要解释、不要 Markdown。";
const PROMPT_EN: &str = "You are the Asurada commit assistant. Based on the changes below, write one Conventional Commits subject line: an English type (feat, fix, chore, docs, refactor, style, etc.), then a concise English description after the colon. Output only that one line: no quotes, no explanation, no Markdown.";

/// 全部文件内容的总额度；超出后剩下的文件只列文件名和增删行数
const TOTAL_BUDGET: usize = 100 * 1024;
/// 单个文件的额度：大文件只留开头，不让一个文件挤掉其他文件
const FILE_BUDGET: usize = 8 * 1024;

/// lock 文件、快照、自动生成和压缩后的文件：内容对写提交标题没帮助，只列文件名
fn is_noise(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    const NAMES: &[&str] = &[
        "package-lock.json",
        "pnpm-lock.yaml",
        "yarn.lock",
        "bun.lockb",
        "Cargo.lock",
        "Gemfile.lock",
        "poetry.lock",
        "composer.lock",
        "go.sum",
        "Podfile.lock",
        "uv.lock",
    ];
    NAMES.contains(&name)
        || name.ends_with(".snap")
        || name.ends_with(".min.js")
        || name.ends_with(".min.css")
        || name.ends_with(".map")
        || path.split('/').any(|dir| dir == "__snapshots__" || dir == "generated")
        || path.contains("/gen/schemas/")
}

struct FilePatch<'a> {
    path: String,
    text: &'a str,
    additions: usize,
    deletions: usize,
}

/// 按 `diff --git` 切成单个文件；文件名取 `+++ b/` 行，删除的文件取 `--- a/`
fn split_patch(patch: &str) -> Vec<FilePatch<'_>> {
    let mut starts: Vec<usize> = patch
        .match_indices("diff --git ")
        .map(|(i, _)| i)
        .filter(|&i| i == 0 || patch.as_bytes()[i - 1] == b'\n')
        .collect();
    starts.push(patch.len());
    starts
        .windows(2)
        .map(|w| {
            let text = &patch[w[0]..w[1]];
            let mut path = String::new();
            let (mut additions, mut deletions) = (0, 0);
            let mut is_body = false;
            for line in text.lines() {
                if line.starts_with("@@") {
                    is_body = true;
                } else if !is_body {
                    if let Some(p) = line.strip_prefix("+++ b/") {
                        path = p.to_string();
                    } else if let Some(p) = line.strip_prefix("--- a/") {
                        if path.is_empty() {
                            path = p.to_string();
                        }
                    } else if let Some(p) = line.strip_prefix("rename to ") {
                        path = p.to_string();
                    }
                } else if line.starts_with('+') {
                    additions += 1;
                } else if line.starts_with('-') {
                    deletions += 1;
                }
            }
            if path.is_empty() {
                // 二进制或纯改权限的文件没有 +++ 行，从首行取
                path = text
                    .lines()
                    .next()
                    .and_then(|l| l.rsplit(" b/").next())
                    .unwrap_or("")
                    .to_string();
            }
            FilePatch { path, text, additions, deletions }
        })
        .collect()
}

/// 截到 max 字节以内，落在完整的行上
fn truncate_lines(text: &str, max: usize) -> &str {
    if text.len() <= max {
        return text;
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    match text[..end].rfind('\n') {
        Some(i) => &text[..=i],
        None => &text[..end],
    }
}

/// 改动摘要：先列全部文件的增删统计，再按额度放入内容
fn build_changes(patch: &str, paths: Option<&[String]>) -> String {
    let files: Vec<FilePatch> = split_patch(patch)
        .into_iter()
        .filter(|f| paths.is_none_or(|ps| ps.contains(&f.path)))
        .collect();
    let mut out = String::from("## Files\n");
    for f in &files {
        out.push_str(&format!("{} | +{} -{}\n", f.path, f.additions, f.deletions));
    }
    out.push_str("\n## Diff\n");
    let mut used = 0;
    let mut skipped = Vec::new();
    for f in &files {
        if is_noise(&f.path) || used >= TOTAL_BUDGET {
            skipped.push(f.path.as_str());
            continue;
        }
        let body = truncate_lines(f.text, FILE_BUDGET.min(TOTAL_BUDGET - used));
        out.push_str(body);
        if body.len() < f.text.len() {
            let omitted = f.text[body.len()..].lines().count();
            out.push_str(&format!("… (omitted {omitted} more lines of {})\n", f.path));
        }
        used += body.len();
    }
    if !skipped.is_empty() {
        out.push_str(&format!(
            "\n(Content not shown for: {}; see the file list above.)\n",
            skipped.join(", ")
        ));
    }
    out
}

/// paths 有值时只描述这些文件（部分提交）
pub fn build(project_path: &Path, language: &str, paths: Option<&[String]>) -> Result<String, String> {
    let (patch, _) = git_working_diff(project_path)?;
    let prompt = if language == "zh" { PROMPT_ZH } else { PROMPT_EN };
    Ok(format!("{prompt}\n\n{}", build_changes(&patch, paths)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(path: &str, lines: usize) -> String {
        let mut s = format!(
            "diff --git a/{path} b/{path}\nindex 1..2 100644\n--- a/{path}\n+++ b/{path}\n@@ -1 +1,{lines} @@\n"
        );
        for i in 0..lines {
            s.push_str(&format!("+line {i} of {path} padding padding padding padding\n"));
        }
        s
    }

    #[test]
    fn small_diff_is_complete() {
        let patch = file("src/a.ts", 3) + &file("src/b.ts", 2);
        let out = build_changes(&patch, None);
        assert!(out.contains("src/a.ts | +3 -0"));
        assert!(out.contains("+line 2 of src/a.ts"));
        assert!(out.contains("+line 1 of src/b.ts"));
        assert!(!out.contains("omitted") && !out.contains("not shown"));
    }

    #[test]
    fn noise_and_big_files_are_trimmed() {
        let patch = file("pnpm-lock.yaml", 5000) + &file("src/big.rs", 2000) + &file("src/small.rs", 2);
        let out = build_changes(&patch, None);
        // lock 文件只列统计
        assert!(out.contains("pnpm-lock.yaml | +5000 -0"));
        assert!(!out.contains("+line 0 of pnpm-lock.yaml"));
        // 大文件只留开头，小文件不被挤掉
        assert!(out.contains("+line 0 of src/big.rs"));
        assert!(out.contains("omitted"));
        assert!(out.contains("+line 1 of src/small.rs"));
    }

    #[test]
    fn total_budget_caps_content() {
        let patch: String = (0..40).map(|i| file(&format!("src/f{i}.rs"), 200)).collect();
        assert!(patch.len() > 300 * 1024);
        let out = build_changes(&patch, None);
        assert!(out.len() < TOTAL_BUDGET + 8 * 1024, "{}", out.len());
        // 统计表永远完整
        assert!(out.contains("src/f39.rs | +200 -0"));
        assert!(out.contains("Content not shown for"));
    }

    #[test]
    fn partial_commit_only_includes_selected() {
        let patch = file("src/a.ts", 1) + &file("src/b.ts", 1);
        let out = build_changes(&patch, Some(&["src/b.ts".to_string()]));
        assert!(!out.contains("src/a.ts"));
        assert!(out.contains("src/b.ts | +1 -0"));
    }

    #[test]
    fn truncate_respects_char_boundary() {
        let text = "第一行\n第二行很长很长\n";
        let cut = truncate_lines(text, 14);
        assert_eq!(cut, "第一行\n");
    }

    #[test]
    fn deleted_and_renamed_paths() {
        let deleted = "diff --git a/old.ts b/old.ts\ndeleted file mode 100644\n--- a/old.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n";
        let renamed = "diff --git a/a.ts b/b.ts\nsimilarity index 100%\nrename from a.ts\nrename to b.ts\n";
        let patch = format!("{deleted}{renamed}");
        let files = split_patch(&patch);
        assert_eq!(files[0].path, "old.ts");
        assert_eq!(files[0].deletions, 1);
        assert_eq!(files[1].path, "b.ts");
    }
}
