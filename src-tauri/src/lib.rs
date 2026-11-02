mod commands;
mod git;
mod preflight;
mod shell;
mod store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());

    builder
        .setup(|app| {
            shell::setup(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_projects,
            commands::add_project,
            commands::remove_project,
            commands::refresh_project_status,
            commands::check_environment,
            commands::preflight,
            commands::run_commit_push,
            commands::sync_shell_layout,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
