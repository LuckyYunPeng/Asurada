use crate::git::{git_add_commit_push, git_is_clean, run_pi_print};
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
    let (git_clean, git_status_label) = match git_is_clean(&path) {
        Ok(true) => (true, "工作区干净".to_string()),
        Ok(false) => (false, "有未提交变更".to_string()),
        Err(e) => (true, format!("状态未知: {e}")),
    };

    ProjectView {
        id: p.id.clone(),
        path: p.path.clone(),
        display_name: p.display_name.clone(),
        short_path: shorten_path(&p.path),
        git_clean,
        git_status_label,
    }
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

    let dir = app_data_dir(&app)?;
    let mut projects = load_projects(&dir)?;
    if projects.iter().any(|p| p.path == path) {
        return Err("该项目已在列表中".to_string());
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
