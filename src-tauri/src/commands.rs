use crate::git::{
    git_add_commit_push, git_is_clean, git_last_commit_subject, git_working_diff, run_pi_print,
};
use crate::preflight::{self, PreflightResult};
use crate::store::{default_display_name, load_projects, save_projects, StoredProject};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectView {
    pub id: String,
    pub path: String,
    pub display_name: String,
    pub short_path: String,
    pub git_clean: bool,
    pub git_status_label: String,
    pub last_commit_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitPushResult {
    pub success: bool,
    pub commit_message: Option<String>,
    pub push_output: String,
    pub error: Option<String>,
}

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("无法解析应用数据目录: {e}"))
}

fn shorten_path(path: &str) -> String {
    let parts: Vec<&str> = path.split(['/', '\\']).filter(|p| !p.is_empty()).collect();
    if parts.len() <= 2 {
        return path.to_string();
    }
    let tail: Vec<&str> = parts[parts.len().saturating_sub(2)..].to_vec();
    format!("…/{}", tail.join("/"))
}

fn to_view(p: &StoredProject) -> ProjectView {
    let path = PathBuf::from(&p.path);
    let (git_clean, git_status_label, last_commit_message) = match git_is_clean(&path) {
        Ok(true) => (
            true,
            "工作区干净".to_string(),
            git_last_commit_subject(&path),
        ),
        Ok(false) => (false, "有未提交变更".to_string(), None),
        Err(e) => (true, format!("状态未知: {e}"), None),
    };

    ProjectView {
        id: p.id.clone(),
        path: p.path.clone(),
        display_name: p.display_name.clone(),
        short_path: shorten_path(&p.path),
        git_clean,
        git_status_label,
        last_commit_message,
    }
}

/// 重复添加时的错误前缀，后面跟已存在项目的 id；前端 App.tsx 按此识别并高亮那一行。
const DUPLICATE_PROJECT_PREFIX: &str = "DUPLICATE_PROJECT:";

/// 解析软链接、去掉末尾 `/`，让同一个目录的不同写法得到同一个路径。
/// 目录已不存在时无法解析，只去末尾 `/`。
fn normalize_path(path: &str) -> String {
    std::fs::canonicalize(path)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| path.trim_end_matches('/').to_string())
}

#[tauri::command]
pub async fn list_projects(app: tauri::AppHandle) -> Result<Vec<ProjectView>, String> {
    let dir = app_data_dir(&app)?;
    let projects = load_projects(&dir)?;
    Ok(projects.iter().map(to_view).collect())
}

#[tauri::command]
pub async fn add_project(app: tauri::AppHandle, path: String) -> Result<ProjectView, String> {
    let path = path.trim().to_string();
    if path.is_empty() {
        return Err("路径不能为空".to_string());
    }
    if !PathBuf::from(&path).is_dir() {
        return Err("路径不存在或不是文件夹".to_string());
    }

    let path = normalize_path(&path);
    let dir = app_data_dir(&app)?;
    let mut projects = load_projects(&dir)?;
    // 旧数据里的路径可能没规范化过，比较时两边都规范化
    if let Some(existing) = projects.iter().find(|p| normalize_path(&p.path) == path) {
        return Err(format!("{DUPLICATE_PROJECT_PREFIX}{}", existing.id));
    }

    let stored = StoredProject {
        id: Uuid::new_v4().to_string(),
        display_name: default_display_name(&path),
        path,
    };
    projects.push(stored.clone());
    save_projects(&dir, &projects)?;
    Ok(to_view(&stored))
}

#[tauri::command]
pub async fn remove_project(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let dir = app_data_dir(&app)?;
    let mut projects = load_projects(&dir)?;
    let len_before = projects.len();
    projects.retain(|p| p.id != id);
    if projects.len() == len_before {
        return Err("未找到该项目".to_string());
    }
    save_projects(&dir, &projects)
}

#[tauri::command]
pub async fn refresh_project_status(app: tauri::AppHandle, id: String) -> Result<ProjectView, String> {
    let dir = app_data_dir(&app)?;
    let projects = load_projects(&dir)?;
    let project = projects
        .iter()
        .find(|p| p.id == id)
        .ok_or_else(|| "未找到该项目".to_string())?;
    Ok(to_view(project))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDiff {
    pub display_name: String,
    pub path: String,
    pub patch: String,
    pub untracked: Vec<String>,
}

fn find_project(app: &tauri::AppHandle, id: &str) -> Result<StoredProject, String> {
    let dir = app_data_dir(app)?;
    load_projects(&dir)?
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| "未找到该项目".to_string())
}

#[tauri::command]
pub async fn get_project_diff(app: tauri::AppHandle, id: String) -> Result<ProjectDiff, String> {
    let project = find_project(&app, &id)?;
    let (patch, untracked) = git_working_diff(&PathBuf::from(&project.path))?;
    Ok(ProjectDiff {
        display_name: project.display_name,
        path: project.path,
        patch,
        untracked,
    })
}

/// 每个项目只开一个 diff 窗口，已开则带到前台。
#[tauri::command]
pub async fn open_diff_window(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let label = format!("diff-{id}");
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.unminimize();
        let _ = window.show();
        return window.set_focus().map_err(|e| format!("无法聚焦窗口: {e}"));
    }

    let project = find_project(&app, &id)?;
    let url = tauri::WebviewUrl::App(format!("index.html?view=diff&id={id}").into());
    let (width, height) = (1440.0, 900.0);
    let mut builder = tauri::WebviewWindowBuilder::new(&app, &label, url)
        .title(format!("{} 的变更", project.display_name))
        .inner_size(width, height)
        .min_inner_size(720.0, 480.0);
    // 放到面板所在的显示器（用户刚在那里点过）。.center() 只会放主显示器；
    // 也不用 cursor_position + monitor_from_point：tao 在 macOS 上按主屏缩放给物理坐标，
    // 而 monitor_from_point 按逻辑坐标匹配，Retina 主屏下会匹配到别的显示器
    let panel_monitor = app
        .get_webview_window("main")
        .and_then(|w| w.current_monitor().ok().flatten());
    if let Some(monitor) = panel_monitor {
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        let (x, y) = (area.position.x as f64 / scale, area.position.y as f64 / scale);
        let (w, h) = (area.size.width as f64 / scale, area.size.height as f64 / scale);
        builder = builder
            .inner_size(width.min(w - 40.0), height.min(h - 40.0))
            .position(x + ((w - width) / 2.0).max(20.0), y + ((h - height) / 2.0).max(20.0));
    } else {
        builder = builder.center();
    }
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        // 红绿灯对齐 DiffWindow.css 里 52px 高顶栏的中线（26px）。
        // y 不是按钮顶边：tao 把标题栏容器高度设为 16 + y，按钮离容器底部约 6px，
        // 实测 y=19 时按钮顶边在 13px，所以按钮顶边 18px（中心 26px）要用 y=24
        .traffic_light_position(tauri::LogicalPosition::new(18.0, 24.0));
    builder
        .build()
        .map(|_| ())
        .map_err(|e| format!("无法打开 diff 窗口: {e}"))
}

#[tauri::command]
pub async fn check_environment() -> PreflightResult {
    preflight::check_environment()
}

#[tauri::command]
pub async fn preflight() -> PreflightResult {
    preflight::check_environment()
}

#[tauri::command]
pub async fn run_commit_push(app: tauri::AppHandle, id: String) -> Result<CommitPushResult, String> {
    let dir = app_data_dir(&app)?;
    let projects = load_projects(&dir)?;
    let project = projects
        .iter()
        .find(|p| p.id == id)
        .ok_or_else(|| "未找到该项目".to_string())?;

    let path = PathBuf::from(&project.path);
    if git_is_clean(&path)? {
        return Ok(CommitPushResult {
            success: false,
            commit_message: None,
            push_output: String::new(),
            error: Some("无变更".to_string()),
        });
    }

    let commit_message = run_pi_print(&path)?;
    let push_output = git_add_commit_push(&path, &commit_message)?;

    Ok(CommitPushResult {
        success: true,
        commit_message: Some(commit_message),
        push_output,
        error: None,
    })
}
