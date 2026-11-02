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
/// 收起态的第一下点击经常只用来激活窗口，到不了页面按钮。
static IS_PANEL_EXPANDED: AtomicBool = AtomicBool::new(true);
static IS_TAG_HOT: AtomicBool = AtomicBool::new(false);

const DOCK_COLLAPSED: LogicalSize<f64> = LogicalSize::new(48.0, 102.0);
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
    place_frame(window, logical, 0.0)
}

fn place_frame(
    window: &WebviewWindow,
    logical: LogicalSize<f64>,
    lift: f64,
) -> Result<(), String> {
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
    // 展开、收起共用面板顶边。悬停放大时以这块 tag 的中心往上抬，避免只往下长。
    let y = (origin.y
        + (mon.height * 0.36 - DOCK_EXPANDED.height / 2.0)
            .min(mon.height - DOCK_EXPANDED.height)
            .max(8.0)
        - lift)
        .max(origin.y + 8.0);

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
    use super::{apply_panel_open, IS_FILE_DIALOG_OPEN, IS_PANEL_EXPANDED, IS_TAG_HOT};
    use objc2_app_kit::{
        NSAutoresizingMaskOptions, NSCursor, NSEvent, NSEventMask, NSTrackingArea,
        NSTrackingAreaOptions, NSView, NSWindow,
    };
    use std::ffi::{c_char, c_int, c_void, CStr};
    use std::sync::atomic::{AtomicBool, AtomicPtr, Ordering};
    use std::sync::OnceLock;
    use tauri::{AppHandle, Emitter, Manager};
    use tauri_nspanel::objc2::rc::Retained;
    use tauri_nspanel::objc2::runtime::AnyObject;
    use tauri_nspanel::objc2::{define_class, msg_send, AllocAnyThread, MainThreadMarker, MainThreadOnly};
    use tauri_nspanel::objc2_foundation::NSPoint;

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static CURSOR_VIEW: AtomicPtr<TagCursorView> = AtomicPtr::new(std::ptr::null_mut());
    static IS_HAND_SHOWN: AtomicBool = AtomicBool::new(false);

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
                self.addCursorRect_cursor(self.bounds(), &NSCursor::pointingHandCursor());
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
                release_hand();
            }

            #[unsafe(method(acceptsFirstMouse:))]
            fn accepts_first_mouse(&self, _event: &NSEvent) -> bool {
                true
            }

            #[unsafe(method_id(hitTest:))]
            fn hit_test(&self, point: NSPoint) -> Option<Retained<NSView>> {
                if IS_PANEL_EXPANDED.load(Ordering::SeqCst) {
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
        IS_HAND_SHOWN.store(true, Ordering::SeqCst);
        NSCursor::pointingHandCursor().set();
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
        install_cursor_view(ns_window);
        install_collapsed_click(app_handle, ns_window.windowNumber());
        install_tag_hot(ns_window as *const NSWindow);
    }

    fn install_collapsed_click(app_handle: AppHandle, window_number: isize) {
        let block = block2::RcBlock::new(move |event: std::ptr::NonNull<NSEvent>| {
            let mouse_down = unsafe { event.as_ref() };
            if !IS_FILE_DIALOG_OPEN.load(Ordering::SeqCst)
                && !IS_PANEL_EXPANDED.load(Ordering::SeqCst)
                && mouse_down.windowNumber() == window_number
            {
                let _ = apply_panel_open(&app_handle, true);
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

    fn note_tag_hot(window: *const NSWindow) {
        let hot = !IS_PANEL_EXPANDED.load(Ordering::SeqCst)
            && !IS_FILE_DIALOG_OPEN.load(Ordering::SeqCst)
            && cursor_inside(window);
        if hot {
            show_hand();
        } else if IS_TAG_HOT.load(Ordering::SeqCst) {
            release_hand();
        }
    }

    fn cursor_inside(window: *const NSWindow) -> bool {
        let mouse = NSEvent::mouseLocation();
        let frame = unsafe { &*window }.frame();
        mouse.x >= frame.origin.x
            && mouse.x < frame.origin.x + frame.size.width
            && mouse.y >= frame.origin.y
            && mouse.y < frame.origin.y + frame.size.height
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
