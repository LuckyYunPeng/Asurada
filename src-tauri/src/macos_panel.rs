use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    App, AppHandle, Emitter, LogicalSize, Manager, WebviewWindow,
};
use tauri_nspanel::{
    tauri_panel, CollectionBehavior, PanelLevel, StyleMask, WebviewWindowExt,
};

/// 选目录对话框打开时，忽略失焦和窗外点击，避免收起并重新摆放面板。
static IS_FILE_DIALOG_OPEN: AtomicBool = AtomicBool::new(false);
/// 收起态的第一下点击经常只用来激活窗口，到不了页面按钮。
static IS_PANEL_EXPANDED: AtomicBool = AtomicBool::new(true);
static IS_TAG_HOT: AtomicBool = AtomicBool::new(false);
static IS_DRAGGING: AtomicBool = AtomicBool::new(false);
/// 收起且有提交结果时，窗口上方多出一朵云；值为云朵占用的高度，0 表示没有。
static RESULT_CLOUD_BAND: Mutex<f64> = Mutex::new(0.0);
/// 标签顶边距工作区顶边的逻辑距离。空表示还没拖过，用默认位置。
static DOCK_TAG_OFFSET: Mutex<Option<f64>> = Mutex::new(None);
/// 在别的屏幕上真实点下后，下一次摆放贴到这块屏。空表示留在当前屏。
static CLICKED_SCREEN: Mutex<Option<(f64, f64, f64, f64)>> = Mutex::new(None);

/// 收起态窗口比标签高出这一截，用来放拖拽手柄。和 CSS `.tag` 的 top 一致。
const HANDLE_BAND: f64 = 22.0;
const CLOUD_WIDTH: f64 = 220.0;
/// 和 CSS `.tag` 的 height、`.panel` 的 top/bottom 留白一致。
const TAG_HEIGHT: f64 = 60.0;
const PANEL_INSET: f64 = 10.0;
/// 宽度要放得下悬停放大 1.08 倍后的 Tag（34 × 1.08 ≈ 36.7）。
const DOCK_COLLAPSED: LogicalSize<f64> = LogicalSize::new(37.0, 94.0);
/// 宽度含 CSS `.panel` 右侧 22px 留白，面板本体 360pt。
const DOCK_EXPANDED: LogicalSize<f64> = LogicalSize::new(396.0, 600.0);

fn result_cloud_band() -> f64 {
    *lock_dock(&RESULT_CLOUD_BAND)
}

const TRAY_SHOW_ID: &str = "tray-show-panel";
const TRAY_COLLAPSE_ID: &str = "tray-collapse";
const TRAY_QUIT_ID: &str = "tray-quit";

tauri_panel! {
    panel!(AsuradaPanel {
        config: {
            can_become_key_window: true,
            can_become_main_window: false,
            is_floating_panel: true
        }
    })

    panel_event!(AsuradaPanelHandler {
        window_did_resign_key(notification: &NSNotification) -> (),
    })
}


pub fn place_dock_window(window: &WebviewWindow, expanded: bool) -> Result<(), String> {
    let cloud = result_cloud_band();
    let (width, height) = if expanded {
        (DOCK_EXPANDED.width, DOCK_EXPANDED.height)
    } else if cloud > 0.0 {
        (CLOUD_WIDTH, DOCK_COLLAPSED.height + cloud)
    } else {
        (DOCK_COLLAPSED.width, DOCK_COLLAPSED.height)
    };
    let saved_offset = *lock_dock(&DOCK_TAG_OFFSET);
    let ns_window = window
        .ns_window()
        .map_err(|e| format!("无法读取窗口: {e}"))? as usize;
    let is_from_bottom = AtomicBool::new(false);
    if tauri_nspanel::objc2::MainThreadMarker::new().is_some() {
        is_from_bottom.store(
            place_frame(ns_window, expanded, width, height, cloud, saved_offset),
            Ordering::SeqCst,
        );
    } else {
        let is_from_bottom = &is_from_bottom;
        dispatch2::DispatchQueue::main().exec_sync(move || {
            is_from_bottom.store(
                place_frame(ns_window, expanded, width, height, cloud, saved_offset),
                Ordering::SeqCst,
            );
        });
    }
    if expanded {
        let _ = window.emit("panel-from-bottom", is_from_bottom.load(Ordering::SeqCst));
    }
    Ok(())
}

fn same_screen(left: &objc2_app_kit::NSScreen, right: &objc2_app_kit::NSScreen) -> bool {
    let left = left.frame();
    let right = right.frame();
    (left.origin.x - right.origin.x).abs() < 1.0
        && (left.origin.y - right.origin.y).abs() < 1.0
        && (left.size.width - right.size.width).abs() < 1.0
        && (left.size.height - right.size.height).abs() < 1.0
}

fn screen_under_mouse(
    mtm: tauri_nspanel::objc2::MainThreadMarker,
) -> Option<tauri_nspanel::objc2::rc::Retained<objc2_app_kit::NSScreen>> {
    use objc2_app_kit::{NSEvent, NSScreen};

    let mouse = NSEvent::mouseLocation();
    let screens = NSScreen::screens(mtm);
    for index in 0..screens.count() {
        let candidate = screens.objectAtIndex(index);
        let bounds = candidate.frame();
        if mouse.x >= bounds.origin.x
            && mouse.x < bounds.origin.x + bounds.size.width
            && mouse.y >= bounds.origin.y
            && mouse.y < bounds.origin.y + bounds.size.height
        {
            return Some(candidate);
        }
    }
    None
}

/// 平时留在窗口现在这块屏。只有点在别的屏上时，才改贴那块屏。
fn screen_in_use(
    window: &objc2_app_kit::NSWindow,
    mtm: tauri_nspanel::objc2::MainThreadMarker,
) -> Option<tauri_nspanel::objc2::rc::Retained<objc2_app_kit::NSScreen>> {
    if let Some((x, y, width, height)) = *lock_dock(&CLICKED_SCREEN) {
        let screens = objc2_app_kit::NSScreen::screens(mtm);
        for index in 0..screens.count() {
            let candidate = screens.objectAtIndex(index);
            let bounds = candidate.frame();
            if (bounds.origin.x - x).abs() < 1.0
                && (bounds.origin.y - y).abs() < 1.0
                && (bounds.size.width - width).abs() < 1.0
                && (bounds.size.height - height).abs() < 1.0
            {
                return Some(candidate);
            }
        }
    }
    if let Some(current) = window.screen() {
        return Some(current);
    }
    screen_under_mouse(mtm).or_else(|| {
        let screens = objc2_app_kit::NSScreen::screens(mtm);
        if screens.count() == 0 {
            None
        } else {
            Some(screens.objectAtIndex(0))
        }
    })
}

/// 在本窗口以外点下时，若落点在另一块屏，记下那块屏。收起态马上贴过去。
fn note_display_click(app: &AppHandle) {
    if IS_DRAGGING.load(Ordering::SeqCst) || IS_FILE_DIALOG_OPEN.load(Ordering::SeqCst) {
        return;
    }
    if tauri_nspanel::objc2::MainThreadMarker::new().is_none() {
        let app = app.clone();
        dispatch2::DispatchQueue::main().exec_async(move || note_display_click(&app));
        return;
    }
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Ok(ns_window) = window.ns_window() else {
        return;
    };
    let ns_window = unsafe { &*ns_window.cast::<objc2_app_kit::NSWindow>() };
    let mtm = tauri_nspanel::objc2::MainThreadMarker::from(ns_window);
    let Some(target) = screen_under_mouse(mtm) else {
        return;
    };
    if ns_window
        .screen()
        .is_some_and(|dock| same_screen(&dock, &target))
    {
        return;
    }
    let bounds = target.frame();
    *lock_dock(&CLICKED_SCREEN) = Some((
        bounds.origin.x,
        bounds.origin.y,
        bounds.size.width,
        bounds.size.height,
    ));
    if !IS_PANEL_EXPANDED.load(Ordering::SeqCst) {
        let _ = place_dock_window(&window, false);
    }
}

/// 用正在使用的屏幕的 AppKit 坐标贴右边。不走 tao 的 set_position，避免主屏像素高度把窗口丢到另一块屏。
fn place_frame(
    ns_window: usize,
    expanded: bool,
    width: f64,
    height: f64,
    cloud: f64,
    saved_offset: Option<f64>,
) -> bool {
    use objc2_app_kit::NSWindow;
    use tauri_nspanel::objc2::MainThreadMarker;
    use tauri_nspanel::objc2_foundation::{NSPoint, NSRect, NSSize};

    let window = unsafe { &*(ns_window as *const NSWindow) };
    let Some(screen) = screen_in_use(window, MainThreadMarker::from(window)) else {
        return false;
    };
    let visible = screen.visibleFrame();
    let work_top = visible.origin.y + visible.size.height;
    let collapsed_max = (visible.size.height - DOCK_COLLAPSED.height + HANDLE_BAND).max(HANDLE_BAND);
    let raw = saved_offset
        .unwrap_or_else(|| {
            (visible.size.height * 0.36 - DOCK_EXPANDED.height / 2.0).clamp(HANDLE_BAND, collapsed_max)
        })
        .clamp(HANDLE_BAND, collapsed_max);
    // 下面放得下整块面板时，面板顶边贴着标签顶边。放不下就改成底边贴着标签底边，往上长。
    // 窗口比面板上下各多 PANEL_INSET（CSS `.panel` 的 top/bottom），对齐时要扣掉。
    let is_from_bottom =
        expanded && raw - PANEL_INSET + DOCK_EXPANDED.height > visible.size.height;
    let top_from_work = if !expanded {
        (raw - HANDLE_BAND - cloud).max(0.0)
    } else if is_from_bottom {
        ((raw + TAG_HEIGHT + PANEL_INSET).min(visible.size.height) - DOCK_EXPANDED.height).max(0.0)
    } else {
        (raw - PANEL_INSET).max(0.0)
    };
    window.setFrame_display(
        NSRect::new(
            NSPoint::new(
                visible.origin.x + visible.size.width - width,
                work_top - top_from_work - height,
            ),
            NSSize::new(width, height),
        ),
        false,
    );
    *lock_dock(&CLICKED_SCREEN) = None;
    is_from_bottom
}

fn lock_dock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|err| err.into_inner())
}

fn load_dock_offset(app: &AppHandle) {
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    let Ok(raw) = std::fs::read_to_string(dir.join("dock.json")) else {
        return;
    };
    #[derive(serde::Deserialize)]
    struct DockFile {
        tag_offset: f64,
    }
    if let Ok(file) = serde_json::from_str::<DockFile>(&raw) {
        *lock_dock(&DOCK_TAG_OFFSET) = Some(file.tag_offset);
    }
}

fn save_dock_offset(app: &AppHandle) {
    let Some(tag_offset) = *lock_dock(&DOCK_TAG_OFFSET) else {
        return;
    };
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    let _ = std::fs::create_dir_all(&dir);
    #[derive(serde::Serialize)]
    struct DockFile {
        tag_offset: f64,
    }
    if let Ok(raw) = serde_json::to_string(&DockFile { tag_offset }) {
        let _ = std::fs::write(dir.join("dock.json"), raw);
    }
}

pub(super) fn commit_dock_offset(app: &AppHandle, tag_offset: f64) {
    *lock_dock(&DOCK_TAG_OFFSET) = Some(tag_offset);
    save_dock_offset(app);
}

fn show_window_expanded(window: &WebviewWindow) -> Result<(), String> {
    place_dock_window(window, true)?;
    if let Ok(panel) = window.to_panel::<AsuradaPanel>() {
        panel.show_and_make_key();
    } else {
        window
            .show()
            .map_err(|e| format!("无法显示窗口: {e}"))?;
        window
            .set_focus()
            .map_err(|e| format!("无法聚焦窗口: {e}"))?;
    }
    Ok(())
}

fn show_window_collapsed(window: &WebviewWindow) -> Result<(), String> {
    place_dock_window(window, false)?;
    if let Ok(panel) = window.to_panel::<AsuradaPanel>() {
        panel.show();
    } else {
        window
            .show()
            .map_err(|e| format!("无法显示窗口: {e}"))?;
    }
    Ok(())
}

pub fn apply_panel_open(app: &AppHandle, expanded: bool) -> Result<(), String> {
    IS_PANEL_EXPANDED.store(expanded, Ordering::SeqCst);
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "未找到主窗口".to_string())?;

    if expanded {
        show_window_expanded(&window)?;
    } else {
        show_window_collapsed(&window)?;
    }

    let _ = app.emit("set-panel-open", expanded);
    outside_click::refresh_collapsed_cursor(&window);
    Ok(())
}

fn init_panel(app_handle: &AppHandle) -> Result<(), String> {
    let window = app_handle
        .get_webview_window("main")
        .ok_or_else(|| "未找到主窗口".to_string())?;

    let panel = window
        .to_panel::<AsuradaPanel>()
        .map_err(|e| format!("无法转换为 NSPanel: {e}"))?;

    panel.set_level(PanelLevel::Floating.value());
    // 透明窗的系统阴影会勾出整窗外框，阴影交给 CSS
    panel.set_has_shadow(false);

    panel
        .add_style_mask(StyleMask::empty().nonactivating_panel().into())
        .map_err(|e| format!("无法设置 panel 样式: {e}"))?;

    panel.set_collection_behavior(
        CollectionBehavior::new()
            .full_screen_auxiliary()
            .full_screen_disallows_tiling()
            .can_join_all_spaces()
            .stationary()
            .into(),
    );
    // 默认会在应用失活时整窗隐藏，点外面就看不到 tag
    panel.set_hides_on_deactivate(false);
    panel.set_accepts_mouse_moved_events(true);

    let handler = AsuradaPanelHandler::new();
    let emit_handle = app_handle.clone();
    handler.window_did_resign_key(move |_notification| {
        if IS_FILE_DIALOG_OPEN.load(Ordering::SeqCst) {
            return;
        }
        let _ = emit_handle.emit("dock-blur", ());
    });
    panel.set_event_handler(Some(handler.as_ref()));

    show_window_expanded(&window)?;

    Ok(())
}

pub fn fallback_regular_window(app: &mut App) -> Result<(), String> {
    app.set_activation_policy(tauri::ActivationPolicy::Regular);

    let window = app
        .handle()
        .get_webview_window("main")
        .ok_or_else(|| "未找到主窗口".to_string())?;

    window
        .set_always_on_top(true)
        .map_err(|e| format!("无法设置置顶: {e}"))?;
    let _ = window.set_shadow(false);
    show_window_expanded(&window)?;

    Ok(())
}

/// 最后回退：尽量把主窗口显示出来，避免 setup 失败后进程无 UI 退出。
pub fn last_resort_show(app: &mut App) {
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    if let Some(window) = app.handle().get_webview_window("main") {
        let _ = window.set_always_on_top(true);
        let _ = place_dock_window(&window, true);
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn setup_tray(app: &mut App) -> Result<(), String> {
    let tray_accel = app
        .path()
        .app_data_dir()
        .ok()
        .map(|dir| crate::settings::load_toggle_panel_shortcut(&dir))
        .unwrap_or_else(|| crate::settings::DEFAULT_TOGGLE_PANEL_SHORTCUT.to_string());
    let show_item = MenuItem::with_id(
        app,
        TRAY_SHOW_ID,
        "显示面板",
        true,
        Some(tray_accel.as_str()),
    )
    .map_err(|e| format!("无法创建菜单项: {e}"))?;
    let collapse_item = MenuItem::with_id(
        app,
        TRAY_COLLAPSE_ID,
        "收起",
        true,
        None::<&str>,
    )
    .map_err(|e| format!("无法创建菜单项: {e}"))?;
    let quit_item = MenuItem::with_id(app, TRAY_QUIT_ID, "退出", true, None::<&str>)
        .map_err(|e| format!("无法创建菜单项: {e}"))?;

    let menu = Menu::with_items(app, &[&show_item, &collapse_item, &quit_item])
        .map_err(|e| format!("无法创建托盘菜单: {e}"))?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| "缺少应用图标".to_string())?;

    TrayIconBuilder::with_id("asurada-tray")
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| {
            match event.id.as_ref() {
                TRAY_SHOW_ID => {
                    let _ = apply_panel_open(app, true);
                }
                TRAY_COLLAPSE_ID => {
                    let _ = apply_panel_open(app, false);
                }
                TRAY_QUIT_ID => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .build(app)
        .map_err(|e| format!("无法创建菜单栏图标: {e}"))?;

    Ok(())
}

pub fn setup(app: &mut App) -> Result<(), String> {
    app.set_activation_policy(tauri::ActivationPolicy::Regular);
    load_dock_offset(app.handle());
    let ready = match init_panel(app.handle()) {
        Ok(()) => Ok(()),
        Err(e) => {
            eprintln!("Asurada: NSPanel 初始化失败 ({e})，回退为普通置顶小窗");
            fallback_regular_window(app)
        }
    };
    install_outside_click_monitor(app.handle().clone());
    if let Err(e) = init_toggle_shortcut(app.handle()) {
        eprintln!("Asurada: 快捷键注册失败 ({e})，可能已被其他 App 占用");
    }
    ready
}

use crate::settings::{
    load_toggle_panel_shortcut, reset_toggle_panel_shortcut, save_toggle_panel_shortcut,
    DEFAULT_TOGGLE_PANEL_SHORTCUT,
};
use serde::Serialize;
use std::str::FromStr;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

static ACTIVE_TOGGLE_SHORTCUT: Mutex<String> = Mutex::new(String::new());

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToggleShortcutInfo {
    /// Tauri global-shortcut 字符串，如 Alt+Super+KeyG
    pub shortcut: String,
    /// 可读展示，如 ⌥⌘G
    pub display: String,
}

pub fn toggle_shortcut_info(storage: &str) -> ToggleShortcutInfo {
    ToggleShortcutInfo {
        shortcut: storage.to_string(),
        display: storage_to_display(storage),
    }
}

fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("无法解析应用数据目录: {e}"))
}

fn active_toggle_shortcut() -> String {
    lock_dock(&ACTIVE_TOGGLE_SHORTCUT).clone()
}

fn set_active_toggle_shortcut(shortcut: String) {
    *lock_dock(&ACTIVE_TOGGLE_SHORTCUT) = shortcut;
}

pub fn storage_to_display(storage: &str) -> String {
    let mut out = String::new();
    for part in storage.split('+') {
        match part {
            "Alt" => out.push('⌥'),
            "Super" => out.push('⌘'),
            "Shift" => out.push('⇧'),
            "Control" => out.push('⌃'),
            key if key.starts_with("Key") && key.len() == 4 => {
                out.push(key.as_bytes()[3] as char);
            }
            key if key.starts_with("Digit") && key.len() == 6 => {
                out.push(key.as_bytes()[5] as char);
            }
            other => out.push_str(other),
        }
    }
    if out.is_empty() {
        storage_to_display(DEFAULT_TOGGLE_PANEL_SHORTCUT)
    } else {
        out
    }
}

fn validate_toggle_shortcut(shortcut: &str) -> Result<Shortcut, String> {
    let parsed = Shortcut::from_str(shortcut).map_err(|e| format!("快捷键格式无效：{e}"))?;
    if parsed.mods == Modifiers::empty() {
        return Err("请至少包含一个修饰键（⌥、⌘、⇧ 或 ⌃）".to_string());
    }
    Ok(parsed)
}

fn register_toggle_shortcut_handler(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    validate_toggle_shortcut(shortcut)?;
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                let _ = apply_panel_open(app, !IS_PANEL_EXPANDED.load(Ordering::SeqCst));
            }
        })
        .map_err(|e| format!("快捷键无法注册（可能已被占用）：{e}"))
}

pub fn apply_toggle_shortcut(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    let shortcut = shortcut.trim();
    if shortcut.is_empty() {
        return Err("快捷键不能为空".to_string());
    }
    validate_toggle_shortcut(shortcut)?;
    let previous = active_toggle_shortcut();
    if previous == shortcut {
        return Ok(());
    }
    let gs = app.global_shortcut();

    if !previous.is_empty() && previous != shortcut {
        let _ = gs.unregister(previous.as_str());
    }

    match register_toggle_shortcut_handler(app, shortcut) {
        Ok(()) => {
            set_active_toggle_shortcut(shortcut.to_string());
            Ok(())
        }
        Err(e) => {
            if !previous.is_empty() {
                let _ = register_toggle_shortcut_handler(app, &previous);
            }
            Err(e)
        }
    }
}

pub fn init_toggle_shortcut(app: &AppHandle) -> Result<(), String> {
    let dir = app_data_dir(app)?;
    let shortcut = load_toggle_panel_shortcut(&dir);
    apply_toggle_shortcut(app, &shortcut)
}

#[tauri::command]
pub fn get_toggle_shortcut(app: AppHandle) -> Result<ToggleShortcutInfo, String> {
    let dir = app_data_dir(&app)?;
    Ok(toggle_shortcut_info(&load_toggle_panel_shortcut(&dir)))
}

#[tauri::command]
pub fn set_toggle_shortcut(app: AppHandle, shortcut: String) -> Result<ToggleShortcutInfo, String> {
    apply_toggle_shortcut(&app, &shortcut)?;
    let dir = app_data_dir(&app)?;
    save_toggle_panel_shortcut(&dir, &shortcut)?;
    Ok(toggle_shortcut_info(&shortcut))
}

#[tauri::command]
pub fn reset_toggle_shortcut(app: AppHandle) -> Result<ToggleShortcutInfo, String> {
    apply_toggle_shortcut(&app, DEFAULT_TOGGLE_PANEL_SHORTCUT)?;
    let dir = app_data_dir(&app)?;
    reset_toggle_panel_shortcut(&dir)?;
    Ok(toggle_shortcut_info(DEFAULT_TOGGLE_PANEL_SHORTCUT))
}

/// 非激活面板点到别的 App 时不会 resign key，用全局鼠标监听补上。
fn install_outside_click_monitor(app_handle: AppHandle) {
    outside_click::install(app_handle);
}

mod outside_click {
    use super::{
        apply_panel_open, commit_dock_offset, HANDLE_BAND, IS_DRAGGING,
        IS_FILE_DIALOG_OPEN, IS_PANEL_EXPANDED, IS_TAG_HOT,
    };
    use objc2_app_kit::{
        NSAutoresizingMaskOptions, NSCursor, NSEvent, NSEventMask, NSScreen, NSTrackingArea,
        NSTrackingAreaOptions, NSView, NSWindow,
    };
    use std::ffi::{c_char, c_int, c_void, CStr};
    use std::sync::atomic::{AtomicBool, AtomicPtr, Ordering};
    use std::sync::OnceLock;
    use dispatch2::{DispatchQueue, DispatchTime};
    use tauri::{AppHandle, Emitter, Manager};
    use tauri_nspanel::objc2::ffi::class_addMethod;
    use tauri_nspanel::objc2::rc::Retained;
    use tauri_nspanel::objc2::runtime::{AnyObject, Imp, Sel};
    use tauri_nspanel::objc2::{define_class, msg_send, AllocAnyThread, MainThreadMarker, MainThreadOnly};
    use tauri_nspanel::objc2_foundation::{NSPoint, NSRect, NSSize};

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static CURSOR_VIEW: AtomicPtr<TagCursorView> = AtomicPtr::new(std::ptr::null_mut());
    static IS_HAND_SHOWN: AtomicBool = AtomicBool::new(false);
    static IN_DRAG_MOVE: AtomicBool = AtomicBool::new(false);

    struct LiveDrag {
        start_mouse_y: f64,
        start_origin_y: f64,
        origin_x: f64,
        width: f64,
        height: f64,
    }



    static LIVE_DRAG: std::sync::Mutex<Option<LiveDrag>> = std::sync::Mutex::new(None);

    unsafe extern "C" {
        fn dlopen(filename: *const c_char, flags: c_int) -> *mut c_void;
        fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
        fn CFStringCreateWithCString(
            alloc: *const c_void,
            c_str: *const c_char,
            encoding: u32,
        ) -> *const c_void;
        fn CFRelease(cf: *const c_void);
        static kCFBooleanTrue: *const c_void;
    }

    define_class!(
        #[unsafe(super(NSView))]
        #[thread_kind = MainThreadOnly]
        #[ivars = ()]
        #[name = "AsuradaTagCursorView"]
        struct TagCursorView;

        impl TagCursorView {
            #[unsafe(method(updateTrackingAreas))]
            fn update_tracking_areas(&self) {
                unsafe { msg_send![super(self), updateTrackingAreas] }
                if self.trackingAreas().count() > 0 {
                    return;
                }
                let area = unsafe {
                    NSTrackingArea::initWithRect_options_owner_userInfo(
                        NSTrackingArea::alloc(),
                        self.bounds(),
                        NSTrackingAreaOptions::MouseEnteredAndExited
                            | NSTrackingAreaOptions::MouseMoved
                            | NSTrackingAreaOptions::CursorUpdate
                            | NSTrackingAreaOptions::ActiveAlways
                            | NSTrackingAreaOptions::InVisibleRect
                            | NSTrackingAreaOptions::AssumeInside,
                        Some(&*(self as *const Self as *const AnyObject)),
                        None,
                    )
                };
                self.addTrackingArea(&area);
            }

            #[unsafe(method(resetCursorRects))]
            fn reset_cursor_rects(&self) {
                unsafe { msg_send![super(self), resetCursorRects] }
                if IS_PANEL_EXPANDED.load(Ordering::SeqCst) {
                    return;
                }
                let bounds = self.bounds();
                let cloud = super::result_cloud_band();
                self.addCursorRect_cursor(
                    NSRect {
                        origin: NSPoint {
                            x: bounds.origin.x,
                            y: bounds.origin.y + bounds.size.height - cloud - HANDLE_BAND,
                        },
                        size: NSSize {
                            width: bounds.size.width,
                            height: HANDLE_BAND,
                        },
                    },
                    &NSCursor::openHandCursor(),
                );
                self.addCursorRect_cursor(
                    NSRect {
                        origin: bounds.origin,
                        size: NSSize {
                            width: bounds.size.width,
                            height: bounds.size.height - cloud - HANDLE_BAND,
                        },
                    },
                    &NSCursor::pointingHandCursor(),
                );
            }

            #[unsafe(method(mouseEntered:))]
            fn mouse_entered(&self, _event: &NSEvent) {
                show_hand();
            }

            #[unsafe(method(mouseMoved:))]
            fn mouse_moved(&self, _event: &NSEvent) {
                show_hand();
            }

            #[unsafe(method(cursorUpdate:))]
            fn cursor_update(&self, _event: &NSEvent) {
                show_hand();
            }

            #[unsafe(method(mouseExited:))]
            fn mouse_exited(&self, _event: &NSEvent) {
                if IS_DRAGGING.load(Ordering::SeqCst) {
                    return;
                }
                release_hand();
            }

            #[unsafe(method(acceptsFirstMouse:))]
            fn accepts_first_mouse(&self, _event: &NSEvent) -> bool {
                true
            }

            #[unsafe(method_id(hitTest:))]
            fn hit_test(&self, point: NSPoint) -> Option<Retained<NSView>> {
                let bounds = self.bounds();
                let cloud = super::result_cloud_band();
                let local_y = point.y - bounds.origin.y;
                let local_x = point.x - bounds.origin.x;
                let in_cloud = cloud > 0.0 && local_y >= bounds.size.height - cloud;
                let in_tag = local_x >= bounds.size.width - super::DOCK_COLLAPSED.width;
                if IS_PANEL_EXPANDED.load(Ordering::SeqCst) || !(in_cloud || in_tag) {
                    None
                } else {
                    unsafe { msg_send![super(self), hitTest: point] }
                }
            }
        }
    );

    fn show_hand() {
        if IS_PANEL_EXPANDED.load(Ordering::SeqCst) || IS_FILE_DIALOG_OPEN.load(Ordering::SeqCst) {
            release_hand();
            return;
        }
        if cursor_over_cloud() {
            if IS_HAND_SHOWN.swap(false, Ordering::SeqCst) {
                NSCursor::arrowCursor().set();
            }
            if let Some(app) = APP.get() {
                if IS_TAG_HOT.swap(false, Ordering::SeqCst) {
                    let _ = app.emit("tag-hot", false);
                }
            }
            return;
        }
        IS_HAND_SHOWN.store(true, Ordering::SeqCst);
        if IS_DRAGGING.load(Ordering::SeqCst) {
            NSCursor::closedHandCursor().set();
        } else if cursor_over_handle() {
            NSCursor::openHandCursor().set();
        } else {
            NSCursor::pointingHandCursor().set();
        }
        if let Some(app) = APP.get() {
            if !IS_TAG_HOT.swap(true, Ordering::SeqCst) {
                let _ = app.emit("tag-hot", true);
            }
        }
    }

    fn release_hand() {
        if IS_HAND_SHOWN.swap(false, Ordering::SeqCst) {
            NSCursor::arrowCursor().set();
        }
        if let Some(app) = APP.get() {
            if IS_TAG_HOT.swap(false, Ordering::SeqCst) {
                let _ = app.emit("tag-hot", false);
            }
        }
    }

    pub(super) fn refresh_collapsed_cursor(window: &tauri::WebviewWindow) {
        let Ok(ns_window) = window.ns_window() else {
            return;
        };
        let ns_window = unsafe { &*ns_window.cast::<NSWindow>() };
        let view = CURSOR_VIEW.load(Ordering::SeqCst);
        if !view.is_null() {
            ns_window.invalidateCursorRectsForView(unsafe { &*view });
        }
        if cursor_inside(ns_window) {
            show_hand();
        } else {
            release_hand();
        }
    }

    /// 别的 App 在前台时，系统只显示那个 App 的光标。给这个窗口打上后台改光标的标记后，
    /// 鼠标停在收起态上时 `NSCursor.set` 才会画到手型。
    fn allow_background_cursor(window_number: isize) {
        let Some(main_conn) = (unsafe {
            sky_symbol::<unsafe extern "C" fn() -> c_int>(c"CGSMainConnectionID")
                .or_else(|| sky_symbol(c"SLSMainConnectionID"))
        }) else {
            return;
        };
        let cid = unsafe { main_conn() };
        if let Some(set_tags) = unsafe {
            sky_symbol::<unsafe extern "C" fn(c_int, u32, *const u64, c_int) -> c_int>(
                c"SLSSetWindowTags",
            )
            .or_else(|| sky_symbol(c"CGSSetWindowTags"))
        } {
            let tags: u64 = 1 << 5;
            let _ = unsafe { set_tags(cid, window_number as u32, &tags, 64) };
        }
        if let Some(set_prop) = unsafe {
            sky_symbol::<unsafe extern "C" fn(c_int, c_int, *const c_void, *const c_void) -> c_int>(
                c"CGSSetConnectionProperty",
            )
            .or_else(|| sky_symbol(c"SLSSetConnectionProperty"))
        } {
            let key = unsafe {
                CFStringCreateWithCString(
                    std::ptr::null(),
                    c"SetsCursorInBackground".as_ptr(),
                    0x0800_0100,
                )
            };
            if !key.is_null() {
                let _ = unsafe { set_prop(cid, cid, key, kCFBooleanTrue) };
                unsafe { CFRelease(key) };
            }
        }
    }

    unsafe fn sky_symbol<T>(name: &CStr) -> Option<T> {
        const RTLD_DEFAULT: *mut c_void = -2isize as *mut c_void;
        const RTLD_LAZY: c_int = 1;
        let mut symbol = unsafe { dlsym(RTLD_DEFAULT, name.as_ptr()) };
        if symbol.is_null() {
            let sky = unsafe {
                dlopen(
                    c"/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight".as_ptr(),
                    RTLD_LAZY,
                )
            };
            if !sky.is_null() {
                symbol = unsafe { dlsym(sky, name.as_ptr()) };
            }
        }
        if symbol.is_null() {
            None
        } else {
            Some(unsafe { std::mem::transmute_copy(&symbol) })
        }
    }

    fn install_cursor_view(window: &NSWindow) {
        allow_background_cursor(window.windowNumber());
        let Some(content) = window.contentView() else {
            return;
        };
        let view = TagCursorView::alloc(MainThreadMarker::from(window)).set_ivars(());
        let view: Retained<TagCursorView> =
            unsafe { msg_send![super(view), initWithFrame: content.bounds()] };
        view.setAutoresizingMask(
            NSAutoresizingMaskOptions::ViewWidthSizable
                | NSAutoresizingMaskOptions::ViewHeightSizable,
        );
        content.addSubview(&view);
        CURSOR_VIEW.store(
            Retained::as_ptr(&view) as *mut TagCursorView,
            Ordering::SeqCst,
        );
        view.updateTrackingAreas();
        window.invalidateCursorRectsForView(&view);
    }

    pub fn install(app_handle: AppHandle) {
        let _ = APP.set(app_handle.clone());
        let mask = NSEventMask::LeftMouseDown | NSEventMask::RightMouseDown;
        let blur_handle = app_handle.clone();
        let block = block2::RcBlock::new(move |_event: std::ptr::NonNull<NSEvent>| {
            if IS_FILE_DIALOG_OPEN.load(Ordering::SeqCst) {
                return;
            }
            super::note_display_click(&blur_handle);
            let _ = blur_handle.emit("dock-blur", ());
        });
        if let Some(monitor) =
            NSEvent::addGlobalMonitorForEventsMatchingMask_handler(mask, &block)
        {
            std::mem::forget(monitor);
        }

        let Some(window) = app_handle.get_webview_window("main") else {
            return;
        };
        let Ok(ns_window) = window.ns_window() else {
            return;
        };
        let ns_window = unsafe { &*ns_window.cast::<NSWindow>() };
        // 系统拖动会在屏幕底边弹出贴边引导，松手后把窗口放到屏幕中间。
        keep_off_system_drag(ns_window);
        install_cursor_view(ns_window);
        install_collapsed_click(app_handle.clone(), ns_window);
        install_tag_hot(ns_window as *const NSWindow);
        install_drag(app_handle, ns_window);
    }

    fn keep_off_system_drag(window: &NSWindow) {
        window.setMovable(false);
        window.setMovableByWindowBackground(false);
        static ADDED: AtomicBool = AtomicBool::new(false);
        if ADDED.swap(true, Ordering::SeqCst) {
            return;
        }
        unsafe extern "C-unwind" fn implicitly_disallow_tiling(
            _this: *mut AnyObject,
            _cmd: Sel,
        ) -> bool {
            true
        }
        let class = std::ptr::from_ref(
            unsafe { &*(window as *const NSWindow as *const AnyObject) }.class(),
        )
        .cast_mut();
        let _ = unsafe {
            class_addMethod(
                class,
                Sel::register(c"_implicitlyDisallowTiling"),
                std::mem::transmute::<
                    unsafe extern "C-unwind" fn(*mut AnyObject, Sel) -> bool,
                    Imp,
                >(implicitly_disallow_tiling),
                c"B@:".as_ptr(),
            )
        };
    }

    fn begin_live_drag(app: &AppHandle, window: &NSWindow) {
        let frame = window.frame();
        let mut drag = LIVE_DRAG.lock().unwrap_or_else(|err| err.into_inner());
        *drag = Some(LiveDrag {
            start_mouse_y: NSEvent::mouseLocation().y,
            start_origin_y: frame.origin.y,
            origin_x: frame.origin.x,
            width: frame.size.width,
            height: frame.size.height,
        });
        drop(drag);
        IS_DRAGGING.store(true, Ordering::SeqCst);
        let _ = app.emit("tag-dragging", true);
    }

    fn move_live_drag(window: &NSWindow) {
        if IN_DRAG_MOVE.swap(true, Ordering::SeqCst) {
            return;
        }
        let drag = LIVE_DRAG
            .lock()
            .unwrap_or_else(|err| err.into_inner())
            .as_ref()
            .map(|drag| LiveDrag {
                start_mouse_y: drag.start_mouse_y,
                start_origin_y: drag.start_origin_y,
                origin_x: drag.origin_x,
                width: drag.width,
                height: drag.height,
            });
        let Some(drag) = drag else {
            IN_DRAG_MOVE.store(false, Ordering::SeqCst);
            return;
        };
        let origin_y = clamp_origin_y(
            window,
            drag.start_origin_y + (NSEvent::mouseLocation().y - drag.start_mouse_y),
            drag.height,
        );
        if (origin_y - window.frame().origin.y).abs() >= 0.5
            || (window.frame().size.width - drag.width).abs() >= 0.5
            || (window.frame().size.height - drag.height).abs() >= 0.5
        {
            put_frame(window, drag.origin_x, origin_y, drag.width, drag.height);
        }
        IN_DRAG_MOVE.store(false, Ordering::SeqCst);
    }

    fn put_frame(window: &NSWindow, x: f64, y: f64, width: f64, height: f64) {
        window.setFrame_display(
            NSRect::new(NSPoint::new(x, y), NSSize::new(width, height)),
            false,
        );
    }

    fn clamp_origin_y(window: &NSWindow, origin_y: f64, height: f64) -> f64 {
        let frame = window.frame();
        let visible = screen_for(frame, MainThreadMarker::from(window)).visibleFrame();
        let max_origin = (visible.origin.y + visible.size.height - height).max(visible.origin.y);
        origin_y.clamp(visible.origin.y, max_origin)
    }

    fn screen_for(frame: NSRect, mtm: MainThreadMarker) -> Retained<NSScreen> {
        let screens = NSScreen::screens(mtm);
        let center_x = frame.origin.x + frame.size.width / 2.0;
        let center_y = frame.origin.y + frame.size.height / 2.0;
        for index in 0..screens.count() {
            let screen = screens.objectAtIndex(index);
            let bounds = screen.frame();
            if center_x >= bounds.origin.x
                && center_x < bounds.origin.x + bounds.size.width
                && center_y >= bounds.origin.y
                && center_y < bounds.origin.y + bounds.size.height
            {
                return screen;
            }
        }
        NSScreen::mainScreen(mtm).unwrap_or_else(|| screens.objectAtIndex(0))
    }

    fn finish_live_drag(app: &AppHandle, window: &NSWindow) {
        let Some(drag) = LIVE_DRAG
            .lock()
            .unwrap_or_else(|err| err.into_inner())
            .take()
        else {
            return;
        };
        IS_DRAGGING.store(false, Ordering::SeqCst);
        let origin_y = clamp_origin_y(
            window,
            drag.start_origin_y + (NSEvent::mouseLocation().y - drag.start_mouse_y),
            drag.height,
        );
        put_frame(window, drag.origin_x, origin_y, drag.width, drag.height);
        let visible = screen_for(
            NSRect::new(
                NSPoint::new(drag.origin_x, origin_y),
                NSSize::new(drag.width, drag.height),
            ),
            MainThreadMarker::from(window),
        )
        .visibleFrame();
        let tag_top = origin_y + drag.height - HANDLE_BAND - super::result_cloud_band();
        let work_top = visible.origin.y + visible.size.height;
        let max_offset = (visible.size.height - (drag.height - super::result_cloud_band())
            + HANDLE_BAND)
            .max(HANDLE_BAND);
        commit_dock_offset(app, (work_top - tag_top).clamp(HANDLE_BAND, max_offset));
        // 贴边引导在鼠标松开后才改窗口，下一轮和稍后再摆回去。
        hold_frame_later(window, drag.origin_x, origin_y, drag.width, drag.height, 0);
        hold_frame_later(
            window,
            drag.origin_x,
            origin_y,
            drag.width,
            drag.height,
            300_000_000,
        );
        let _ = app.emit("tag-dragging", false);
    }

    fn hold_frame_later(window: &NSWindow, x: f64, y: f64, width: f64, height: f64, delay_ns: i64) {
        let window = window as *const NSWindow as usize;
        let restore = move || {
            put_frame(unsafe { &*(window as *const NSWindow) }, x, y, width, height);
        };
        if delay_ns <= 0 {
            DispatchQueue::main().exec_async(restore);
        } else {
            let _ = DispatchQueue::main().after(DispatchTime::NOW.time(delay_ns), restore);
        }
    }

    fn install_collapsed_click(app_handle: AppHandle, window: *const NSWindow) {
        let window_number = unsafe { &*window }.windowNumber();
        let block = block2::RcBlock::new(move |event: std::ptr::NonNull<NSEvent>| {
            let mouse_down = unsafe { event.as_ref() };
            if !IS_FILE_DIALOG_OPEN.load(Ordering::SeqCst)
                && !IS_PANEL_EXPANDED.load(Ordering::SeqCst)
                && mouse_down.windowNumber() == window_number
            {
                let frame = unsafe { &*window }.frame();
                let y = mouse_down.locationInWindow().y;
                let cloud = super::result_cloud_band();
                if y < frame.size.height - cloud {
                    if y >= frame.size.height - cloud - HANDLE_BAND {
                        begin_live_drag(&app_handle, unsafe { &*window });
                        show_hand();
                    } else {
                        let _ = apply_panel_open(&app_handle, true);
                    }
                }
            }
            event.as_ptr()
        });
        if let Some(monitor) = unsafe {
            NSEvent::addLocalMonitorForEventsMatchingMask_handler(
                NSEventMask::LeftMouseDown,
                &block,
            )
        } {
            std::mem::forget(monitor);
        }
    }

    fn install_tag_hot(window: *const NSWindow) {
        let global = block2::RcBlock::new(move |_event: std::ptr::NonNull<NSEvent>| {
            note_tag_hot(window);
        });
        if let Some(monitor) =
            NSEvent::addGlobalMonitorForEventsMatchingMask_handler(NSEventMask::MouseMoved, &global)
        {
            std::mem::forget(monitor);
        }

        let local = block2::RcBlock::new(move |event: std::ptr::NonNull<NSEvent>| {
            note_tag_hot(window);
            event.as_ptr()
        });
        if let Some(monitor) = unsafe {
            NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::MouseMoved, &local)
        } {
            std::mem::forget(monitor);
        }
    }

    fn install_drag(app_handle: AppHandle, window: *const NSWindow) {
        let local_dragged = block2::RcBlock::new(move |event: std::ptr::NonNull<NSEvent>| {
            move_live_drag(unsafe { &*window });
            event.as_ptr()
        });
        if let Some(monitor) = unsafe {
            NSEvent::addLocalMonitorForEventsMatchingMask_handler(
                NSEventMask::LeftMouseDragged,
                &local_dragged,
            )
        } {
            std::mem::forget(monitor);
        }

        let up_app = app_handle.clone();
        let up = block2::RcBlock::new(move |_event: std::ptr::NonNull<NSEvent>| {
            finish_live_drag(&up_app, unsafe { &*window });
        });
        if let Some(monitor) =
            NSEvent::addGlobalMonitorForEventsMatchingMask_handler(NSEventMask::LeftMouseUp, &up)
        {
            std::mem::forget(monitor);
        }

        let local_up = block2::RcBlock::new(move |event: std::ptr::NonNull<NSEvent>| {
            finish_live_drag(&app_handle, unsafe { &*window });
            event.as_ptr()
        });
        if let Some(monitor) = unsafe {
            NSEvent::addLocalMonitorForEventsMatchingMask_handler(
                NSEventMask::LeftMouseUp,
                &local_up,
            )
        } {
            std::mem::forget(monitor);
        }
    }

    fn note_tag_hot(window: *const NSWindow) {
        if IS_DRAGGING.load(Ordering::SeqCst) {
            return;
        }
        let hot = !IS_PANEL_EXPANDED.load(Ordering::SeqCst)
            && !IS_FILE_DIALOG_OPEN.load(Ordering::SeqCst)
            && cursor_inside(window);
        if hot {
            show_hand();
        } else if IS_TAG_HOT.load(Ordering::SeqCst) {
            release_hand();
        }
    }

    fn cursor_over_handle() -> bool {
        let Some(app) = APP.get() else {
            return false;
        };
        let Some(window) = app.get_webview_window("main") else {
            return false;
        };
        let Ok(ns_window) = window.ns_window() else {
            return false;
        };
        let frame = unsafe { &*ns_window.cast::<NSWindow>() }.frame();
        let mouse = NSEvent::mouseLocation();
        let cloud = super::result_cloud_band();
        mouse.x >= frame.origin.x
            && mouse.x < frame.origin.x + frame.size.width
            && mouse.y >= frame.origin.y + frame.size.height - cloud - HANDLE_BAND
            && mouse.y < frame.origin.y + frame.size.height - cloud
    }

    fn cursor_over_cloud() -> bool {
        let cloud = super::result_cloud_band();
        if cloud <= 0.0 {
            return false;
        }
        let Some(app) = APP.get() else {
            return false;
        };
        let Some(window) = app.get_webview_window("main") else {
            return false;
        };
        let Ok(ns_window) = window.ns_window() else {
            return false;
        };
        let frame = unsafe { &*ns_window.cast::<NSWindow>() }.frame();
        let mouse = NSEvent::mouseLocation();
        mouse.x >= frame.origin.x
            && mouse.x < frame.origin.x + frame.size.width
            && mouse.y >= frame.origin.y + frame.size.height - cloud
            && mouse.y < frame.origin.y + frame.size.height
    }

    fn cursor_inside(window: *const NSWindow) -> bool {
        let mouse = NSEvent::mouseLocation();
        let frame = unsafe { &*window }.frame();
        let cloud = super::result_cloud_band();
        let in_frame = mouse.x >= frame.origin.x
            && mouse.x < frame.origin.x + frame.size.width
            && mouse.y >= frame.origin.y
            && mouse.y < frame.origin.y + frame.size.height;
        let in_cloud = cloud > 0.0 && mouse.y >= frame.origin.y + frame.size.height - cloud;
        let in_tag = mouse.x >= frame.origin.x + frame.size.width - super::DOCK_COLLAPSED.width;
        in_frame && (in_cloud || in_tag)
    }
}

/// 独立模态选目录，不挂到面板上。挂成 sheet 时 AppKit 会挪动父窗口。
#[tauri::command]
pub async fn pick_project_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    IS_FILE_DIALOG_OPEN.store(true, Ordering::SeqCst);
    let picked = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("选择本地 git 仓库")
            .pick_folder()
    })
    .await;

    if let Some(window) = app.get_webview_window("main") {
        let _ = place_dock_window(&window, true);
    }
    IS_FILE_DIALOG_OPEN.store(false, Ordering::SeqCst);
    let picked = picked.map_err(|e| e.to_string())?;

    Ok(picked.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn sync_dock_geometry(app: tauri::AppHandle, expanded: bool) -> Result<(), String> {
    apply_panel_open(&app, expanded)
}

/// 收起态有提交结果时，把窗口向上、向左撑开，给入口上方的云朵留位置。标签屏幕坐标不变。
/// `band` 由前端按云朵实际高度量出，0 表示收起云朵。
#[tauri::command]
pub fn set_result_cloud(app: tauri::AppHandle, band: f64) -> Result<(), String> {
    *lock_dock(&RESULT_CLOUD_BAND) = band.max(0.0);
    if IS_PANEL_EXPANDED.load(Ordering::SeqCst) {
        return Ok(());
    }
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "未找到主窗口".to_string())?;
    place_dock_window(&window, false)?;
    outside_click::refresh_collapsed_cursor(&window);
    Ok(())
}
