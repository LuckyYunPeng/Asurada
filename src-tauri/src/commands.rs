use crate::git::{
    git_add_commit_push, git_discard, git_is_clean, git_pull, git_last_commit_subject, git_working_diff, run_pi_print,
};
use crate::preflight::{self, PreflightResult};
use crate::settings::{load_diff_window_size, save_diff_window_size, MIN_DIFF_WINDOW_SIZE};
use crate::store::{default_display_name, load_projects, save_projects, StoredProject};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager};
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

pub const DIFF_WINDOW_LABEL: &str = "diff";

/// 当前 diff 窗口显示的项目。窗口还在加载时收不到 diff-open 事件，加载完靠它补上
static DIFF_PROJECT_ID: Mutex<Option<String>> = Mutex::new(None);

/// 程序改窗口尺寸时记下目标值，Resized 回调据此跳过，只保存用户拖出来的尺寸
static PROGRAMMATIC_DIFF_SIZE: Mutex<(f64, f64)> = Mutex::new((0.0, 0.0));

/// 全局只有一个 diff 窗口：启动时建好并隐藏待命（WebView、高亮器、worker 都提前加载），
/// 打开时只切换项目再显示；关闭只是隐藏
pub fn build_diff_window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    let url = tauri::WebviewUrl::App("index.html?view=diff".into());
    let (width, height) = load_diff_window_size(&app_data_dir(app)?);
    *PROGRAMMATIC_DIFF_SIZE.lock().unwrap_or_else(|e| e.into_inner()) = (width, height);
    let builder = tauri::WebviewWindowBuilder::new(app, DIFF_WINDOW_LABEL, url)
        .title("变更")
        .inner_size(width, height)
        .min_inner_size(MIN_DIFF_WINDOW_SIZE.0, MIN_DIFF_WINDOW_SIZE.1)
        .visible(false);
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(
            TRAFFIC_LIGHT_INSET.0,
            TRAFFIC_LIGHT_INSET.1,
        ));
    let window = builder
        .build()
        .map_err(|e| format!("无法创建 diff 窗口: {e}"))?;
    remember_diff_window_size(app, &window);
    let win = window.clone();
    window.on_window_event(move |event| {
        #[cfg(target_os = "macos")]
        if matches!(event, tauri::WindowEvent::Focused(true) | tauri::WindowEvent::Resized(_)) {
            inset_traffic_lights(&win);
        }
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            if let Err(e) = win.hide() {
                eprintln!("Asurada: 隐藏 diff 窗口失败 ({e})");
            }
            *DIFF_PROJECT_ID.lock().unwrap_or_else(|e| e.into_inner()) = None;
            let _ = win.emit_to(DIFF_WINDOW_LABEL, "diff-hidden", ());
        }
    });
    Ok(window)
}

/// 红绿灯对齐 DiffWindow.css 里 52px 高顶栏的中线（26px）。
/// y 不是按钮顶边：标题栏容器高度设为按钮高 + y，按钮离容器底部约 6px，
/// 实测 y=19 时按钮顶边在 13px，所以按钮顶边 18px（中心 26px）要用 y=24
#[cfg(target_os = "macos")]
const TRAFFIC_LIGHT_INSET: (f64, f64) = (18.0, 24.0);

/// 手动摆红绿灯。tao 只在自己的 view 重绘、改标题时套用 traffic_light_position，
/// 而 view 被 WebView 盖住几乎不重绘；隐藏创建的窗口显示、获得焦点、改尺寸时 AppKit 又会把按钮摆回默认位置。
/// 算法与 tao 的 inset_traffic_lights 相同
#[cfg(target_os = "macos")]
fn inset_traffic_lights(window: &tauri::WebviewWindow) {
    use objc2_app_kit::{NSWindow, NSWindowButton};

    let win = window.clone();
    let result = window.run_on_main_thread(move || {
        let Ok(ptr) = win.ns_window() else {
            return;
        };
        let ns_window = unsafe { &*ptr.cast::<NSWindow>() };
        let (Some(close), Some(mini), Some(zoom)) = (
            ns_window.standardWindowButton(NSWindowButton::CloseButton),
            ns_window.standardWindowButton(NSWindowButton::MiniaturizeButton),
            ns_window.standardWindowButton(NSWindowButton::ZoomButton),
        ) else {
            return;
        };
        let Some(container) = (unsafe { close.superview() }).and_then(|v| unsafe { v.superview() })
        else {
            return;
        };
        // 先让标题栏把系统的那次布局做完（显示窗口、改标题都会排一次），否则摆好的位置会在下一轮布局里被冲掉
        if let Some(theme_frame) = unsafe { container.superview() } {
            theme_frame.layoutSubtreeIfNeeded();
        }
        let close_rect = close.frame();
        let height = close_rect.size.height + TRAFFIC_LIGHT_INSET.1;
        let mut container_rect = container.frame();
        container_rect.size.height = height;
        container_rect.origin.y = ns_window.frame().size.height - height;
        container.setFrame(container_rect);
        let spacing = mini.frame().origin.x - close_rect.origin.x;
        for (i, button) in [close, mini, zoom].iter().enumerate() {
            let mut origin = button.frame().origin;
            origin.x = TRAFFIC_LIGHT_INSET.0 + i as f64 * spacing;
            button.setFrameOrigin(origin);
        }
    });
    if let Err(e) = result {
        eprintln!("Asurada: 调整红绿灯位置失败 ({e})");
    }
}

/// 放到面板所在的显示器（用户刚在那里点过）并居中，屏幕放不下时只缩显示尺寸，不改用户保存的尺寸。
/// 不用 cursor_position + monitor_from_point：tao 在 macOS 上按主屏缩放给物理坐标，
/// 而 monitor_from_point 按逻辑坐标匹配，Retina 主屏下会匹配到别的显示器
fn place_diff_window(app: &tauri::AppHandle, window: &tauri::WebviewWindow) -> Result<(), String> {
    let (width, height) = load_diff_window_size(&app_data_dir(app)?);
    let Some(monitor) = app
        .get_webview_window("main")
        .and_then(|w| w.current_monitor().ok().flatten())
    else {
        return window.center().map_err(|e| format!("无法居中 diff 窗口: {e}"));
    };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let (x, y) = (area.position.x as f64 / scale, area.position.y as f64 / scale);
    let (w, h) = (area.size.width as f64 / scale, area.size.height as f64 / scale);
    let (fit_w, fit_h) = (width.min(w - 40.0), height.min(h - 40.0));
    *PROGRAMMATIC_DIFF_SIZE.lock().unwrap_or_else(|e| e.into_inner()) = (fit_w, fit_h);
    window
        .set_size(tauri::LogicalSize::new(fit_w, fit_h))
        .map_err(|e| format!("无法调整 diff 窗口尺寸: {e}"))?;
    window
        .set_position(tauri::LogicalPosition::new(x + (w - fit_w) / 2.0, y + (h - fit_h) / 2.0))
        .map_err(|e| format!("无法移动 diff 窗口: {e}"))
}

#[tauri::command]
pub fn get_diff_project_id() -> Option<String> {
    DIFF_PROJECT_ID.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

#[tauri::command]
pub async fn open_diff_window(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let project = find_project(&app, &id)?;
    *DIFF_PROJECT_ID.lock().unwrap_or_else(|e| e.into_inner()) = Some(id.clone());
    // 预热失败或被意外销毁时现建一个，加载完会通过 get_diff_project_id 拿到项目
    let window = match app.get_webview_window(DIFF_WINDOW_LABEL) {
        Some(window) => window,
        None => build_diff_window(&app)?,
    };
    app.emit_to(DIFF_WINDOW_LABEL, "diff-open", &id)
        .map_err(|e| format!("无法切换 diff 项目: {e}"))?;
    // 已经显示着就留在原位，只切项目
    if !window.is_visible().unwrap_or(false) {
        place_diff_window(&app, &window)?;
    }
    let _ = window.unminimize();
    window.show().map_err(|e| format!("无法显示 diff 窗口: {e}"))?;
    let _ = window.set_title(&format!("{} 的变更", project.display_name));
    #[cfg(target_os = "macos")]
    {
        inset_traffic_lights(&window);
        // shortcut: 显示后系统可能还会再排一次标题栏布局，延迟 120ms 再摆一次兜底；若仍偶发错位再改为监听 AppKit 布局通知
        let win = window.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(120));
            inset_traffic_lights(&win);
        });
    }
    window.set_focus().map_err(|e| format!("无法聚焦窗口: {e}"))
}

/// 用户拖拽调整 diff 窗口后记下尺寸，之后打开都用它。
/// 只在松手停顿 400ms 后写一次，避免拖动过程中频繁写文件
fn remember_diff_window_size(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;

    let generation = Arc::new(AtomicU64::new(0));
    let app = app.clone();
    let win = window.clone();
    window.on_window_event(move |event| {
        let tauri::WindowEvent::Resized(size) = event else {
            return;
        };
        // 最小化、全屏、最大化不算用户想要的默认尺寸
        if size.width == 0
            || win.is_fullscreen().unwrap_or(false)
            || win.is_maximized().unwrap_or(false)
        {
            return;
        }
        let Ok(scale) = win.scale_factor() else {
            return;
        };
        let logical = size.to_logical::<f64>(scale);
        // 创建窗口和按屏幕放置时程序自己改的尺寸，不是用户拖的
        let expected = *PROGRAMMATIC_DIFF_SIZE.lock().unwrap_or_else(|e| e.into_inner());
        if (logical.width - expected.0).abs() < 1.0 && (logical.height - expected.1).abs() < 1.0 {
            return;
        }
        let current = generation.fetch_add(1, Ordering::SeqCst) + 1;
        let generation = generation.clone();
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(400));
            if generation.load(Ordering::SeqCst) != current {
                return;
            }
            let result = app_data_dir(&app)
                .and_then(|dir| save_diff_window_size(&dir, logical.width, logical.height));
            if let Err(e) = result {
                eprintln!("Asurada: 保存 diff 窗口尺寸失败 ({e})");
            }
        });
    });
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffWindowSize {
    pub width: f64,
    pub height: f64,
}

#[tauri::command]
pub async fn get_diff_window_size(app: tauri::AppHandle) -> Result<DiffWindowSize, String> {
    let (width, height) = load_diff_window_size(&app_data_dir(&app)?);
    Ok(DiffWindowSize { width, height })
}

#[tauri::command]
pub async fn set_diff_window_size(
    app: tauri::AppHandle,
    width: f64,
    height: f64,
) -> Result<DiffWindowSize, String> {
    let (width, height) = save_diff_window_size(&app_data_dir(&app)?, width, height)?;
    Ok(DiffWindowSize { width, height })
}

#[tauri::command]
pub async fn check_environment() -> PreflightResult {
    preflight::check_environment()
}

#[tauri::command]
pub async fn preflight() -> PreflightResult {
    preflight::check_environment()
}

/// 正在提交的项目。主面板和 diff 窗口都能发起提交，以后端为准，两边状态才一致
static COMMITTING: Mutex<Option<HashSet<String>>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommitPushEvent {
    id: String,
    /// "running" | "done"
    phase: &'static str,
    result: Option<CommitPushResult>,
}

#[tauri::command]
pub fn get_committing_ids() -> Vec<String> {
    COMMITTING
        .lock()
        .unwrap()
        .as_ref()
        .map(|set| set.iter().cloned().collect())
        .unwrap_or_default()
}

/// 结果通过 `commit-push` 事件广播给所有窗口；返回值同样带上结果，失败也放在 result 里
#[tauri::command]
pub async fn run_commit_push(
    app: tauri::AppHandle,
    id: String,
    language: String,
    paths: Option<Vec<String>>,
) -> Result<CommitPushResult, String> {
    let is_new = COMMITTING
        .lock()
        .unwrap()
        .get_or_insert_with(HashSet::new)
        .insert(id.clone());
    if !is_new {
        return Err("该项目正在提交中".to_string());
    }
    let _ = app.emit(
        "commit-push",
        CommitPushEvent { id: id.clone(), phase: "running", result: None },
    );

    let result = commit_push(&app, &id, &language, paths.as_deref()).unwrap_or_else(|e| CommitPushResult {
        success: false,
        commit_message: None,
        push_output: String::new(),
        error: Some(e),
    });

    if let Some(set) = COMMITTING.lock().unwrap().as_mut() {
        set.remove(&id);
    }
    let _ = app.emit(
        "commit-push",
        CommitPushEvent { id, phase: "done", result: Some(result.clone()) },
    );
    Ok(result)
}

/// 返回 git pull 的输出；失败时返回 git 的报错
#[tauri::command]
pub async fn run_pull(app: tauri::AppHandle, id: String) -> Result<String, String> {
    git_pull(&PathBuf::from(&find_project(&app, &id)?.path))
}

/// 丢弃这些文件的改动，不可撤销；提交中的项目不允许丢弃
#[tauri::command]
pub async fn discard_changes(app: tauri::AppHandle, id: String, paths: Vec<String>) -> Result<(), String> {
    let is_committing = COMMITTING
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|set| set.contains(&id));
    if is_committing {
        return Err("该项目正在提交中".to_string());
    }
    git_discard(&PathBuf::from(&find_project(&app, &id)?.path), &paths)
}

fn commit_push(
    app: &tauri::AppHandle,
    id: &str,
    language: &str,
    paths: Option<&[String]>,
) -> Result<CommitPushResult, String> {
    let project = find_project(app, id)?;
    let path = PathBuf::from(&project.path);
    if git_is_clean(&path)? {
        return Ok(CommitPushResult {
            success: false,
            commit_message: None,
            push_output: String::new(),
            error: Some("无变更".to_string()),
        });
    }

    let commit_message = run_pi_print(&path, language, paths)?;
    let push_output = git_add_commit_push(&path, &commit_message, paths)?;

    Ok(CommitPushResult {
        success: true,
        commit_message: Some(commit_message),
        push_output,
        error: None,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWithApp {
    pub name: String,
    /// .app 包路径，打开时原样传回
    pub path: String,
    pub is_default: bool,
}

/// 能打开该文件的应用（系统「打开方式」里的那些），默认应用排第一，其余按名称排序
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn list_open_with_apps(path: String) -> Vec<OpenWithApp> {
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSFileManager, NSString, NSURL};

    let workspace = NSWorkspace::sharedWorkspace();
    let file_manager = NSFileManager::defaultManager();
    let file_url = NSURL::fileURLWithPath(&NSString::from_str(&path));
    let default_path = workspace
        .URLForApplicationToOpenURL(&file_url)
        .and_then(|url| url.path())
        .map(|p| p.to_string());
    let mut apps: Vec<OpenWithApp> = workspace
        .URLsForApplicationsToOpenURL(&file_url)
        .iter()
        .filter_map(|url| url.path())
        .map(|app_path| {
            let name = file_manager.displayNameAtPath(&app_path).to_string();
            let app_path = app_path.to_string();
            OpenWithApp {
                name: name.trim_end_matches(".app").to_string(),
                is_default: default_path.as_deref() == Some(app_path.as_str()),
                path: app_path,
            }
        })
        .collect();
    // 同一个应用可能装了多份（如 /Applications 和 ~/Applications），按路径去重即可
    apps.sort_by(|a, b| b.is_default.cmp(&a.is_default).then_with(|| a.name.cmp(&b.name)));
    apps.dedup_by(|a, b| a.path == b.path);
    apps
}

/// 用指定应用打开文件。不走 opener 插件的 openPath(with)：它要在权限里逐个列出允许的程序
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn open_with_app(path: String, app: String) -> Result<(), String> {
    let status = std::process::Command::new("open")
        .args(["-a", &app, &path])
        .status()
        .map_err(|e| format!("无法打开文件: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("用 {app} 打开失败"))
    }
}

/// 系统首选语言是中文时返回 "zh"，否则 "en"。WKWebView 的 navigator.language 受 App 本地化声明影响，不可靠，直接读系统设置
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn get_system_language() -> &'static str {
    let languages = objc2_foundation::NSLocale::preferredLanguages();
    if languages.firstObject().is_some_and(|first| first.to_string().starts_with("zh")) {
        "zh"
    } else {
        "en"
    }
}

/// 写入系统剪贴板。右键菜单的回调不算用户手势，WebView 里的 navigator.clipboard 可能被拒
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn copy_text(text: String) -> Result<(), String> {
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
    use objc2_foundation::NSString;

    let pasteboard = NSPasteboard::generalPasteboard();
    pasteboard.clearContents();
    if pasteboard.setString_forType(&NSString::from_str(&text), unsafe { NSPasteboardTypeString }) {
        Ok(())
    } else {
        Err("写入剪贴板失败".to_string())
    }
}

#[cfg(all(test, target_os = "macos"))]
mod open_with_tests {
    use super::*;

    #[test]
    fn lists_apps_with_single_default_first() {
        let apps = list_open_with_apps(concat!(env!("CARGO_MANIFEST_DIR"), "/Cargo.toml").to_string());
        assert!(!apps.is_empty(), "文本文件至少有一个应用能打开");
        assert!(apps.iter().filter(|a| a.is_default).count() <= 1);
        if apps.iter().any(|a| a.is_default) {
            assert!(apps[0].is_default);
        }
    }
}
