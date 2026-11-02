use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    App, AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Size, WebviewWindow,
};
use tauri_nspanel::{
    tauri_panel, CollectionBehavior, PanelLevel, StyleMask, WebviewWindowExt,
};

/// 选目录对话框打开时，忽略失焦和窗外点击，避免收起并重新摆放面板。
static IS_FILE_DIALOG_OPEN: AtomicBool = AtomicBool::new(false);

const DOCK_COLLAPSED: LogicalSize<f64> = LogicalSize::new(40.0, 88.0);
const DOCK_EXPANDED: LogicalSize<f64> = LogicalSize::new(384.0, 600.0);

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
    let logical = if expanded {
        DOCK_EXPANDED
    } else {
        DOCK_COLLAPSED
    };
    window
        .set_size(Size::Logical(logical))
        .map_err(|e| format!("无法调整窗口大小: {e}"))?;

    let monitor = active_monitor(window)?;
    // 每块屏缩放比不同，统一换算成逻辑坐标（macOS 全局 point）
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let origin = area.position.to_logical::<f64>(scale);
    let mon = area.size.to_logical::<f64>(scale);
    let x = origin.x + mon.width - logical.width;
    // 展开、收起共用面板顶边。按各自中心对齐时，88 高的 tag 会落到 600 高面板的中部。
    let y = origin.y
        + (mon.height * 0.36 - DOCK_EXPANDED.height / 2.0)
            .min(mon.height - DOCK_EXPANDED.height)
            .max(8.0);

    window
        .set_position(LogicalPosition::new(x, y))
        .map_err(|e| format!("无法移动窗口: {e}"))?;
    Ok(())
}

/// 鼠标所在的显示器，取不到时回退主显示器。
fn active_monitor(window: &WebviewWindow) -> Result<tauri::Monitor, String> {
    let by_cursor = window.cursor_position().ok().and_then(|p| {
        // tao 的 cursor_position 按主屏缩放比转成物理像素，monitor_from_point 要的是全局 point
        let scale = window.primary_monitor().ok().flatten()?.scale_factor();
        window
            .monitor_from_point(p.x / scale, p.y / scale)
            .ok()
            .flatten()
    });
    by_cursor
        .or_else(|| window.primary_monitor().ok().flatten())
        .ok_or_else(|| "无法读取显示器".to_string())
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
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "未找到主窗口".to_string())?;

    if expanded {
        show_window_expanded(&window)?;
    } else {
        show_window_collapsed(&window)?;
    }

    let _ = app.emit("set-panel-open", expanded);
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
            .can_join_all_spaces()
            .stationary()
            .into(),
    );
    // 默认会在应用失活时整窗隐藏，点外面就看不到 tag
    panel.set_hides_on_deactivate(false);

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
    let show_item = MenuItem::with_id(
        app,
        TRAY_SHOW_ID,
        "显示面板",
        true,
        None::<&str>,
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
    let ready = match init_panel(app.handle()) {
        Ok(()) => Ok(()),
        Err(e) => {
            eprintln!("Asurada: NSPanel 初始化失败 ({e})，回退为普通置顶小窗");
            fallback_regular_window(app)
        }
    };
    install_outside_click_monitor(app.handle().clone());
    ready
}

/// 非激活面板点到别的 App 时不会 resign key，用全局鼠标监听补上。
fn install_outside_click_monitor(app_handle: AppHandle) {
    outside_click::install(app_handle);
}

mod outside_click {
    use super::IS_FILE_DIALOG_OPEN;
    use objc2_app_kit::{NSEvent, NSEventMask};
    use std::sync::atomic::Ordering;
    use tauri::{AppHandle, Emitter};

    pub fn install(app_handle: AppHandle) {
        let mask = NSEventMask::LeftMouseDown | NSEventMask::RightMouseDown;
        let block = block2::RcBlock::new(move |_event: std::ptr::NonNull<NSEvent>| {
            if IS_FILE_DIALOG_OPEN.load(Ordering::SeqCst) {
                return;
            }
            let _ = app_handle.emit("dock-blur", ());
        });
        if let Some(monitor) =
            NSEvent::addGlobalMonitorForEventsMatchingMask_handler(mask, &block)
        {
            std::mem::forget(monitor);
        }
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
