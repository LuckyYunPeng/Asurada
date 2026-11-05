mod agents;
mod commands;
mod commit_prompt;
mod git;
mod preflight;
mod prewarm;
mod scan;
mod settings;
mod store;

#[cfg(target_os = "macos")]
mod macos_panel;

/// Finder 启动的 App 只有系统默认 PATH，找不到 pi / nvm 的 node；从用户交互式登录 shell 取一次完整 PATH。
/// 检测 Agent 时也会重新取：用户刚装好的 Agent 往往会把自己的目录加进 shell 配置
#[cfg(target_os = "macos")]
pub(crate) fn inherit_shell_path() {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    // 用标记截取，避开 .zshrc 里可能打印的其它输出
    match std::process::Command::new(shell)
        .args(["-ilc", "printf '__ASURADA_PATH__%s__ASURADA_PATH__' \"$PATH\""])
        .stdin(std::process::Stdio::null())
        .output()
    {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(path) = stdout.split("__ASURADA_PATH__").nth(1) {
                if !path.is_empty() {
                    std::env::set_var("PATH", path);
                }
            }
        }
        Err(e) => eprintln!("Asurada: 读取 shell PATH 失败 ({e})"),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "macos")]
    inherit_shell_path();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

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
            commands::add_projects,
            commands::scan_git_repos,
            commands::remove_project,
            commands::refresh_project_status,
            commands::preflight,
            commands::list_agents,
            commands::set_agent,
            commands::test_agent,
            commands::run_commit_push,
            commands::prewarm_commit_messages,
            commands::run_pull,
            commands::discard_changes,
            commands::get_committing_ids,
            commands::get_project_diff,
            commands::open_diff_window,
            commands::get_diff_project_id,
            #[cfg(target_os = "macos")]
            commands::list_open_with_apps,
            #[cfg(target_os = "macos")]
            commands::open_with_app,
            #[cfg(target_os = "macos")]
            commands::copy_text,
            #[cfg(target_os = "macos")]
            commands::get_system_language,
            commands::get_diff_window_size,
            commands::set_diff_window_size,
            #[cfg(target_os = "macos")]
            macos_panel::sync_dock_geometry,
            #[cfg(target_os = "macos")]
            macos_panel::set_result_cloud,
            #[cfg(target_os = "macos")]
            macos_panel::reveal_dock,
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
            if let Err(e) = commands::build_diff_window(app.handle()) {
                eprintln!("Asurada: 预热 diff 窗口失败 ({e})，打开时再创建");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
