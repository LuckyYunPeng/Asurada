use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub const DEFAULT_TOGGLE_PANEL_SHORTCUT: &str = "Alt+Super+KeyG";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct SettingsFile {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    toggle_panel_shortcut: Option<String>,
}

pub fn settings_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("settings.json")
}

pub fn load_toggle_panel_shortcut(app_data_dir: &Path) -> String {
    let path = settings_path(app_data_dir);
    if !path.exists() {
        return DEFAULT_TOGGLE_PANEL_SHORTCUT.to_string();
    }
    let raw = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return DEFAULT_TOGGLE_PANEL_SHORTCUT.to_string(),
    };
    let file: SettingsFile = match serde_json::from_str(&raw) {
        Ok(f) => f,
        Err(_) => return DEFAULT_TOGGLE_PANEL_SHORTCUT.to_string(),
    };
    file.toggle_panel_shortcut
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_TOGGLE_PANEL_SHORTCUT.to_string())
}

pub fn save_toggle_panel_shortcut(app_data_dir: &Path, shortcut: &str) -> Result<(), String> {
    fs::create_dir_all(app_data_dir).map_err(|e| format!("创建数据目录失败: {e}"))?;
    let path = settings_path(app_data_dir);
    let mut file = if path.exists() {
        let raw = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&raw).unwrap_or_default()
    } else {
        SettingsFile::default()
    };
    file.toggle_panel_shortcut = Some(shortcut.to_string());
    let raw =
        serde_json::to_string_pretty(&file).map_err(|e| format!("序列化设置失败: {e}"))?;
    fs::write(&path, raw).map_err(|e| format!("写入设置失败: {e}"))
}
