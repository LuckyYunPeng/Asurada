mod platform;

use tauri::AppHandle;

pub fn setup(app: &AppHandle) -> Result<(), String> {
    platform::setup(app)
}

pub fn sync_layout(app: &AppHandle, expanded: bool) -> Result<(), String> {
    platform::sync_layout(app, expanded)
}
