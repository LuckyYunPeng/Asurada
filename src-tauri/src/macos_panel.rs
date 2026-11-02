use tauri::{
    App, AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, Size, WebviewWindow,
};
use tauri_nspanel::{
    tauri_panel, CollectionBehavior, PanelLevel, StyleMask, WebviewWindowExt,
};

const DOCK_COLLAPSED: LogicalSize<f64> = LogicalSize::new(52.0, 148.0);
const DOCK_EXPANDED: LogicalSize<f64> = LogicalSize::new(452.0, 620.0);

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
    let y = ((mon_h as f64 * 0.36) - (phys_h as f64 / 2.0))
        .max(8.0)
        .round() as u32;

    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| format!("无法移动窗口: {e}"))?;
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

    place_dock_window(&window, false)?;
    panel.show();

    Ok(())
}

pub fn setup(app: &mut App) -> Result<(), String> {
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);
    init_panel(app.handle())?;
    Ok(())
}

#[tauri::command]
pub fn sync_dock_geometry(app: tauri::AppHandle, expanded: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "未找到主窗口".to_string())?;

    place_dock_window(&window, expanded)?;

    if expanded {
        if let Ok(panel) = window.to_panel::<AsuradaPanel>() {
            panel.show_and_make_key();
        }
    }

    Ok(())
}
