use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    App, AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, Size, WebviewWindow,
};
use tauri_nspanel::{
    tauri_panel, CollectionBehavior, PanelLevel, StyleMask, WebviewWindowExt,
};

const DOCK_COLLAPSED: LogicalSize<f64> = LogicalSize::new(52.0, 148.0);
const DOCK_EXPANDED: LogicalSize<f64> = LogicalSize::new(452.0, 620.0);

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

fn monitor_anchor(window: &WebviewWindow) -> Option<(u32, u32, f64)> {
    let monitor = window.current_monitor().ok().flatten()?;
    let size = monitor.size();
    let scale = monitor.scale_factor();
    Some((size.width, size.height, scale))
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

    let (mon_w, mon_h, scale) =
        monitor_anchor(window).ok_or_else(|| "无法读取当前显示器".to_string())?;
    let phys_w = (logical.width * scale).round() as u32;
    let phys_h = (logical.height * scale).round() as u32;
    let x = mon_w.saturating_sub(phys_w);
    let y_anchor = mon_h as f64 * 0.36;
    let y_ideal = y_anchor - (phys_h as f64 / 2.0);
    let y_max = mon_h.saturating_sub(phys_h).max(0) as f64;
    let y = y_ideal.max(8.0).min(y_max).round() as i32;

    window
        .set_position(PhysicalPosition::new(x as i32, y))
        .map_err(|e| format!("无法移动窗口: {e}"))?;
    Ok(())
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

    let handler = AsuradaPanelHandler::new();
    let emit_handle = app_handle.clone();
    handler.window_did_resign_key(move |_notification| {
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
    match init_panel(app.handle()) {
        Ok(()) => Ok(()),
        Err(e) => {
            eprintln!("Asurada: NSPanel 初始化失败 ({e})，回退为普通置顶小窗");
            fallback_regular_window(app)
        }
    }
}

#[tauri::command]
pub fn sync_dock_geometry(app: tauri::AppHandle, expanded: bool) -> Result<(), String> {
    apply_panel_open(&app, expanded)
}
