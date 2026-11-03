mod commands;
mod git;
mod preflight;
mod settings;
mod store;

#[cfg(target_os = "macos")]
mod macos_panel;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());

    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_nspanel::init());
        builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());
        builder = builder.plugin(tauri_plugin_autostart::Builder::new().build());
    }

    builder
        .invoke_handler(tauri::generate_handler![
            commands::list_projects,
            commands::add_project,
            commands::remove_project,
            commands::refresh_project_status,
            commands::check_environment,
            commands::preflight,
            commands::run_commit_push,
            #[cfg(target_os = "macos")]
            macos_panel::sync_dock_geometry,
            #[cfg(target_os = "macos")]
            macos_panel::set_result_cloud,
            #[cfg(target_os = "macos")]
            macos_panel::pick_project_directory,
            #[cfg(target_os = "macos")]
            macos_panel::get_toggle_shortcut,
            #[cfg(target_os = "macos")]
            macos_panel::set_toggle_shortcut,
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                if let Err(e) = macos_panel::setup(app) {
                    eprintln!("Asurada: 边缘壳层 setup 失败 ({e})，尝试最后回退");
                    macos_panel::last_resort_show(app);
                }
                if let Err(e) = macos_panel::setup_tray(app) {
                    eprintln!("Asurada: 菜单栏图标创建失败 ({e})");
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
