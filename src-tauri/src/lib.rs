mod commands;
mod git;
mod preflight;
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
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            macos_panel::setup(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
