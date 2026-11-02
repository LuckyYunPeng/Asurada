use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredProject {
    pub id: String,
    pub path: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ProjectStoreFile {
    projects: Vec<StoredProject>,
}

pub fn store_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("projects.json")
}

pub fn load_projects(app_data_dir: &Path) -> Result<Vec<StoredProject>, String> {
    let path = store_path(app_data_dir);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("读取项目列表失败: {e}"))?;
    let file: ProjectStoreFile =
        serde_json::from_str(&raw).map_err(|e| format!("解析项目列表失败: {e}"))?;
    Ok(file.projects)
}

pub fn save_projects(app_data_dir: &Path, projects: &[StoredProject]) -> Result<(), String> {
    fs::create_dir_all(app_data_dir).map_err(|e| format!("创建数据目录失败: {e}"))?;
    let path = store_path(app_data_dir);
    let file = ProjectStoreFile {
        projects: projects.to_vec(),
    };
    let raw = serde_json::to_string_pretty(&file).map_err(|e| format!("序列化失败: {e}"))?;
    fs::write(&path, raw).map_err(|e| format!("写入项目列表失败: {e}"))
}

pub fn default_display_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(path)
        .to_string()
}
