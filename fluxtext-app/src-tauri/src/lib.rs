use std::fs;
use std::path::PathBuf;
use tauri::menu::{MenuBuilder, SubmenuBuilder};

/// 配置根目录: ~/.local/fluxtext
fn config_dir() -> Result<PathBuf, String> {
    dirs_next_home()
        .map(|h| h.join(".local").join("fluxtext"))
        .ok_or_else(|| "Cannot resolve home directory".to_string())
}

#[tauri::command]
fn get_config_dir() -> Result<String, String> {
    config_dir().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn init_config_dir() -> Result<String, String> {
    let base = config_dir()?;
    let scripts_dir = base.join("scripts");
    let builtin_dir = scripts_dir.join("builtin");
    fs::create_dir_all(&builtin_dir).map_err(|e| e.to_string())?;
    Ok(base.to_string_lossy().to_string())
}

#[tauri::command]
fn read_scripts_dir(path: String) -> Result<Vec<ScriptFile>, String> {
    let dir = expand_path(&path);
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    let mut scripts = Vec::new();
    // 递归读取目录（含 builtin 子目录）
    collect_scripts(&dir, &mut scripts)?;
    Ok(scripts)
}

fn collect_scripts(dir: &PathBuf, scripts: &mut Vec<ScriptFile>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            collect_scripts(&path, scripts)?;
        } else if let Some(ext) = path.extension() {
            if ext == "ts" || ext == "js" {
                let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                let content = fs::read_to_string(&path).unwrap_or_default();
                // 判断是否在 builtin 子目录下
                let is_builtin = path.components().any(|c| c.as_os_str() == "builtin");
                scripts.push(ScriptFile {
                    name,
                    path: path.to_string_lossy().to_string(),
                    content,
                    builtin: is_builtin,
                });
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn save_script(path: String, content: String) -> Result<(), String> {
    let file_path = expand_path(&path);
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&file_path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_script(path: String) -> Result<(), String> {
    let file_path = expand_path(&path);
    fs::remove_file(&file_path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn fetch_url(url: String) -> Result<String, String> {
    let resp = reqwest::get(&url)
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))
}

#[derive(serde::Serialize, serde::Deserialize)]
struct ScriptFile {
    name: String,
    path: String,
    content: String,
    #[serde(default)]
    builtin: bool,
}

fn expand_path(path: &str) -> PathBuf {
    if path.starts_with("~/") || path.starts_with("~\\") {
        if let Some(home) = dirs_next_home() {
            return home.join(&path[2..]);
        }
    }
    PathBuf::from(path)
}

fn dirs_next_home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // 自定义菜单：移除 Cmd+H (Hide) 绑定，避免与编辑器的查找替换冲突
            let app_submenu = SubmenuBuilder::new(app, "FluxText")
                .about(None)
                .separator()
                .services()
                .separator()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;
            let edit_submenu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;
            let menu = MenuBuilder::new(app)
                .item(&app_submenu)
                .item(&edit_submenu)
                .build()?;
            app.set_menu(menu)?;

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config_dir,
            init_config_dir,
            read_scripts_dir,
            save_script,
            delete_script,
            fetch_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
