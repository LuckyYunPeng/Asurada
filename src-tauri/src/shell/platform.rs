use tauri::{LogicalPosition, LogicalSize, WebviewWindow};

const WINDOW_LABEL: &str = "main";

/// Collapsed: tag strip only. Expanded: tag + floating panel (matches App.css).
const COLLAPSED_SIZE: (f64, f64) = (48.0, 200.0);
const EXPANDED_SIZE: (f64, f64) = (448.0, 640.0);

fn dock_window(window: &WebviewWindow, expanded: bool) -> Result<(), String> {
    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .or_else(|| window.primary_monitor().ok().flatten())
        .ok_or_else(|| "未找到显示器".to_string())?;

    let scale = monitor.scale_factor();
    let mon_pos = monitor.position().to_logical::<f64>(scale);
    let mon_size = monitor.size().to_logical::<f64>(scale);

    let (w, h) = if expanded {
        EXPANDED_SIZE
    } else {
        COLLAPSED_SIZE
    };

    let x = mon_pos.x + mon_size.width - w;
    let y = mon_pos.y + (mon_size.height - h) / 2.0;

    window
        .set_size(LogicalSize::new(w, h))
        .map_err(|e| e.to_string())?;
    window
        .set_position(LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{dock_window, WINDOW_LABEL};
    use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
    use tauri_nspanel::{
        tauri_panel, CollectionBehavior, ManagerExt, PanelLevel, StyleMask, WebviewWindowExt,
    };

    tauri_panel! {
        panel!(AsuradaPanel {
            config: {
                can_become_key_window: true,
                is_floating_panel: true,
            }
        })

        panel_event!(AsuradaPanelEvents {
            window_did_resign_key(notification: &NSNotification) -> (),
        })
    }

    fn configure_panel(window: &WebviewWindow) -> Result<(), String> {
        let panel = window
            .to_panel::<AsuradaPanel>()
            .map_err(|e| format!("无法转换为 NSPanel: {e}"))?;

        panel.set_level(PanelLevel::Floating.value());

        panel.set_collection_behavior(
            CollectionBehavior::new()
                .can_join_all_spaces()
                .full_screen_auxiliary()
                .move_to_active_space()
                .value(),
        );

        let handler = AsuradaPanelEvents::new();
        let app = window.app_handle().clone();
        handler.window_did_resign_key(move |_| {
            let _ = app.emit("asurada-shell-collapse", ());
        });
        panel.set_event_handler(Some(handler.as_ref()));

        panel.set_style_mask(StyleMask::empty().nonactivating_panel().into());

        Ok(())
    }

    pub fn setup(app: &AppHandle) -> Result<(), String> {
        let window = app
            .get_webview_window(WINDOW_LABEL)
            .ok_or_else(|| format!("缺少窗口 {WINDOW_LABEL}"))?;

        configure_panel(&window)?;

        dock_window(&window, false)?;

        if let Ok(panel) = app.get_webview_panel(WINDOW_LABEL) {
            panel.show();
        }

        Ok(())
    }

    pub fn sync_layout(app: &AppHandle, expanded: bool) -> Result<(), String> {
        let window = app
            .get_webview_window(WINDOW_LABEL)
            .ok_or_else(|| format!("缺少窗口 {WINDOW_LABEL}"))?;

        dock_window(&window, expanded)?;

        if let Ok(panel) = app.get_webview_panel(WINDOW_LABEL) {
            if expanded {
                panel.show_and_make_key();
            } else {
                panel.show();
            }
        }

        Ok(())
    }
}

#[cfg(not(target_os = "macos"))]
mod macos {
    use super::{dock_window, WINDOW_LABEL};
    use tauri::{AppHandle, Manager};

    pub fn setup(app: &AppHandle) -> Result<(), String> {
        let window = app
            .get_webview_window(WINDOW_LABEL)
            .ok_or_else(|| format!("缺少窗口 {WINDOW_LABEL}"))?;
        dock_window(&window, false)?;
        window.show().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn sync_layout(app: &AppHandle, expanded: bool) -> Result<(), String> {
        let window = app
            .get_webview_window(WINDOW_LABEL)
            .ok_or_else(|| format!("缺少窗口 {WINDOW_LABEL}"))?;
        dock_window(&window, expanded)?;
        if expanded {
            let _ = window.set_focus();
        }
        Ok(())
    }
}

pub use macos::{setup, sync_layout};
