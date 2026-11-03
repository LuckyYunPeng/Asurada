use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub const DEFAULT_TOGGLE_PANEL_SHORTCUT: &str = "Alt+Super+KeyG";
pub const DEFAULT_DIFF_WINDOW_SIZE: (f64, f64) = (1680.0, 1050.0);
pub const MIN_DIFF_WINDOW_SIZE: (f64, f64) = (720.0, 480.0);

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct SettingsFile {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    toggle_panel_shortcut: Option<String>,
    /// 逻辑像素 [宽, 高]；用户拖拽或在设置里改过才有值
    #[serde(default, skip_serializing_if = "Option::is_none")]
    diff_window_size: Option<[f64; 2]>,
}

pub fn settings_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("settings.json")
}

/// 文件不存在或损坏时按默认值处理
fn load_settings(app_data_dir: &Path) -> SettingsFile {
    fs::read_to_string(settings_path(app_data_dir))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn save_settings(app_data_dir: &Path, file: &SettingsFile) -> Result<(), String> {
    fs::create_dir_all(app_data_dir).map_err(|e| format!("创建数据目录失败: {e}"))?;
    let raw =
        serde_json::to_string_pretty(file).map_err(|e| format!("序列化设置失败: {e}"))?;
    fs::write(settings_path(app_data_dir), raw).map_err(|e| format!("写入设置失败: {e}"))
}

pub fn load_toggle_panel_shortcut(app_data_dir: &Path) -> String {
    load_settings(app_data_dir)
        .toggle_panel_shortcut
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_TOGGLE_PANEL_SHORTCUT.to_string())
}

pub fn save_toggle_panel_shortcut(app_data_dir: &Path, shortcut: &str) -> Result<(), String> {
    let mut file = load_settings(app_data_dir);
    file.toggle_panel_shortcut = Some(shortcut.to_string());
    save_settings(app_data_dir, &file)
}

pub fn load_diff_window_size(app_data_dir: &Path) -> (f64, f64) {
    load_settings(app_data_dir)
        .diff_window_size
        .map(|[w, h]| (w, h))
        .unwrap_or(DEFAULT_DIFF_WINDOW_SIZE)
}

/// 返回实际保存的值（不小于最小尺寸）
pub fn save_diff_window_size(
    app_data_dir: &Path,
    width: f64,
    height: f64,
) -> Result<(f64, f64), String> {
    if !width.is_finite() || !height.is_finite() {
        return Err("窗口尺寸无效".to_string());
    }
    let size = (
        width.round().max(MIN_DIFF_WINDOW_SIZE.0),
        height.round().max(MIN_DIFF_WINDOW_SIZE.1),
    );
    let mut file = load_settings(app_data_dir);
    file.diff_window_size = Some([size.0, size.1]);
    save_settings(app_data_dir, &file)?;
    Ok(size)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diff_window_size_round_trip_keeps_other_settings() {
        let dir = std::env::temp_dir().join(format!("asurada-settings-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        assert_eq!(load_diff_window_size(&dir), DEFAULT_DIFF_WINDOW_SIZE);

        save_toggle_panel_shortcut(&dir, "Alt+Super+KeyK").unwrap();
        assert_eq!(save_diff_window_size(&dir, 1200.4, 300.0).unwrap(), (1200.0, 480.0));
        assert_eq!(load_diff_window_size(&dir), (1200.0, 480.0));
        assert_eq!(load_toggle_panel_shortcut(&dir), "Alt+Super+KeyK");
        assert!(save_diff_window_size(&dir, f64::NAN, 800.0).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
}
