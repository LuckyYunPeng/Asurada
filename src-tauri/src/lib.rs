mod commands;
mod git;
mod preflight;
mod store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::list_projects,
            commands::add_project,
            commands::remove_project,
            commands::refresh_project_status,
            commands::check_environment,
            commands::preflight,
            commands::run_commit_push,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
