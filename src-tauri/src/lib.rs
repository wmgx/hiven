use std::fs;
use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::menu::{MenuBuilder, SubmenuBuilder};
use zip::ZipArchive;

pub mod hotkeys;

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
    let plugins_dir = base.join("plugins");
    let plugin_builtin_dir = plugins_dir.join("builtin");
    let plugin_installed_dir = plugins_dir.join("installed");
    let plugin_dev_dir = plugins_dir.join("dev");
    fs::create_dir_all(&builtin_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&plugin_builtin_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&plugin_installed_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&plugin_dev_dir).map_err(|e| e.to_string())?;
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
                let name = path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
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
fn read_file(path: String) -> Result<String, String> {
    let file_path = expand_path(&path);
    fs::read_to_string(&file_path).map_err(|e| e.to_string())
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

#[derive(serde::Serialize)]
struct PluginDirSummary {
    #[serde(rename = "pluginId")]
    plugin_id: String,
    #[serde(rename = "displayName")]
    display_name: String,
    #[serde(rename = "displayNameI18n", skip_serializing_if = "Option::is_none")]
    display_name_i18n: Option<serde_json::Value>,
    version: String,
    entry: String,
    capabilities: Vec<String>,
    #[serde(rename = "folderPath")]
    folder_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(serde::Serialize)]
struct PluginFileNode {
    name: String,
    path: String,
    #[serde(rename = "isDir")]
    is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    children: Option<Vec<PluginFileNode>>,
}

#[tauri::command]
fn list_plugin_dirs(path: String) -> Result<Vec<PluginDirSummary>, String> {
    let root = expand_path(&path);
    ensure_plugin_path_for_write(&root)?;
    if !root.exists() {
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    }
    let root = ensure_existing_plugin_path(&root)?;

    let mut plugins = Vec::new();
    for entry in fs::read_dir(&root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let folder = entry.path();
        if folder.is_dir() && folder.join("manifest.json").exists() {
            match read_plugin_manifest_summary(&folder) {
                Ok(summary) => plugins.push(summary),
                Err(error) => {
                    let plugin_id = folder
                        .file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or("invalid-plugin")
                        .to_string();
                    plugins.push(PluginDirSummary {
                        plugin_id: plugin_id.clone(),
                        display_name: plugin_id,
                        display_name_i18n: None,
                        version: "0.0.0".to_string(),
                        entry: "".to_string(),
                        capabilities: Vec::new(),
                        folder_path: folder.to_string_lossy().to_string(),
                        error: Some(error),
                    });
                }
            }
        }
    }
    Ok(plugins)
}

#[tauri::command]
fn remove_plugin_dir(root_path: String, plugin_id: String) -> Result<(), String> {
    validate_plugin_id(&plugin_id)?;
    let root = ensure_existing_plugin_path(&expand_path(&root_path))?;
    if !root.is_dir() {
        return Err("Plugin root path is not a directory".to_string());
    }
    let target = root.join(plugin_id);
    if !target.exists() {
        return Ok(());
    }
    let target = ensure_existing_plugin_path(&target)?;
    if !target.starts_with(&root) || target == root {
        return Err("Plugin removal target must stay inside the plugin root".to_string());
    }
    if !target.is_dir() {
        return Err("Plugin removal target is not a directory".to_string());
    }
    fs::remove_dir_all(target).map_err(|e| e.to_string())
}

#[tauri::command]
fn replace_plugin_dir(source_path: String, root_path: String, plugin_id: String) -> Result<(), String> {
    validate_plugin_id(&plugin_id)?;
    let source = ensure_existing_plugin_path(&expand_path(&source_path))?;
    if !source.is_dir() {
        return Err("Plugin replacement source is not a directory".to_string());
    }
    let summary = read_plugin_manifest_summary(&source)?;
    if summary.plugin_id != plugin_id {
        return Err("Plugin replacement source manifest does not match pluginId".to_string());
    }

    let root = ensure_existing_plugin_path(&expand_path(&root_path))?;
    if !root.is_dir() {
        return Err("Plugin root path is not a directory".to_string());
    }
    let destination = root.join(&plugin_id);
    if !destination.starts_with(&root) || destination == root {
        return Err("Plugin replacement target must stay inside the plugin root".to_string());
    }

    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let backup = root.join(format!(".plugin-backup-{}-{}", plugin_id, millis));
    if backup.exists() {
        fs::remove_dir_all(&backup).map_err(|e| e.to_string())?;
    }

    let had_existing = destination.exists();
    if had_existing {
        fs::rename(&destination, &backup).map_err(|e| e.to_string())?;
    }

    let replace_result: Result<(), String> = match fs::rename(&source, &destination) {
        Ok(()) => Ok(()),
        Err(_) => {
            copy_dir_all(&source, &destination)?;
            fs::remove_dir_all(&source).map_err(|e| e.to_string())
        }
    };

    match replace_result {
        Ok(()) => {
            if backup.exists() {
                let _ = fs::remove_dir_all(&backup);
            }
            Ok(())
        }
        Err(error) => {
            let _ = if destination.exists() {
                fs::remove_dir_all(&destination)
            } else {
                Ok(())
            };
            if had_existing && backup.exists() {
                let _ = fs::rename(&backup, &destination);
            }
            Err(error.to_string())
        }
    }
}

#[tauri::command]
fn list_plugin_files(path: String) -> Result<Vec<PluginFileNode>, String> {
    let root = ensure_existing_plugin_path(&expand_path(&path))?;
    if !root.is_dir() {
        return Err("Plugin path is not a directory".to_string());
    }
    collect_plugin_files(&root)
}

#[tauri::command]
fn open_plugin_dir(path: String) -> Result<(), String> {
    let dir = ensure_existing_plugin_path(&expand_path(&path))?;
    if !dir.is_dir() {
        return Err("Plugin path is not a directory".to_string());
    }
    let dir_str = dir.to_string_lossy().to_string();

    // Prefer opening in VS Code (`code` CLI) when available.
    let code_command = if cfg!(target_os = "windows") { "code.cmd" } else { "code" };
    if std::process::Command::new(code_command)
        .arg(&dir_str)
        .spawn()
        .is_ok()
    {
        return Ok(());
    }

    // Fall back to the system file manager.
    let (program, args): (&str, Vec<&str>) = if cfg!(target_os = "macos") {
        ("open", vec![dir_str.as_str()])
    } else if cfg!(target_os = "windows") {
        ("explorer", vec![dir_str.as_str()])
    } else {
        ("xdg-open", vec![dir_str.as_str()])
    };
    std::process::Command::new(program)
        .args(&args)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn read_plugin_file(path: String) -> Result<String, String> {
    let file_path = ensure_existing_plugin_path(&expand_path(&path))?;
    ensure_plugin_text_file(&file_path)?;
    fs::read_to_string(&file_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_plugin_file(path: String, content: String) -> Result<(), String> {
    let file_path = expand_path(&path);
    ensure_plugin_path_for_write(&file_path)?;
    ensure_plugin_text_file(&file_path)?;
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&file_path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn install_plugin_zip(zip_path: String, destination_root: String) -> Result<String, String> {
    let zip_path = expand_path(&zip_path);
    let destination_root = expand_path(&destination_root);
    ensure_plugin_path_for_write(&destination_root)?;
    fs::create_dir_all(&destination_root).map_err(|e| e.to_string())?;
    let destination_root = ensure_existing_plugin_path(&destination_root)?;
    let temp_dir = make_temp_dir(&destination_root)?;
    let result = extract_zip_to_dir(&zip_path, &temp_dir)
        .and_then(|_| install_package_from_extracted_dir(&temp_dir, &destination_root));
    let _ = fs::remove_dir_all(&temp_dir);
    result
}

#[tauri::command]
async fn install_plugin_zip_url(url: String, destination_root: String) -> Result<String, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Plugin zip URL must use http or https".to_string());
    }
    let destination_root = expand_path(&destination_root);
    ensure_plugin_path_for_write(&destination_root)?;
    fs::create_dir_all(&destination_root).map_err(|e| e.to_string())?;
    let destination_root = ensure_existing_plugin_path(&destination_root)?;
    let bytes = reqwest::get(parsed)
        .await
        .map_err(|e| format!("Plugin zip download failed: {}", e))?
        .bytes()
        .await
        .map_err(|e| format!("Failed to read plugin zip response: {}", e))?;
    let temp_dir = make_temp_dir(&destination_root)?;
    let result = extract_zip_bytes_to_dir(bytes.as_ref(), &temp_dir)
        .and_then(|_| install_package_from_extracted_dir(&temp_dir, &destination_root));
    let _ = fs::remove_dir_all(&temp_dir);
    result
}

#[tauri::command]
fn install_plugin_dir(source_path: String, destination_root: String) -> Result<String, String> {
    let source_path = expand_path(&source_path);
    if !source_path.is_dir() {
        return Err("Plugin source path is not a directory".to_string());
    }
    let destination_root = expand_path(&destination_root);
    ensure_plugin_path_for_write(&destination_root)?;
    fs::create_dir_all(&destination_root).map_err(|e| e.to_string())?;
    let destination_root = ensure_existing_plugin_path(&destination_root)?;
    let package_root = if source_path.join("manifest.json").exists() {
        source_path
    } else {
        find_manifest_root(&source_path)?
    };
    let summary = read_plugin_manifest_summary(&package_root)?;
    validate_plugin_id(&summary.plugin_id)?;
    let destination = destination_root.join(&summary.plugin_id);
    if destination.exists() {
        return Err(format!("Plugin {} is already installed", summary.plugin_id));
    }
    copy_dir_all(&package_root, &destination)?;
    Ok(destination.to_string_lossy().to_string())
}

#[tauri::command]
async fn fetch_github_directory(
    owner: String,
    repo: String,
    branch: String,
    path: String,
    destination_root: String,
) -> Result<String, String> {
    let destination_root = expand_path(&destination_root);
    ensure_plugin_path_for_write(&destination_root)?;
    fs::create_dir_all(&destination_root).map_err(|e| e.to_string())?;
    let destination_root = ensure_existing_plugin_path(&destination_root)?;
    let archive_url = format!("https://codeload.github.com/{}/{}/zip/refs/heads/{}", owner, repo, branch);
    let bytes = reqwest::get(&archive_url)
        .await
        .map_err(|e| format!("GitHub download failed: {}", e))?
        .bytes()
        .await
        .map_err(|e| format!("Failed to read GitHub archive: {}", e))?;

    let temp_dir = make_temp_dir(&destination_root)?;
    let result = extract_zip_bytes_to_dir(bytes.as_ref(), &temp_dir).and_then(|_| {
        let package_root = if path.trim().is_empty() {
            find_manifest_root(&temp_dir)?
        } else {
            validate_plugin_relative_path(&path, "GitHub directory path")?;
            let top = first_child_dir(&temp_dir)?;
            let candidate = top.join(path.trim_start_matches('/'));
            let canonical_candidate = candidate.canonicalize().map_err(|e| e.to_string())?;
            let canonical_top = top.canonicalize().map_err(|e| e.to_string())?;
            if !canonical_candidate.starts_with(&canonical_top) {
                return Err("GitHub directory path must stay inside the repository archive".to_string());
            }
            if !candidate.join("manifest.json").exists() {
                return Err("GitHub directory does not contain manifest.json".to_string());
            }
            candidate
        };
        install_package_dir(&package_root, &destination_root)
    });
    let _ = fs::remove_dir_all(&temp_dir);
    result
}

#[derive(serde::Serialize, serde::Deserialize)]
struct ScriptFile {
    name: String,
    path: String,
    content: String,
    #[serde(default)]
    builtin: bool,
}

fn read_plugin_manifest_summary(folder: &Path) -> Result<PluginDirSummary, String> {
    let raw = fs::read_to_string(folder.join("manifest.json")).map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let plugin_id = value
        .get("pluginId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "manifest.json is missing pluginId".to_string())?
        .to_string();
    validate_plugin_id(&plugin_id)?;
    let display_name = value
        .get("displayName")
        .and_then(|v| v.as_str())
        .unwrap_or(&plugin_id)
        .to_string();
    let display_name_i18n = value.get("displayNameI18n").cloned();
    let version = value
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("0.0.0")
        .to_string();
    if value.get("entry").is_some() {
        return Err("manifest.json must not declare entry; use a fixed index.* plugin entry".to_string());
    }
    let entry = find_fixed_plugin_entry(folder)?;
    let capabilities = value
        .get("capabilities")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    Ok(PluginDirSummary {
        plugin_id,
        display_name,
        display_name_i18n,
        version,
        entry,
        capabilities,
        folder_path: folder.to_string_lossy().to_string(),
        error: None,
    })
}

fn collect_plugin_files(dir: &Path) -> Result<Vec<PluginFileNode>, String> {
    let mut nodes = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if should_skip_plugin_path(&name) {
            continue;
        }
        if metadata.is_dir() {
            nodes.push(PluginFileNode {
                name,
                path: path.to_string_lossy().to_string(),
                is_dir: true,
                children: Some(collect_plugin_files(&path)?),
            });
        } else if is_allowed_plugin_text_file(&path) {
            nodes.push(PluginFileNode {
                name,
                path: path.to_string_lossy().to_string(),
                is_dir: false,
                children: None,
            });
        }
    }
    nodes.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.cmp(&b.name)));
    Ok(nodes)
}

fn should_skip_plugin_path(name: &str) -> bool {
    matches!(name, "node_modules" | "dist" | ".git" | "target")
}

fn is_allowed_plugin_text_file(path: &Path) -> bool {
    if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
        if matches!(name, ".keep") {
            return true;
        }
    }
    matches!(
        path.extension().and_then(|s| s.to_str()).unwrap_or_default(),
        "js" | "ts" | "jsx" | "tsx" | "json" | "css" | "md" | "txt" | "html" | "yml" | "yaml"
    )
}

fn ensure_plugin_text_file(path: &Path) -> Result<(), String> {
    if is_allowed_plugin_text_file(path) {
        Ok(())
    } else {
        Err("Plugin file type is not editable as text".to_string())
    }
}

fn validate_plugin_id(plugin_id: &str) -> Result<(), String> {
    if plugin_id.is_empty()
        || plugin_id == "."
        || plugin_id == ".."
        || plugin_id.contains('/')
        || plugin_id.contains('\\')
        || !plugin_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err("Plugin manifest pluginId must be a plain package id".to_string());
    }
    Ok(())
}

fn validate_plugin_relative_path(value: &str, label: &str) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.contains('\\')
        || trimmed.contains('?')
        || trimmed.contains('#')
        || trimmed.contains(':')
        || trimmed.split('/').any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return Err(format!("{} must be a package-relative path", label));
    }

    let path = Path::new(trimmed);
    if path.is_absolute()
        || path.components().any(|component| {
            !matches!(component, Component::Normal(_))
        })
    {
        return Err(format!("{} must be a package-relative path", label));
    }
    Ok(())
}

fn find_fixed_plugin_entry(folder: &Path) -> Result<String, String> {
    for entry in ["index.tsx", "index.ts", "index.jsx", "index.js", "index.mjs"] {
        let candidate = folder.join(entry);
        if candidate.exists() && candidate.is_file() {
            validate_plugin_relative_path(entry, "plugin entry")?;
            return Ok(entry.to_string());
        }
    }
    Err("Plugin package must include one fixed entry file: index.tsx, index.ts, index.jsx, index.js, or index.mjs".to_string())
}

fn plugin_root_dir() -> Result<PathBuf, String> {
    let root = config_dir()?.join("plugins");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    root.canonicalize().map_err(|e| e.to_string())
}

fn has_parent_component(path: &Path) -> bool {
    path.components().any(|component| matches!(component, Component::ParentDir))
}

fn ensure_existing_plugin_path(path: &Path) -> Result<PathBuf, String> {
    let root = plugin_root_dir()?;
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    if canonical.starts_with(&root) {
        Ok(canonical)
    } else {
        Err("Plugin file access is restricted to the FluxText plugins directory".to_string())
    }
}

fn ensure_plugin_path_for_write(path: &Path) -> Result<(), String> {
    if has_parent_component(path) {
        return Err("Plugin paths may not contain parent directory components".to_string());
    }
    if let Ok(metadata) = fs::symlink_metadata(path) {
        if metadata.file_type().is_symlink() {
            return Err("Plugin file writes may not target symlinks".to_string());
        }
        return ensure_existing_plugin_path(path).map(|_| ());
    }
    let root = plugin_root_dir()?;
    let mut ancestor = path.parent().unwrap_or(path).to_path_buf();
    while !ancestor.exists() {
        let Some(parent) = ancestor.parent() else {
            return Err("Cannot resolve plugin path parent".to_string());
        };
        ancestor = parent.to_path_buf();
    }
    let canonical_parent = ancestor.canonicalize().map_err(|e| e.to_string())?;
    if canonical_parent.starts_with(&root) {
        Ok(())
    } else {
        Err("Plugin file writes are restricted to the FluxText plugins directory".to_string())
    }
}

fn make_temp_dir(parent: &Path) -> Result<PathBuf, String> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let dir = parent.join(format!(".plugin-tmp-{}", millis));
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn extract_zip_to_dir(zip_path: &Path, target: &Path) -> Result<(), String> {
    let file = fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| e.to_string())?;
    extract_zip_archive(&mut archive, target)
}

fn extract_zip_bytes_to_dir(bytes: &[u8], target: &Path) -> Result<(), String> {
    let reader = Cursor::new(bytes);
    let mut archive = ZipArchive::new(reader).map_err(|e| e.to_string())?;
    extract_zip_archive(&mut archive, target)
}

fn extract_zip_archive<R: Read + std::io::Seek>(archive: &mut ZipArchive<R>, target: &Path) -> Result<(), String> {
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let enclosed = file
            .enclosed_name()
            .ok_or_else(|| "Zip archive contains an unsafe path".to_string())?
            .to_owned();
        let out_path = target.join(enclosed);
        if file.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out = fs::File::create(&out_path).map_err(|e| e.to_string())?;
        std::io::copy(&mut file, &mut out).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn install_package_from_extracted_dir(extracted_root: &Path, destination_root: &Path) -> Result<String, String> {
    let package_root = find_manifest_root(extracted_root)?;
    install_package_dir(&package_root, destination_root)
}

fn find_manifest_root(root: &Path) -> Result<PathBuf, String> {
    if root.join("manifest.json").exists() {
        return Ok(root.to_path_buf());
    }
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            if let Ok(found) = find_manifest_root(&path) {
                return Ok(found);
            }
        }
    }
    Err("Plugin package manifest.json was not found".to_string())
}

fn first_child_dir(root: &Path) -> Result<PathBuf, String> {
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            return Ok(path);
        }
    }
    Err("Archive did not contain a directory".to_string())
}

fn install_package_dir(package_root: &Path, destination_root: &Path) -> Result<String, String> {
    let summary = read_plugin_manifest_summary(package_root)?;
    validate_plugin_id(&summary.plugin_id)?;
    let destination = destination_root.join(&summary.plugin_id);
    if destination.exists() {
        return Err(format!("Plugin {} is already installed", summary.plugin_id));
    }
    match fs::rename(package_root, &destination) {
        Ok(()) => {}
        Err(_) => {
            copy_dir_all(package_root, &destination)?;
            fs::remove_dir_all(package_root).map_err(|e| e.to_string())?;
        }
    }
    Ok(destination.to_string_lossy().to_string())
}

fn copy_dir_all(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let source_path = entry.path();
        let metadata = fs::symlink_metadata(&source_path).map_err(|e| e.to_string())?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        let destination_path = destination.join(entry.file_name());
        if metadata.is_dir() {
            copy_dir_all(&source_path, &destination_path)?;
        } else {
            fs::copy(&source_path, &destination_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
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
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // 构建 Edit 子菜单（macOS 需要原生 Edit 菜单才能让剪贴板快捷键生效）
            // 注意：不加 Undo/Redo，否则会拦截 Monaco 自己的撤销栈
            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;
            let menu = MenuBuilder::new(app).item(&edit_menu).build()?;
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
            read_file,
            fetch_url,
            list_plugin_dirs,
            remove_plugin_dir,
            replace_plugin_dir,
            list_plugin_files,
            open_plugin_dir,
            read_plugin_file,
            save_plugin_file,
            install_plugin_dir,
            install_plugin_zip,
            install_plugin_zip_url,
            fetch_github_directory,
            hotkeys::register_double_cmd_hotkey,
            hotkeys::unregister_double_cmd_hotkey,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod plugin_dir_command_tests {
    use super::*;
    use std::env;

    fn unique_home(label: &str) -> PathBuf {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("test clock should be after epoch")
            .as_millis();
        env::temp_dir().join(format!("fluxtext-{}-{}-{}", label, std::process::id(), millis))
    }

    fn with_isolated_home<T>(label: &str, test: impl FnOnce(PathBuf) -> T) -> T {
        let previous_home = env::var_os("HOME");
        let home = unique_home(label);
        fs::create_dir_all(&home).expect("test home should be created");
        env::set_var("HOME", &home);
        let result = test(home.clone());
        if let Some(value) = previous_home {
            env::set_var("HOME", value);
        } else {
            env::remove_var("HOME");
        }
        let _ = fs::remove_dir_all(home);
        result
    }

    #[test]
    fn fixed_entry_summary_and_file_commands_round_trip() {
        with_isolated_home("plugin-round-trip", |_| {
            let config = PathBuf::from(init_config_dir().expect("config dir should initialize"));
            let installed = config.join("plugins").join("installed");
            let plugin = installed.join("authoring-e2e");

            save_plugin_file(
                plugin.join("manifest.json").to_string_lossy().to_string(),
                r#"{
  "pluginId": "authoring-e2e",
  "displayName": "Authoring E2E",
  "displayNameI18n": { "zh": "插件创作验证" },
  "version": "1.0.0",
  "capabilities": ["command"]
}"#.to_string(),
            )
            .expect("manifest should be writable under plugins root");
            save_plugin_file(
                plugin.join("index.js").to_string_lossy().to_string(),
                "export default { id: 'authoring-e2e', version: '1.0.0' }".to_string(),
            )
            .expect("index.js should be writable");
            save_plugin_file(
                plugin.join("index.ts").to_string_lossy().to_string(),
                "export default { id: 'authoring-e2e', version: '1.0.0' }".to_string(),
            )
            .expect("index.ts should be writable");
            save_plugin_file(
                plugin.join("README.md").to_string_lossy().to_string(),
                "# Authoring E2E".to_string(),
            )
            .expect("README should be writable");

            let summaries = list_plugin_dirs(installed.to_string_lossy().to_string())
                .expect("installed plugin root should list");
            assert_eq!(summaries.len(), 1);
            let summary = &summaries[0];
            assert_eq!(summary.plugin_id, "authoring-e2e");
            assert_eq!(summary.display_name, "Authoring E2E");
            assert_eq!(summary.entry, "index.ts");
            assert_eq!(summary.capabilities, vec!["command".to_string()]);
            assert_eq!(
                summary
                    .display_name_i18n
                    .as_ref()
                    .and_then(|value| value.get("zh"))
                    .and_then(|value| value.as_str()),
                Some("插件创作验证"),
            );

            let files = list_plugin_files(plugin.to_string_lossy().to_string())
                .expect("plugin file tree should list");
            let names: Vec<String> = files.iter().map(|node| node.name.clone()).collect();
            assert!(names.contains(&"manifest.json".to_string()));
            assert!(names.contains(&"index.ts".to_string()));
            assert!(names.contains(&"README.md".to_string()));

            let readme = read_plugin_file(plugin.join("README.md").to_string_lossy().to_string())
                .expect("editable plugin files should be readable");
            assert_eq!(readme, "# Authoring E2E");
        });
    }

    #[test]
    fn rejects_manifest_entry_and_parent_path_writes() {
        with_isolated_home("plugin-rejects", |_| {
            let config = PathBuf::from(init_config_dir().expect("config dir should initialize"));
            let installed = config.join("plugins").join("installed");
            let plugin = installed.join("bad-entry");

            save_plugin_file(
                plugin.join("manifest.json").to_string_lossy().to_string(),
                r#"{
  "pluginId": "bad-entry",
  "displayName": "Bad Entry",
  "entry": "custom.js",
  "version": "1.0.0"
}"#.to_string(),
            )
            .expect("manifest should be writable before validation");
            save_plugin_file(
                plugin.join("index.js").to_string_lossy().to_string(),
                "export default { id: 'bad-entry', version: '1.0.0' }".to_string(),
            )
            .expect("index.js should be writable");

            let summaries = list_plugin_dirs(installed.to_string_lossy().to_string())
                .expect("malformed plugin packages should be returned as visible error summaries");
            assert_eq!(summaries.len(), 1);
            assert_eq!(summaries[0].plugin_id, "bad-entry");
            assert_eq!(summaries[0].entry, "");
            assert!(
                summaries[0]
                    .error
                    .as_ref()
                    .is_some_and(|error| error.contains("must not declare entry"))
            );

            let parent_path = installed.join("..").join("escape").join("index.js");
            let parent_error = save_plugin_file(
                parent_path.to_string_lossy().to_string(),
                "export default {}".to_string(),
            )
            .expect_err("plugin write paths with parent components should be rejected");
            assert!(parent_error.contains("parent directory"));
        });
    }
}
