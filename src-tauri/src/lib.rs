use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;
#[cfg(target_os = "macos")]
use std::ffi::{CStr, CString};
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
#[cfg(target_os = "macos")]
use std::time::Duration;
use tauri::menu::{MenuBuilder, SubmenuBuilder};
use tauri::Emitter;
use tauri::LogicalSize;
use zip::ZipArchive;

pub mod hotkeys;

const LAUNCHER_COMPACT_WIDTH: f64 = 660.0;
const LAUNCHER_COMPACT_HEIGHT: f64 = 160.0;
static PREVIOUS_FOREGROUND_PROCESS_ID: OnceLock<Mutex<Option<u32>>> = OnceLock::new();
static INSTALLED_APP_TARGETS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
const MAX_APP_ICON_CACHE_WARM_COUNT: usize = 20;

#[tauri::command]
fn show_and_focus_window(app: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let app_clone = app.clone();
        let _ = app.run_on_main_thread(move || {
            show_and_focus_main_window(&app_clone);
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        show_and_focus_main_window(&app);
    }
}

fn show_and_focus_main_window(app: &tauri::AppHandle) {
    use tauri::Manager;

    // Clear saved foreground app so that a subsequent hide_launcher_window
    // won't restore focus away from the main window we're about to show.
    if let Ok(mut stored) = previous_foreground_process_id().lock() {
        *stored = None;
    }

    if let Some(window) = app.get_webview_window("launcher") {
        let _ = window.hide();
    }

    activate_app();

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
async fn show_launcher_window(app: tauri::AppHandle) -> Result<(), String> {
    show_launcher_window_for_hotkey(app)
}

pub(crate) fn show_launcher_window_for_hotkey(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;

    let app_clone = app.clone();
    app.run_on_main_thread(move || {
        let existing_launcher = app_clone.get_webview_window("launcher");
        let was_visible = existing_launcher
            .as_ref()
            .and_then(|window| window.is_visible().ok())
            .unwrap_or(false);
        if !was_visible {
            remember_previous_foreground_app();
        }

        let window = if let Some(window) = existing_launcher {
            window
        } else {
            let Some(config) = app_clone
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "launcher")
                .cloned()
            else {
                eprintln!("[hiven] Launcher window config not found");
                return;
            };
            match tauri::WebviewWindowBuilder::from_config(&app_clone, &config)
                .and_then(|builder| builder.build())
            {
                Ok(window) => window,
                Err(error) => {
                    eprintln!("[hiven] Failed to create launcher window: {}", error);
                    return;
                }
            }
        };

        if !was_visible {
            if let Err(error) = window.set_size(LogicalSize::new(
                LAUNCHER_COMPACT_WIDTH,
                LAUNCHER_COMPACT_HEIGHT,
            )) {
                eprintln!(
                    "[hiven] Failed to compact launcher window before show: {}",
                    error
                );
            }
        }
        if let Err(error) = show_launcher_window_without_app_activation(&window) {
            eprintln!("[hiven] Failed to show launcher window: {}", error);
            return;
        }
        if !was_visible {
            // Position AFTER showing: on macOS a `set_position` on a hidden
            // window gets clobbered by the window's initial frame when it is
            // ordered front, leaving it at the OS default (bottom-right) spot.
            center_launcher_window(&window);
            let _ = window.emit("hiven://launcher-open", ());
        }
    })
    .map_err(|error| error.to_string())
}

/// Position the launcher window horizontally centered and in the upper portion
/// of the monitor under the cursor (Spotlight/Raycast style). Without this the
/// OS keeps the window at its last/default spot (often the bottom-right corner)
/// since the launcher config carries no position. The cursor's monitor is used
/// rather than `current_monitor()` so the launcher follows the active screen
/// instead of wherever the hidden window happened to live.
fn center_launcher_window(window: &tauri::WebviewWindow) {
    let monitor = monitor_under_cursor(window)
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else { return };

    let scale = monitor.scale_factor();
    let mon_pos = monitor.position();
    let mon_size = monitor.size();
    let win_w = (LAUNCHER_COMPACT_WIDTH * scale).round() as i32;
    let win_h = (LAUNCHER_COMPACT_HEIGHT * scale).round() as i32;

    let x = mon_pos.x + ((mon_size.width as i32 - win_w) / 2).max(0);
    // Keep the panel in the upper third so it stays anchored as the window
    // grows downward to fit results.
    let upper = ((mon_size.height as i32 - win_h) as f64 * 0.30).round() as i32;
    let y = mon_pos.y + upper.max(0);

    if let Err(error) = window.set_position(tauri::PhysicalPosition::new(x, y)) {
        eprintln!("[hiven] Failed to center launcher window: {}", error);
    }
}

/// Find the monitor that currently contains the mouse cursor (physical coords).
fn monitor_under_cursor(window: &tauri::WebviewWindow) -> Option<tauri::Monitor> {
    let cursor = window.cursor_position().ok()?;
    let monitors = window.available_monitors().ok()?;
    monitors.into_iter().find(|monitor| {
        let pos = monitor.position();
        let size = monitor.size();
        cursor.x >= pos.x as f64
            && cursor.x < pos.x as f64 + size.width as f64
            && cursor.y >= pos.y as f64
            && cursor.y < pos.y as f64 + size.height as f64
    })
}

#[tauri::command]
async fn hide_launcher_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;

    let app_clone = app.clone();
    app.run_on_main_thread(move || {
        if let Some(window) = app_clone.get_webview_window("launcher") {
            restore_previous_foreground_app();
            if let Err(error) = window.hide() {
                eprintln!("[hiven] Failed to hide launcher window: {}", error);
            }
        }
    })
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn simulate_paste() -> Result<(), String> {
    simulate_paste_impl()
}

#[cfg(target_os = "macos")]
fn simulate_paste_impl() -> Result<(), String> {
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

    const KEY_V: u16 = 9;
    let src = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
        .map_err(|_| "Failed to create event source")?;
    let dn = CGEvent::new_keyboard_event(src.clone(), KEY_V, true)
        .map_err(|_| "Failed to create key-down event")?;
    let up = CGEvent::new_keyboard_event(src, KEY_V, false)
        .map_err(|_| "Failed to create key-up event")?;
    dn.set_flags(CGEventFlags::CGEventFlagCommand);
    up.set_flags(CGEventFlags::CGEventFlagCommand);
    dn.post(CGEventTapLocation::HID);
    up.post(CGEventTapLocation::HID);
    Ok(())
}

#[cfg(target_os = "windows")]
fn simulate_paste_impl() -> Result<(), String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        VIRTUAL_KEY,
    };

    const VK_CONTROL: VIRTUAL_KEY = VIRTUAL_KEY(0x11);
    const VK_V: VIRTUAL_KEY = VIRTUAL_KEY(0x56);

    let make = |vk: VIRTUAL_KEY, flags: KEYBD_EVENT_FLAGS| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };

    let inputs = [
        make(VK_CONTROL, KEYBD_EVENT_FLAGS(0)),
        make(VK_V, KEYBD_EVENT_FLAGS(0)),
        make(VK_V, KEYEVENTF_KEYUP),
        make(VK_CONTROL, KEYEVENTF_KEYUP),
    ];

    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent == 4 {
        Ok(())
    } else {
        Err(format!("SendInput sent {} of 4 expected events", sent))
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn simulate_paste_impl() -> Result<(), String> {
    Err("Paste simulation is not supported on this platform".to_string())
}

fn previous_foreground_process_id() -> &'static Mutex<Option<u32>> {
    PREVIOUS_FOREGROUND_PROCESS_ID.get_or_init(|| Mutex::new(None))
}

fn remember_previous_foreground_app() {
    let previous = current_foreground_process_id().filter(|pid| *pid != std::process::id());
    if let Ok(mut stored) = previous_foreground_process_id().lock() {
        *stored = previous;
    }
}

fn restore_previous_foreground_app() {
    let previous = previous_foreground_process_id()
        .lock()
        .ok()
        .and_then(|mut stored| stored.take());
    if let Some(pid) = previous {
        activate_process(pid);
    }
}

fn show_launcher_window_without_app_activation(
    window: &tauri::WebviewWindow,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        show_launcher_window_without_app_activation_macos(window)
    }
    #[cfg(not(target_os = "macos"))]
    {
        window.show().map_err(|error| error.to_string())?;
        let _ = window.unminimize();
        window.set_focus().map_err(|error| error.to_string())
    }
}

#[cfg(target_os = "macos")]
fn show_launcher_window_without_app_activation_macos(
    window: &tauri::WebviewWindow,
) -> Result<(), String> {
    let ns_window = window.ns_window().map_err(|error| error.to_string())?;
    let ns_view = window.ns_view().map_err(|error| error.to_string())?;
    if ns_window.is_null() {
        return Err("launcher NSWindow is null".to_string());
    }
    if ns_view.is_null() {
        return Err("launcher NSView is null".to_string());
    }
    promote_window_to_nonactivating_panel(ns_window);
    unsafe {
        let ns_window = ns_window as *mut objc2::runtime::AnyObject;
        let ns_view = ns_view as *mut objc2::runtime::AnyObject;
        let _: () = objc2::msg_send![ns_window, orderFrontRegardless];
        let _: () = objc2::msg_send![ns_window, makeKeyWindow];
        let _: bool = objc2::msg_send![ns_window, makeFirstResponder: ns_view];
    }
    Ok(())
}

/// Convert the Tauri-created NSWindow into a custom NSPanel subclass at
/// runtime, then apply the nonactivating style mask. This is the only way to
/// get true non-activating behavior on macOS — the style mask bit (1 << 7)
/// is ignored by plain NSWindow instances; only NSPanel respects it.
///
/// We use a custom subclass ("HivenKeyablePanel") instead of plain NSPanel
/// because a borderless NSPanel returns NO from `canBecomeKeyWindow` by
/// default, which prevents keyboard input. Our subclass overrides it to YES.
///
/// Safety: NSPanel is a direct behavioral subclass of NSWindow with an
/// identical ivar layout (no added instance variables), so `object_setClass`
/// is safe here. We guard against double-promotion by checking the current
/// class before swizzling.
#[cfg(target_os = "macos")]
fn promote_window_to_nonactivating_panel(ns_window: *mut std::ffi::c_void) {
    const NS_WINDOW_STYLE_MASK_NONACTIVATING_PANEL: usize = 1usize << 7;
    unsafe {
        let ns_window = ns_window as *mut objc2::runtime::AnyObject;

        // Get or register our custom NSPanel subclass that can become key
        let target_class = get_or_register_keyable_panel_class();

        // Promote NSWindow → HivenKeyablePanel (only once per window lifetime)
        let current_class: *const objc2::runtime::AnyClass = objc2::msg_send![ns_window, class];
        if !std::ptr::eq(current_class, target_class) {
            objc2::ffi::object_setClass(
                (ns_window as *mut objc2::runtime::AnyObject).cast(),
                (target_class as *const objc2::runtime::AnyClass).cast(),
            );
        }

        // Apply nonactivating panel style mask
        let style_mask: usize = objc2::msg_send![ns_window, styleMask];
        let _: () = objc2::msg_send![
            ns_window,
            setStyleMask: style_mask | NS_WINDOW_STYLE_MASK_NONACTIVATING_PANEL
        ];

        // NSPanel-specific configuration for non-activating behavior
        let _: () = objc2::msg_send![ns_window, setFloatingPanel: true];
        let _: () = objc2::msg_send![ns_window, setHidesOnDeactivate: false];
        let _: () = objc2::msg_send![ns_window, setBecomesKeyOnlyIfNeeded: false];

        // Explicitly set the window level above normal and floating windows so
        // the launcher appears on top even when the app is fully in the background.
        // kCGStatusWindowLevel (25) is sufficient — it sits above main-menu level
        // (24) and all regular app windows, matching Spotlight/Raycast behavior.
        const STATUS_WINDOW_LEVEL: i64 = 25;
        let _: () = objc2::msg_send![ns_window, setLevel: STATUS_WINDOW_LEVEL];

        // Allow the panel to appear on all Spaces (follows user across desktops)
        let behavior: usize = objc2::msg_send![ns_window, collectionBehavior];
        const NS_WINDOW_COLLECTION_BEHAVIOR_CAN_JOIN_ALL_SPACES: usize = 1 << 0;
        const NS_WINDOW_COLLECTION_BEHAVIOR_FULL_SCREEN_AUXILIARY: usize = 1 << 8;
        let _: () = objc2::msg_send![
            ns_window,
            setCollectionBehavior: behavior
                | NS_WINDOW_COLLECTION_BEHAVIOR_CAN_JOIN_ALL_SPACES
                | NS_WINDOW_COLLECTION_BEHAVIOR_FULL_SCREEN_AUXILIARY
        ];
    }
}

/// Register a one-off "HivenKeyablePanel" subclass of NSPanel that overrides
/// `canBecomeKeyWindow` → YES. A borderless NSPanel returns NO by default,
/// which blocks all keyboard input. This subclass fixes that.
#[cfg(target_os = "macos")]
fn get_or_register_keyable_panel_class() -> *const objc2::runtime::AnyClass {
    use std::sync::Once;
    static REGISTER: Once = Once::new();
    static mut CLASS_PTR: *const objc2::runtime::AnyClass = std::ptr::null();

    REGISTER.call_once(|| {
        // If the class already exists (e.g. hot-reload), just reuse it
        if let Some(existing) = objc2::runtime::AnyClass::get(c"HivenKeyablePanel") {
            unsafe {
                CLASS_PTR = existing;
            }
            return;
        }
        let panel_cls =
            objc2::runtime::AnyClass::get(c"NSPanel").expect("NSPanel class must exist on macOS");

        unsafe {
            let new_class =
                objc2::ffi::objc_allocateClassPair(panel_cls, c"HivenKeyablePanel".as_ptr(), 0);
            assert!(
                !new_class.is_null(),
                "Failed to allocate HivenKeyablePanel class"
            );

            // Override canBecomeKeyWindow to return YES
            unsafe extern "C-unwind" fn can_become_key_window(
                _this: *mut objc2::runtime::AnyObject,
                _sel: *const std::ffi::c_void,
            ) -> objc2::runtime::Bool {
                objc2::runtime::Bool::YES
            }

            let sel = objc2::ffi::sel_registerName(c"canBecomeKeyWindow".as_ptr())
                .expect("canBecomeKeyWindow selector must be registerable");
            let imp: objc2::runtime::Imp = std::mem::transmute(
                can_become_key_window
                    as unsafe extern "C-unwind" fn(
                        *mut objc2::runtime::AnyObject,
                        *const std::ffi::c_void,
                    ) -> objc2::runtime::Bool,
            );
            let success = objc2::ffi::class_addMethod(new_class, sel, imp, c"B@:".as_ptr());
            assert!(
                success.as_bool(),
                "Failed to add canBecomeKeyWindow to HivenKeyablePanel"
            );

            objc2::ffi::objc_registerClassPair(new_class);
            CLASS_PTR = new_class as *const objc2::runtime::AnyClass;
        }
    });

    unsafe { CLASS_PTR }
}

#[cfg(target_os = "macos")]
fn current_foreground_process_id() -> Option<u32> {
    unsafe {
        let workspace_cls = objc2::runtime::AnyClass::get(c"NSWorkspace")?;
        let workspace: *mut objc2::runtime::AnyObject =
            objc2::msg_send![workspace_cls, sharedWorkspace];
        if workspace.is_null() {
            return None;
        }
        let app: *mut objc2::runtime::AnyObject = objc2::msg_send![workspace, frontmostApplication];
        if app.is_null() {
            return None;
        }
        let pid: i32 = objc2::msg_send![app, processIdentifier];
        u32::try_from(pid).ok()
    }
}

#[cfg(target_os = "macos")]
fn current_foreground_application_name() -> Option<String> {
    unsafe {
        let workspace_cls = objc2::runtime::AnyClass::get(c"NSWorkspace")?;
        let workspace: *mut objc2::runtime::AnyObject =
            objc2::msg_send![workspace_cls, sharedWorkspace];
        if workspace.is_null() {
            return None;
        }
        let app: *mut objc2::runtime::AnyObject = objc2::msg_send![workspace, frontmostApplication];
        if app.is_null() {
            return None;
        }
        let name: *mut objc2::runtime::AnyObject = objc2::msg_send![app, localizedName];
        if name.is_null() {
            return None;
        }
        let utf8: *const std::ffi::c_char = objc2::msg_send![name, UTF8String];
        if utf8.is_null() {
            return None;
        }
        Some(CStr::from_ptr(utf8).to_string_lossy().into_owned())
    }
}

#[cfg(not(target_os = "macos"))]
fn current_foreground_application_name() -> Option<String> {
    None
}

#[tauri::command]
async fn current_foreground_app_name() -> Option<String> {
    current_foreground_application_name()
}

#[derive(Clone)]
struct InstalledAppEntry {
    app_id: String,
    name: String,
    name_i18n: Option<HashMap<String, String>>,
    aliases: Vec<String>,
    platform: String,
    source: String,
    display_path: Option<String>,
    launch_target: String,
}

#[derive(Clone, serde::Serialize)]
struct DiscoveredAppIcon {
    bytes: Vec<u8>,
    #[serde(rename = "contentType")]
    content_type: String,
    hash: String,
}

#[derive(serde::Serialize)]
struct DiscoveredApp {
    #[serde(rename = "appId")]
    app_id: String,
    name: String,
    #[serde(rename = "nameI18n", skip_serializing_if = "Option::is_none")]
    name_i18n: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    aliases: Vec<String>,
    platform: String,
    source: String,
    #[serde(rename = "displayPath", skip_serializing_if = "Option::is_none")]
    display_path: Option<String>,
}

fn installed_app_targets() -> &'static Mutex<HashMap<String, String>> {
    INSTALLED_APP_TARGETS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn stable_hash(value: &str) -> String {
    stable_hash_bytes(value.as_bytes())
}

fn stable_hash_bytes(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{:016x}", hash)
}

fn installed_app_from_entry(entry: &InstalledAppEntry) -> DiscoveredApp {
    DiscoveredApp {
        app_id: entry.app_id.clone(),
        name: entry.name.clone(),
        name_i18n: entry.name_i18n.clone(),
        aliases: entry.aliases.clone(),
        platform: entry.platform.clone(),
        source: entry.source.clone(),
        display_path: entry.display_path.clone(),
    }
}

#[tauri::command]
fn read_installed_app_icon_url(app: tauri::AppHandle, app_id: String) -> Option<String> {
    let entry = resolve_installed_app_entry(&app_id)?;
    let cache_path = cached_app_icon_path(&entry).ok()?;
    if cache_path.exists() {
        return Some(cache_path.to_string_lossy().to_string());
    }
    let icon = extract_app_icon_for_command(app, entry)?;
    if fs::write(&cache_path, icon.bytes).is_err() {
        return None;
    }
    Some(cache_path.to_string_lossy().to_string())
}

#[tauri::command]
fn cache_installed_app_icons(app: tauri::AppHandle, app_ids: Vec<String>) -> usize {
    app_ids
        .into_iter()
        .take(MAX_APP_ICON_CACHE_WARM_COUNT)
        .filter(|app_id| read_installed_app_icon_url(app.clone(), app_id.to_string()).is_some())
        .count()
}

fn resolve_installed_app_entry(app_id: &str) -> Option<InstalledAppEntry> {
    let cached_target = installed_app_targets()
        .lock()
        .ok()
        .and_then(|targets| targets.get(app_id).cloned());
    if let Some(target) = cached_target {
        return Some(InstalledAppEntry {
            app_id: app_id.to_string(),
            name: String::new(),
            name_i18n: None,
            aliases: Vec::new(),
            platform: current_platform_name().to_string(),
            source: "applications".to_string(),
            display_path: Some(target.clone()),
            launch_target: target,
        });
    }

    let apps = discover_platform_apps();
    if let Ok(mut targets) = installed_app_targets().lock() {
        for app in &apps {
            targets.insert(app.app_id.clone(), app.launch_target.clone());
        }
    }
    apps.into_iter()
        .find(|candidate| candidate.app_id == app_id)
}

fn app_icon_cache_dir() -> Result<PathBuf, String> {
    let dir = config_dir()?.join("cache").join("app-icons");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn app_icon_target_mtime(entry: &InstalledAppEntry) -> u128 {
    entry
        .display_path
        .as_ref()
        .and_then(|path| fs::metadata(path).ok())
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn cached_app_icon_path(entry: &InstalledAppEntry) -> Result<PathBuf, String> {
    let target = entry
        .display_path
        .as_deref()
        .unwrap_or(&entry.launch_target);
    let cache_key = stable_hash(&format!(
        "{}|{}|{}|32",
        entry.app_id,
        target,
        app_icon_target_mtime(entry)
    ));
    Ok(app_icon_cache_dir()?.join(format!("{}.png", cache_key)))
}

#[cfg(target_os = "macos")]
fn extract_app_icon_for_command(
    app: tauri::AppHandle,
    entry: InstalledAppEntry,
) -> Option<DiscoveredAppIcon> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(extract_app_icon(&entry));
    })
    .ok()?;
    rx.recv_timeout(Duration::from_secs(2)).ok().flatten()
}

#[cfg(not(target_os = "macos"))]
fn extract_app_icon_for_command(
    _app: tauri::AppHandle,
    entry: InstalledAppEntry,
) -> Option<DiscoveredAppIcon> {
    extract_app_icon(&entry)
}

fn current_platform_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

fn app_name_from_path(path: &Path) -> Option<String> {
    path.file_stem()
        .or_else(|| path.file_name())
        .and_then(|name| name.to_str())
        .map(|name| name.trim_end_matches(".app").to_string())
        .filter(|name| !name.trim().is_empty())
}

fn parse_plist_string(raw: &str, key: &str) -> Option<String> {
    let key_marker = format!("<key>{}</key>", key);
    let key_index = raw.find(&key_marker)?;
    let rest = &raw[key_index + key_marker.len()..];
    let start_marker = "<string>";
    let start = rest.find(start_marker)? + start_marker.len();
    let end = rest[start..].find("</string>")?;
    Some(rest[start..start + end].trim().to_string())
}

fn decode_text_file(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xfe, 0xff]) {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]))
            .collect();
        return String::from_utf16_lossy(&units);
    }
    if bytes.starts_with(&[0xff, 0xfe]) {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();
        return String::from_utf16_lossy(&units);
    }
    String::from_utf8_lossy(bytes).to_string()
}

fn parse_apple_strings_value(raw: &str, key: &str) -> Option<String> {
    let quoted_key_marker = format!("\"{}\"", key);
    let rest = if let Some(key_index) = raw.find(&quoted_key_marker) {
        &raw[key_index + quoted_key_marker.len()..]
    } else {
        let key_index = raw.find(key)?;
        let rest = &raw[key_index + key.len()..];
        if rest.trim_start().starts_with('=') {
            rest
        } else {
            return None;
        }
    };
    let value_start = rest.find('"')? + 1;
    let mut escaped = false;
    let mut value = String::new();
    for ch in rest[value_start..].chars() {
        if escaped {
            match ch {
                'n' => value.push('\n'),
                'r' => value.push('\r'),
                't' => value.push('\t'),
                '"' => value.push('"'),
                '\\' => value.push('\\'),
                other => value.push(other),
            }
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        if ch == '"' {
            let trimmed = value.trim();
            return (!trimmed.is_empty()).then(|| trimmed.to_string());
        }
        value.push(ch);
    }
    None
}

fn macos_locale_candidates(locale: Option<&str>) -> Vec<String> {
    let normalized = locale.unwrap_or("").replace('_', "-");
    let lower = normalized.to_lowercase();
    let mut candidates = Vec::new();
    if lower.starts_with("zh") {
        if lower.contains("hant") || lower.ends_with("-tw") || lower.ends_with("-hk") {
            candidates.extend(["zh-Hant", "zh_TW", "zh_HK", "zh"]);
        } else {
            candidates.extend(["zh-Hans", "zh_CN", "zh"]);
        }
    }
    if !normalized.is_empty() {
        candidates.push(normalized.as_str());
        if let Some(language) = normalized.split('-').next() {
            candidates.push(language);
        }
    }
    candidates.push("Base");
    candidates.push("en");

    let mut deduped = Vec::new();
    for candidate in candidates {
        let candidate = candidate.to_string();
        if !deduped.contains(&candidate) {
            deduped.push(candidate);
        }
    }
    deduped
}

fn read_macos_localized_bundle_name(path: &Path, locale: Option<&str>) -> Option<String> {
    let resources = path.join("Contents").join("Resources");
    for candidate in macos_locale_candidates(locale) {
        let strings = resources
            .join(format!("{}.lproj", candidate))
            .join("InfoPlist.strings");
        let Ok(bytes) = fs::read(strings) else {
            continue;
        };
        let raw = decode_text_file(&bytes);
        if let Some(name) = parse_apple_strings_value(&raw, "CFBundleDisplayName")
            .or_else(|| parse_apple_strings_value(&raw, "CFBundleName"))
        {
            return Some(name);
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn read_macos_system_display_name(path: &Path) -> Option<String> {
    let path = CString::new(path.to_string_lossy().as_bytes()).ok()?;
    unsafe {
        let ns_string_cls = objc2::runtime::AnyClass::get(c"NSString")?;
        let ns_path: *mut objc2::runtime::AnyObject =
            objc2::msg_send![ns_string_cls, stringWithUTF8String: path.as_ptr()];
        if ns_path.is_null() {
            return None;
        }
        let file_manager_cls = objc2::runtime::AnyClass::get(c"NSFileManager")?;
        let file_manager: *mut objc2::runtime::AnyObject =
            objc2::msg_send![file_manager_cls, defaultManager];
        if file_manager.is_null() {
            return None;
        }
        let name: *mut objc2::runtime::AnyObject =
            objc2::msg_send![file_manager, displayNameAtPath: ns_path];
        if name.is_null() {
            return None;
        }
        let utf8: *const std::ffi::c_char = objc2::msg_send![name, UTF8String];
        if utf8.is_null() {
            return None;
        }
        let value = CStr::from_ptr(utf8).to_string_lossy().trim().to_string();
        (!value.is_empty()).then_some(value)
    }
}

#[cfg(not(target_os = "macos"))]
fn read_macos_system_display_name(_path: &Path) -> Option<String> {
    None
}

fn read_macos_bundle_metadata(
    path: &Path,
) -> (
    Option<String>,
    Option<String>,
    Option<HashMap<String, String>>,
    Vec<String>,
) {
    let info = path.join("Contents").join("Info.plist");
    let raw = fs::read_to_string(info).unwrap_or_default();
    let bundle_id = parse_plist_string(&raw, "CFBundleIdentifier");
    let plist_display_name = parse_plist_string(&raw, "CFBundleDisplayName");
    let plist_bundle_name = parse_plist_string(&raw, "CFBundleName");
    let plist_name = plist_display_name
        .clone()
        .or_else(|| plist_bundle_name.clone());
    let zh_name = read_macos_localized_bundle_name(path, Some("zh"));
    let name = read_macos_system_display_name(path)
        .or_else(|| plist_name.clone())
        .or_else(|| zh_name.clone());
    let mut name_i18n = HashMap::new();
    if let Some(ref name) = zh_name {
        if plist_name.as_deref() != Some(name.as_str()) {
            name_i18n.insert("zh".to_string(), name.clone());
        }
    }
    let mut aliases = Vec::new();
    for alias in [plist_display_name, plist_bundle_name, bundle_id.clone()] {
        let Some(alias) = alias else {
            continue;
        };
        if name.as_deref() == Some(alias.as_str()) || zh_name.as_deref() == Some(alias.as_str()) {
            continue;
        }
        if !aliases.iter().any(|item| item == &alias) {
            aliases.push(alias);
        }
    }
    let name_i18n = (!name_i18n.is_empty()).then_some(name_i18n);
    (bundle_id, name, name_i18n, aliases)
}

#[cfg(target_os = "macos")]
fn read_macos_app_icon_png(app_path: &Path) -> Option<Vec<u8>> {
    if !app_path.exists() {
        return None;
    }

    let path = CString::new(app_path.to_string_lossy().as_bytes()).ok()?;
    unsafe {
        let ns_string_cls = objc2::runtime::AnyClass::get(c"NSString")?;
        let ns_path: *mut objc2::runtime::AnyObject =
            objc2::msg_send![ns_string_cls, stringWithUTF8String: path.as_ptr()];
        if ns_path.is_null() {
            return None;
        }

        let workspace_cls = objc2::runtime::AnyClass::get(c"NSWorkspace")?;
        let workspace: *mut objc2::runtime::AnyObject =
            objc2::msg_send![workspace_cls, sharedWorkspace];
        if workspace.is_null() {
            return None;
        }

        let image: *mut objc2::runtime::AnyObject =
            objc2::msg_send![workspace, iconForFile: ns_path];
        if image.is_null() {
            return None;
        }

        let tiff_data: *mut objc2::runtime::AnyObject = objc2::msg_send![image, TIFFRepresentation];
        if tiff_data.is_null() {
            return None;
        }

        let bitmap_cls = objc2::runtime::AnyClass::get(c"NSBitmapImageRep")?;
        let bitmap: *mut objc2::runtime::AnyObject =
            objc2::msg_send![bitmap_cls, imageRepWithData: tiff_data];
        if bitmap.is_null() {
            return None;
        }

        let properties: *mut objc2::runtime::AnyObject = std::ptr::null_mut();
        let png_data: *mut objc2::runtime::AnyObject =
            objc2::msg_send![bitmap, representationUsingType: 4usize, properties: properties];
        if png_data.is_null() {
            return None;
        }

        let len: usize = objc2::msg_send![png_data, length];
        let bytes: *const u8 = objc2::msg_send![png_data, bytes];
        if bytes.is_null() || len == 0 {
            return None;
        }
        Some(std::slice::from_raw_parts(bytes, len).to_vec())
    }
}

#[cfg(target_os = "macos")]
fn extract_app_icon(entry: &InstalledAppEntry) -> Option<DiscoveredAppIcon> {
    let display_path = entry.display_path.as_ref()?;
    let bytes = read_macos_app_icon_png(Path::new(display_path))?;
    Some(DiscoveredAppIcon {
        hash: stable_hash_bytes(&bytes),
        bytes,
        content_type: "image/png".to_string(),
    })
}

#[cfg(not(target_os = "macos"))]
fn extract_app_icon(_entry: &InstalledAppEntry) -> Option<DiscoveredAppIcon> {
    None
}

#[cfg(target_os = "macos")]
fn system_open_app_target(target: &str) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
fn system_open_app_target(target: &str) -> Result<(), String> {
    std::process::Command::new("explorer")
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "linux")]
fn system_open_app_target(target: &str) -> Result<(), String> {
    std::process::Command::new("gtk-launch")
        .arg(target)
        .spawn()
        .or_else(|_| std::process::Command::new("xdg-open").arg(target).spawn())
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn discover_platform_apps() -> Vec<InstalledAppEntry> {
    let mut roots = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/System/Applications"),
    ];
    if let Some(home) = dirs_next_home() {
        roots.push(home.join("Applications"));
    }

    let mut apps = Vec::new();
    for root in roots {
        let Ok(entries) = fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("app") {
                continue;
            }
            let canonical = path.canonicalize().unwrap_or(path.clone());
            let canonical_str = canonical.to_string_lossy().to_string();
            let (bundle_id, bundle_name, name_i18n, aliases) =
                read_macos_bundle_metadata(&canonical);
            let app_id = bundle_id
                .map(|id| format!("macos:bundle:{}", id))
                .unwrap_or_else(|| format!("macos:path:{}", stable_hash(&canonical_str)));
            let Some(name) = bundle_name.or_else(|| app_name_from_path(&canonical)) else {
                continue;
            };
            apps.push(InstalledAppEntry {
                app_id,
                name,
                name_i18n,
                aliases,
                platform: "macos".to_string(),
                source: "applications".to_string(),
                display_path: Some(canonical_str.clone()),
                launch_target: canonical_str,
            });
        }
    }
    dedupe_installed_apps(apps)
}

#[cfg(target_os = "windows")]
fn discover_platform_apps() -> Vec<InstalledAppEntry> {
    let mut roots = Vec::new();
    if let Some(appdata) = std::env::var_os("APPDATA") {
        roots.push(PathBuf::from(appdata).join("Microsoft\\Windows\\Start Menu\\Programs"));
    }
    if let Some(programdata) = std::env::var_os("PROGRAMDATA") {
        roots.push(PathBuf::from(programdata).join("Microsoft\\Windows\\Start Menu\\Programs"));
    }
    // App Paths registry support belongs here; keep the source label stable for indexed results.
    let _app_paths_source = "app-paths";
    let _app_paths_label = "App Paths";

    let mut apps = Vec::new();
    for root in roots {
        collect_windows_start_menu_apps(&root, &mut apps);
    }
    collect_windows_app_paths_apps(&mut apps);
    dedupe_installed_apps(apps)
}

#[allow(dead_code)]
fn collect_windows_start_menu_apps(root: &Path, apps: &mut Vec<InstalledAppEntry>) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_windows_start_menu_apps(&path, apps);
            continue;
        }
        if path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("lnk"))
            != Some(true)
        {
            continue;
        }
        let Some(name) = app_name_from_path(&path) else {
            continue;
        };
        let canonical = path.canonicalize().unwrap_or(path.clone());
        let canonical_str = canonical.to_string_lossy().to_string();
        apps.push(InstalledAppEntry {
            app_id: format!("windows:start-menu:{}", stable_hash(&canonical_str)),
            name,
            name_i18n: None,
            aliases: Vec::new(),
            platform: "windows".to_string(),
            source: "start-menu".to_string(),
            display_path: Some(canonical_str.clone()),
            launch_target: canonical_str,
        });
    }
}

#[cfg(target_os = "windows")]
fn collect_windows_app_paths_apps(apps: &mut Vec<InstalledAppEntry>) {
    for hive in [
        r"HKCU\Software\Microsoft\Windows\CurrentVersion\App Paths",
        r"HKLM\Software\Microsoft\Windows\CurrentVersion\App Paths",
    ] {
        let Ok(output) = std::process::Command::new("reg")
            .args(["query", hive, "/s"])
            .output()
        else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        let raw = String::from_utf8_lossy(&output.stdout);
        apps.extend(parse_windows_app_paths_registry_output(&raw));
    }
}

#[allow(dead_code)]
fn parse_windows_app_paths_registry_output(raw: &str) -> Vec<InstalledAppEntry> {
    let mut apps = Vec::new();
    let mut current_name: Option<String> = None;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.contains("\\App Paths\\") {
            current_name = trimmed
                .rsplit('\\')
                .next()
                .and_then(|name| name.strip_suffix(".exe").or(Some(name)))
                .map(|name| name.to_string());
            continue;
        }
        let Some(name) = current_name.as_ref() else {
            continue;
        };
        if !(trimmed.starts_with("(Default)") || trimmed.starts_with("@"))
            || !trimmed.contains("REG_SZ")
        {
            continue;
        }
        let Some((_, value)) = trimmed.split_once("REG_SZ") else {
            continue;
        };
        let target = value.trim().trim_matches('"');
        if target.is_empty() {
            continue;
        }
        apps.push(InstalledAppEntry {
            app_id: format!("windows:app-paths:{}", stable_hash(target)),
            name: name.clone(),
            name_i18n: None,
            aliases: Vec::new(),
            platform: "windows".to_string(),
            source: "app-paths".to_string(),
            display_path: Some(target.to_string()),
            launch_target: target.to_string(),
        });
        current_name = None;
    }
    apps
}

#[cfg(target_os = "linux")]
fn discover_platform_apps() -> Vec<InstalledAppEntry> {
    let mut roots = vec![
        PathBuf::from("/usr/share/applications"),
        PathBuf::from("/usr/local/share/applications"),
    ];
    if let Some(home) = dirs_next_home() {
        roots.push(home.join(".local/share/applications"));
    }

    let mut apps = Vec::new();
    for root in roots {
        let Ok(entries) = fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("desktop") {
                continue;
            }
            let Some(app) = parse_linux_desktop_entry(&path) else {
                continue;
            };
            apps.push(app);
        }
    }
    dedupe_installed_apps(apps)
}

#[allow(dead_code)]
fn parse_linux_desktop_entry(path: &Path) -> Option<InstalledAppEntry> {
    let raw = fs::read_to_string(path).ok()?;
    if raw.lines().any(|line| line.trim() == "NoDisplay=true") {
        return None;
    }
    let name = raw
        .lines()
        .find_map(|line| line.strip_prefix("Name="))
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let canonical_str = canonical.to_string_lossy().to_string();
    let desktop_id = path.file_name()?.to_string_lossy().to_string();
    Some(InstalledAppEntry {
        app_id: format!("linux:desktop-entry:{}", desktop_id),
        name,
        name_i18n: None,
        aliases: Vec::new(),
        platform: "linux".to_string(),
        source: "desktop-entry".to_string(),
        display_path: Some(canonical_str),
        launch_target: desktop_id,
    })
}

fn dedupe_installed_apps(apps: Vec<InstalledAppEntry>) -> Vec<InstalledAppEntry> {
    let mut by_key = HashMap::<String, InstalledAppEntry>::new();
    for app in apps {
        by_key.entry(app.app_id.clone()).or_insert(app);
    }
    let mut result: Vec<InstalledAppEntry> = by_key.into_values().collect();
    result.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    result
}

#[tauri::command]
fn discover_installed_apps() -> Result<Vec<DiscoveredApp>, String> {
    let apps = discover_platform_apps();
    if let Ok(mut targets) = installed_app_targets().lock() {
        targets.clear();
        for app in &apps {
            targets.insert(app.app_id.clone(), app.launch_target.clone());
        }
    }
    Ok(apps.iter().map(installed_app_from_entry).collect())
}

#[tauri::command]
fn launch_installed_app(app_id: String) -> Result<(), String> {
    let cached_target = installed_app_targets()
        .lock()
        .ok()
        .and_then(|targets| targets.get(&app_id).cloned());
    let target = if let Some(target) = cached_target {
        target
    } else {
        let apps = discover_platform_apps();
        let target = apps
            .iter()
            .find(|app| app.app_id == app_id)
            .map(|app| app.launch_target.clone())
            .ok_or_else(|| "Application is no longer available".to_string())?;
        if let Ok(mut targets) = installed_app_targets().lock() {
            for app in &apps {
                targets.insert(app.app_id.clone(), app.launch_target.clone());
            }
        }
        target
    };
    system_open_app_target(&target)
}

#[cfg(not(target_os = "macos"))]
fn current_foreground_process_id() -> Option<u32> {
    None
}

#[cfg(target_os = "macos")]
fn activate_process(pid: u32) {
    unsafe {
        let app_cls = match objc2::runtime::AnyClass::get(c"NSRunningApplication") {
            Some(cls) => cls,
            None => return,
        };
        let app: *mut objc2::runtime::AnyObject =
            objc2::msg_send![app_cls, runningApplicationWithProcessIdentifier: pid as i32];
        if app.is_null() {
            return;
        }
        let _: bool = objc2::msg_send![app, activateWithOptions: 2usize];
    }
}

#[cfg(not(target_os = "macos"))]
fn activate_process(_pid: u32) {}

fn activate_app() {
    #[cfg(target_os = "macos")]
    unsafe {
        let cls = objc2::runtime::AnyClass::get(c"NSApplication").unwrap();
        let ns_app: *mut objc2::runtime::AnyObject = objc2::msg_send![cls, sharedApplication];
        let _: () = objc2::msg_send![ns_app, activateIgnoringOtherApps: true];
    }
}

/// 配置根目录: ~/.local/hiven
fn config_dir() -> Result<PathBuf, String> {
    dirs_next_home()
        .map(|h| h.join(".local").join("hiven"))
        .ok_or_else(|| "Cannot resolve home directory".to_string())
}

fn legacy_config_dir() -> Result<PathBuf, String> {
    dirs_next_home()
        .map(|h| h.join(".local").join("fluxtext"))
        .ok_or_else(|| "Cannot resolve home directory".to_string())
}

fn copy_dir_contents_if_missing(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let source_path = entry.path();
        let metadata = fs::symlink_metadata(&source_path).map_err(|e| e.to_string())?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        let target_path = target.join(entry.file_name());
        if target_path.exists() {
            continue;
        }
        if metadata.is_dir() {
            copy_dir_contents_if_missing(&source_path, &target_path)?;
        } else if metadata.is_file() {
            fs::copy(&source_path, &target_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn migrate_legacy_config_dir(target: &Path) -> Result<(), String> {
    let legacy = legacy_config_dir()?;
    if !legacy.exists() || legacy == target {
        return Ok(());
    }
    if !target.exists() {
        match fs::rename(&legacy, target) {
            Ok(()) => return Ok(()),
            Err(_) => {
                copy_dir_contents_if_missing(&legacy, target)?;
                return Ok(());
            }
        }
    }
    copy_dir_contents_if_missing(&legacy, target)
}

#[tauri::command]
fn get_config_dir() -> Result<String, String> {
    config_dir().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn init_config_dir() -> Result<String, String> {
    let base = config_dir()?;
    migrate_legacy_config_dir(&base)?;
    let scripts_dir = base.join("scripts");
    let builtin_dir = scripts_dir.join("builtin");
    let plugins_dir = base.join("plugins");
    let app_icon_cache_dir = base.join("cache").join("app-icons");
    let plugin_builtin_dir = plugins_dir.join("builtin");
    let plugin_installed_dir = plugins_dir.join("installed");
    let plugin_dev_dir = plugins_dir.join("dev");
    fs::create_dir_all(&builtin_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&plugin_builtin_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&plugin_installed_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&plugin_dev_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&app_icon_cache_dir).map_err(|e| e.to_string())?;
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

#[derive(serde::Serialize)]
struct PluginBlobWriteResult {
    #[serde(rename = "blobId")]
    blob_id: String,
    #[serde(rename = "byteSize")]
    byte_size: usize,
    #[serde(rename = "contentType")]
    content_type: String,
}

#[derive(serde::Serialize)]
struct PluginBlobReadResult {
    bytes: Vec<u8>,
    #[serde(rename = "contentType")]
    content_type: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct PluginBlobMetadata {
    #[serde(rename = "contentType")]
    content_type: String,
    extension: String,
    #[serde(rename = "byteSize")]
    byte_size: usize,
    #[serde(rename = "updatedAt")]
    updated_at: u128,
}

#[derive(serde::Serialize)]
struct PluginKvListEntry {
    key: String,
    #[serde(rename = "updatedAt")]
    updated_at: i64,
}

#[derive(serde::Serialize)]
struct PluginKvUsage {
    bytes: i64,
    #[serde(rename = "itemCount")]
    item_count: i64,
}

#[derive(serde::Serialize)]
struct PluginKvPruneResult {
    #[serde(rename = "removedBytes")]
    removed_bytes: i64,
    #[serde(rename = "removedItems")]
    removed_items: i64,
}

fn validate_plugin_storage_source(source: &str) -> Result<(), String> {
    match source {
        "builtin" | "installed" | "dev" => Ok(()),
        _ => Err("Plugin storage source must be builtin, installed, or dev".to_string()),
    }
}

fn validate_storage_segment(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || value == "."
        || value == ".."
        || value.contains('/')
        || value.contains('\\')
        || !value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.'))
    {
        return Err(format!("{} must be a plain storage id", label));
    }
    Ok(())
}

fn validate_plugin_kv_key(key: &str) -> Result<(), String> {
    if key.trim().is_empty() || key.contains('\0') || key.len() > 2048 {
        return Err("Plugin KV key must be non-empty plain text".to_string());
    }
    Ok(())
}

fn plugin_kv_db_path() -> Result<PathBuf, String> {
    let dir = config_dir()?.join("plugin-data");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("plugin-storage.sqlite"))
}

fn open_plugin_kv_db() -> Result<Connection, String> {
    let connection = Connection::open(plugin_kv_db_path()?).map_err(|e| e.to_string())?;
    connection
        .execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS plugin_kv (
              source TEXT NOT NULL,
              plugin_id TEXT NOT NULL,
              key TEXT NOT NULL,
              value_json TEXT NOT NULL,
              byte_size INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              PRIMARY KEY (source, plugin_id, key)
            );
            CREATE INDEX IF NOT EXISTS idx_plugin_kv_namespace_updated
              ON plugin_kv (source, plugin_id, updated_at);
            "#,
        )
        .map_err(|e| e.to_string())?;
    Ok(connection)
}

fn validate_plugin_kv_namespace(source: &str, plugin_id: &str) -> Result<(), String> {
    validate_plugin_storage_source(source)?;
    validate_storage_segment(plugin_id, "Plugin id")
}

fn current_millis_i64() -> Result<i64, String> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    i64::try_from(millis).map_err(|_| "Current timestamp is too large".to_string())
}

fn validate_plugin_kv_prune_policy(
    max_items: Option<i64>,
    max_bytes: Option<i64>,
    max_age_days: Option<i64>,
) -> Result<(), String> {
    if max_items.is_some_and(|value| value < 0)
        || max_bytes.is_some_and(|value| value < 0)
        || max_age_days.is_some_and(|value| value < 0)
    {
        return Err("Plugin KV prune limits must be non-negative".to_string());
    }
    Ok(())
}

fn sanitize_blob_extension(extension: Option<String>) -> Result<String, String> {
    let value = extension.unwrap_or_else(|| "bin".to_string());
    let trimmed = value.trim().trim_start_matches('.').to_ascii_lowercase();
    if trimmed.is_empty()
        || trimmed.len() > 16
        || !trimmed.chars().all(|ch| ch.is_ascii_alphanumeric())
    {
        return Err("Plugin blob extension must be alphanumeric".to_string());
    }
    Ok(trimmed)
}

fn plugin_blob_dir(source: &str, plugin_id: &str) -> Result<PathBuf, String> {
    validate_plugin_storage_source(source)?;
    validate_storage_segment(plugin_id, "Plugin id")?;
    let dir = config_dir().map(|root| {
        root.join("plugin-data")
            .join(source)
            .join(plugin_id)
            .join("blobs")
    })?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    dir.canonicalize().map_err(|e| e.to_string())
}

fn plugin_blob_paths(
    source: &str,
    plugin_id: &str,
    blob_id: &str,
) -> Result<(PathBuf, PluginBlobMetadata), String> {
    validate_storage_segment(blob_id, "Plugin blob id")?;
    let dir = plugin_blob_dir(source, plugin_id)?;
    let meta_path = dir.join(format!("{}.json", blob_id));
    let raw = fs::read_to_string(&meta_path).map_err(|e| e.to_string())?;
    let metadata: PluginBlobMetadata = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let data_path = dir.join(format!("{}.{}", blob_id, metadata.extension));
    let canonical_dir = dir.canonicalize().map_err(|e| e.to_string())?;
    let canonical_data = data_path.canonicalize().map_err(|e| e.to_string())?;
    if !canonical_data.starts_with(&canonical_dir) {
        return Err("Plugin blob path escaped its storage directory".to_string());
    }
    Ok((canonical_data, metadata))
}

#[tauri::command]
fn plugin_kv_get(source: String, plugin_id: String, key: String) -> Result<Option<String>, String> {
    validate_plugin_kv_namespace(&source, &plugin_id)?;
    validate_plugin_kv_key(&key)?;
    let connection = open_plugin_kv_db()?;
    connection
        .query_row(
            "SELECT value_json FROM plugin_kv WHERE source = ?1 AND plugin_id = ?2 AND key = ?3",
            params![source, plugin_id, key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn plugin_kv_set(
    source: String,
    plugin_id: String,
    key: String,
    value_json: String,
) -> Result<(), String> {
    validate_plugin_kv_namespace(&source, &plugin_id)?;
    validate_plugin_kv_key(&key)?;
    let byte_size =
        i64::try_from(value_json.len()).map_err(|_| "Plugin KV value is too large".to_string())?;
    let updated_at = current_millis_i64()?;
    let connection = open_plugin_kv_db()?;
    connection
        .execute(
            r#"
            INSERT INTO plugin_kv (source, plugin_id, key, value_json, byte_size, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(source, plugin_id, key) DO UPDATE SET
              value_json = excluded.value_json,
              byte_size = excluded.byte_size,
              updated_at = excluded.updated_at
            "#,
            params![source, plugin_id, key, value_json, byte_size, updated_at],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn plugin_kv_delete(source: String, plugin_id: String, key: String) -> Result<(), String> {
    validate_plugin_kv_namespace(&source, &plugin_id)?;
    validate_plugin_kv_key(&key)?;
    let connection = open_plugin_kv_db()?;
    connection
        .execute(
            "DELETE FROM plugin_kv WHERE source = ?1 AND plugin_id = ?2 AND key = ?3",
            params![source, plugin_id, key],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn plugin_kv_list(
    source: String,
    plugin_id: String,
    prefix: Option<String>,
) -> Result<Vec<PluginKvListEntry>, String> {
    validate_plugin_kv_namespace(&source, &plugin_id)?;
    if let Some(prefix) = prefix.as_deref() {
        if prefix.contains('\0') {
            return Err("Plugin KV prefix must be plain text".to_string());
        }
    }
    let connection = open_plugin_kv_db()?;
    let mut statement = connection
        .prepare(
            "SELECT key, updated_at FROM plugin_kv WHERE source = ?1 AND plugin_id = ?2 ORDER BY updated_at DESC, key ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(params![source, plugin_id], |row| {
            Ok(PluginKvListEntry {
                key: row.get(0)?,
                updated_at: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut entries = Vec::new();
    for row in rows {
        let entry = row.map_err(|e| e.to_string())?;
        if prefix
            .as_ref()
            .is_some_and(|prefix| !entry.key.starts_with(prefix))
        {
            continue;
        }
        entries.push(entry);
    }
    Ok(entries)
}

#[tauri::command]
fn plugin_kv_usage(source: String, plugin_id: String) -> Result<PluginKvUsage, String> {
    validate_plugin_kv_namespace(&source, &plugin_id)?;
    let connection = open_plugin_kv_db()?;
    let (bytes, item_count): (i64, i64) = connection
        .query_row(
            "SELECT COALESCE(SUM(byte_size), 0), COUNT(*) FROM plugin_kv WHERE source = ?1 AND plugin_id = ?2",
            params![source, plugin_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    Ok(PluginKvUsage { bytes, item_count })
}

#[tauri::command]
fn plugin_kv_prune(
    source: String,
    plugin_id: String,
    max_items: Option<i64>,
    max_bytes: Option<i64>,
    max_age_days: Option<i64>,
) -> Result<PluginKvPruneResult, String> {
    validate_plugin_kv_namespace(&source, &plugin_id)?;
    validate_plugin_kv_prune_policy(max_items, max_bytes, max_age_days)?;

    let mut connection = open_plugin_kv_db()?;
    let transaction = connection.transaction().map_err(|e| e.to_string())?;
    let mut removed_bytes = 0;
    let mut removed_items = 0;

    if let Some(days) = max_age_days {
        let cutoff = current_millis_i64()?.saturating_sub(days.saturating_mul(86_400_000));
        let expired = {
            let mut statement = transaction
                .prepare(
                    "SELECT key, byte_size FROM plugin_kv WHERE source = ?1 AND plugin_id = ?2 AND updated_at < ?3",
                )
                .map_err(|e| e.to_string())?;
            let rows = statement
                .query_map(
                    params![source.as_str(), plugin_id.as_str(), cutoff],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
                )
                .map_err(|e| e.to_string())?;
            let mut expired = Vec::new();
            for row in rows {
                expired.push(row.map_err(|e| e.to_string())?);
            }
            expired
        };
        for (key, byte_size) in expired {
            transaction
                .execute(
                    "DELETE FROM plugin_kv WHERE source = ?1 AND plugin_id = ?2 AND key = ?3",
                    params![source.as_str(), plugin_id.as_str(), key],
                )
                .map_err(|e| e.to_string())?;
            removed_bytes += byte_size;
            removed_items += 1;
        }
    }

    if max_items.is_some() || max_bytes.is_some() {
        let mut items = {
            let mut statement = transaction
                .prepare(
                    "SELECT key, byte_size FROM plugin_kv WHERE source = ?1 AND plugin_id = ?2 ORDER BY updated_at DESC, key ASC",
                )
                .map_err(|e| e.to_string())?;
            let rows = statement
                .query_map(params![source.as_str(), plugin_id.as_str()], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                })
                .map_err(|e| e.to_string())?;
            let mut items = Vec::new();
            for row in rows {
                items.push(row.map_err(|e| e.to_string())?);
            }
            items
        };

        let mut total_items = i64::try_from(items.len())
            .map_err(|_| "Plugin KV item count is too large".to_string())?;
        let mut total_bytes = items.iter().map(|(_, byte_size)| *byte_size).sum::<i64>();

        while let Some((key, byte_size)) = items.pop() {
            let over_items = max_items.is_some_and(|limit| total_items > limit);
            let over_bytes = max_bytes.is_some_and(|limit| total_bytes > limit);
            if !over_items && !over_bytes {
                break;
            }
            transaction
                .execute(
                    "DELETE FROM plugin_kv WHERE source = ?1 AND plugin_id = ?2 AND key = ?3",
                    params![source.as_str(), plugin_id.as_str(), key],
                )
                .map_err(|e| e.to_string())?;
            removed_bytes += byte_size;
            removed_items += 1;
            total_bytes -= byte_size;
            total_items -= 1;
        }
    }

    transaction.commit().map_err(|e| e.to_string())?;
    Ok(PluginKvPruneResult {
        removed_bytes,
        removed_items,
    })
}

#[tauri::command]
fn plugin_kv_clear(source: String, plugin_id: String) -> Result<(), String> {
    validate_plugin_kv_namespace(&source, &plugin_id)?;
    let connection = open_plugin_kv_db()?;
    connection
        .execute(
            "DELETE FROM plugin_kv WHERE source = ?1 AND plugin_id = ?2",
            params![source, plugin_id],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn plugin_blob_save(
    source: String,
    plugin_id: String,
    blob_id: String,
    bytes: Vec<u8>,
    content_type: String,
    extension: Option<String>,
) -> Result<PluginBlobWriteResult, String> {
    validate_storage_segment(&blob_id, "Plugin blob id")?;
    let extension = sanitize_blob_extension(extension)?;
    let dir = plugin_blob_dir(&source, &plugin_id)?;
    let data_path = dir.join(format!("{}.{}", blob_id, extension));
    let metadata_path = dir.join(format!("{}.json", blob_id));
    let metadata = PluginBlobMetadata {
        content_type: content_type.clone(),
        extension,
        byte_size: bytes.len(),
        updated_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis(),
    };
    fs::write(&data_path, &bytes).map_err(|e| e.to_string())?;
    let metadata_raw = serde_json::to_string(&metadata).map_err(|e| e.to_string())?;
    fs::write(&metadata_path, metadata_raw).map_err(|e| e.to_string())?;
    Ok(PluginBlobWriteResult {
        blob_id,
        byte_size: metadata.byte_size,
        content_type,
    })
}

#[tauri::command]
fn plugin_blob_read(
    source: String,
    plugin_id: String,
    blob_id: String,
) -> Result<Option<PluginBlobReadResult>, String> {
    match plugin_blob_paths(&source, &plugin_id, &blob_id) {
        Ok((data_path, metadata)) => {
            let bytes = fs::read(data_path).map_err(|e| e.to_string())?;
            Ok(Some(PluginBlobReadResult {
                bytes,
                content_type: metadata.content_type,
            }))
        }
        Err(error) if error.contains("No such file") || error.contains("os error 2") => Ok(None),
        Err(error) => Err(error),
    }
}

#[tauri::command]
fn plugin_blob_path(
    source: String,
    plugin_id: String,
    blob_id: String,
) -> Result<Option<String>, String> {
    match plugin_blob_paths(&source, &plugin_id, &blob_id) {
        Ok((data_path, _)) => Ok(Some(data_path.to_string_lossy().to_string())),
        Err(error) if error.contains("No such file") || error.contains("os error 2") => Ok(None),
        Err(error) => Err(error),
    }
}

#[tauri::command]
fn plugin_blob_delete(source: String, plugin_id: String, blob_id: String) -> Result<(), String> {
    validate_storage_segment(&blob_id, "Plugin blob id")?;
    let dir = plugin_blob_dir(&source, &plugin_id)?;
    let metadata_path = dir.join(format!("{}.json", blob_id));
    if let Ok(raw) = fs::read_to_string(&metadata_path) {
        if let Ok(metadata) = serde_json::from_str::<PluginBlobMetadata>(&raw) {
            let data_path = dir.join(format!("{}.{}", blob_id, metadata.extension));
            let _ = fs::remove_file(data_path);
        }
    }
    let _ = fs::remove_file(metadata_path);
    Ok(())
}

#[tauri::command]
fn plugin_blob_clear(source: String, plugin_id: String) -> Result<(), String> {
    let dir = plugin_blob_dir(&source, &plugin_id)?;
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
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
fn replace_plugin_dir(
    source_path: String,
    root_path: String,
    plugin_id: String,
) -> Result<(), String> {
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
    let code_command = if cfg!(target_os = "windows") {
        "code.cmd"
    } else {
        "code"
    };
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
    let archive_url = format!(
        "https://codeload.github.com/{}/{}/zip/refs/heads/{}",
        owner, repo, branch
    );
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
                return Err(
                    "GitHub directory path must stay inside the repository archive".to_string(),
                );
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
        return Err(
            "manifest.json must not declare entry; use a fixed index.* plugin entry".to_string(),
        );
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
        path.extension()
            .and_then(|s| s.to_str())
            .unwrap_or_default(),
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
        || trimmed
            .split('/')
            .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return Err(format!("{} must be a package-relative path", label));
    }

    let path = Path::new(trimmed);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(format!("{} must be a package-relative path", label));
    }
    Ok(())
}

fn find_fixed_plugin_entry(folder: &Path) -> Result<String, String> {
    for entry in [
        "index.tsx",
        "index.ts",
        "index.jsx",
        "index.js",
        "index.mjs",
    ] {
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
    path.components()
        .any(|component| matches!(component, Component::ParentDir))
}

fn ensure_existing_plugin_path(path: &Path) -> Result<PathBuf, String> {
    let root = plugin_root_dir()?;
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    if canonical.starts_with(&root) {
        Ok(canonical)
    } else {
        Err("Plugin file access is restricted to the hiven plugins directory".to_string())
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
        Err("Plugin file writes are restricted to the hiven plugins directory".to_string())
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

fn extract_zip_archive<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
    target: &Path,
) -> Result<(), String> {
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

fn install_package_from_extracted_dir(
    extracted_root: &Path,
    destination_root: &Path,
) -> Result<String, String> {
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

/// Disable App Nap for this process via NSProcessInfo. When App Nap is active
/// macOS will throttle timers and delay event delivery for background apps,
/// which prevents the global hotkey from showing the launcher window promptly.
#[cfg(target_os = "macos")]
fn disable_app_nap() {
    unsafe {
        let process_info_cls =
            objc2::runtime::AnyClass::get(c"NSProcessInfo").expect("NSProcessInfo must exist");
        let process_info: *mut objc2::runtime::AnyObject =
            objc2::msg_send![process_info_cls, processInfo];
        if process_info.is_null() {
            return;
        }
        // NSActivityUserInitiatedAllowingIdleSystemSleep = 0x00FFFFFFULL & ~(1ULL << 20)
        // This effectively disables App Nap while allowing idle system sleep.
        let reason_cls =
            objc2::runtime::AnyClass::get(c"NSString").expect("NSString must exist");
        let reason: *mut objc2::runtime::AnyObject = objc2::msg_send![
            reason_cls,
            stringWithUTF8String: c"Global hotkey must respond immediately".as_ptr()
        ];
        const NS_ACTIVITY_USER_INITIATED_ALLOWING_IDLE_SYSTEM_SLEEP: u64 =
            (0x00FFFFFF_u64) & !(1u64 << 20);
        let _activity: *mut objc2::runtime::AnyObject = objc2::msg_send![
            process_info,
            beginActivityWithOptions: NS_ACTIVITY_USER_INITIATED_ALLOWING_IDLE_SYSTEM_SLEEP,
            reason: reason
        ];
        // We intentionally never end this activity — it must persist for the
        // process lifetime so the hotkey listener is never throttled.
    }
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
            // Disable App Nap so the event loop stays responsive to global
            // hotkeys even when the app is fully in the background. Without
            // this, macOS may throttle the main RunLoop and delay the
            // `run_on_main_thread` callbacks used to show the launcher window.
            #[cfg(target_os = "macos")]
            disable_app_nap();

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
            plugin_kv_get,
            plugin_kv_set,
            plugin_kv_delete,
            plugin_kv_list,
            plugin_kv_usage,
            plugin_kv_prune,
            plugin_kv_clear,
            plugin_blob_save,
            plugin_blob_read,
            plugin_blob_delete,
            plugin_blob_path,
            plugin_blob_clear,
            install_plugin_dir,
            install_plugin_zip,
            install_plugin_zip_url,
            fetch_github_directory,
            hotkeys::register_double_modifier_hotkey,
            hotkeys::unregister_double_modifier_hotkey,
            show_and_focus_window,
            show_launcher_window,
            hide_launcher_window,
            simulate_paste,
            current_foreground_app_name,
            discover_installed_apps,
            read_installed_app_icon_url,
            cache_installed_app_icons,
            launch_installed_app,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            let _ = (&app, &event); // suppress unused warnings on non-macOS
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                show_and_focus_main_window(app);
            }
        });
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
        env::temp_dir().join(format!("hiven-{}-{}-{}", label, std::process::id(), millis))
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
    fn stable_app_id_hash_generation_is_deterministic() {
        let left = stable_hash("/Applications/Example.app");
        let right = stable_hash("/Applications/Example.app");
        assert_eq!(left, right);
        assert_ne!(left, stable_hash("/Applications/Other.app"));
    }

    #[test]
    fn dedupe_app_discovery_keeps_one_duplicate_app_id() {
        let apps = dedupe_installed_apps(vec![
            InstalledAppEntry {
                app_id: "macos:bundle:com.example.App".to_string(),
                name: "Example".to_string(),
                name_i18n: None,
                aliases: Vec::new(),
                platform: "macos".to_string(),
                source: "applications".to_string(),
                display_path: Some("/Applications/Example.app".to_string()),
                launch_target: "/Applications/Example.app".to_string(),
            },
            InstalledAppEntry {
                app_id: "macos:bundle:com.example.App".to_string(),
                name: "Example Copy".to_string(),
                name_i18n: None,
                aliases: Vec::new(),
                platform: "macos".to_string(),
                source: "applications".to_string(),
                display_path: Some("/Users/me/Applications/Example.app".to_string()),
                launch_target: "/Users/me/Applications/Example.app".to_string(),
            },
        ]);
        assert_eq!(apps.len(), 1);
        assert_eq!(apps[0].app_id, "macos:bundle:com.example.App");
    }

    #[test]
    fn macos_bundle_metadata_keeps_search_names_and_uses_system_display_name() {
        let dir = unique_home("macos-localized-bundle");
        let app = dir.join("Lark.app");
        let contents = app.join("Contents");
        let resources = contents.join("Resources").join("zh-Hans.lproj");
        fs::create_dir_all(&resources).expect("localized resources should be created");
        fs::write(
            contents.join("Info.plist"),
            r#"<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.electron.lark</string>
  <key>CFBundleDisplayName</key><string>Lark</string>
  <key>CFBundleName</key><string>Feishu</string>
</dict></plist>"#,
        )
        .expect("Info.plist fixture should be written");
        fs::write(
            resources.join("InfoPlist.strings"),
            r#"CFBundleDisplayName = "飞书";
CFBundleName = "飞书";"#,
        )
        .expect("localized InfoPlist.strings fixture should be written");

        let (bundle_id, system_name, name_i18n, aliases) = read_macos_bundle_metadata(&app);
        assert_eq!(bundle_id.as_deref(), Some("com.electron.lark"));
        assert_eq!(
            system_name.as_deref(),
            read_macos_system_display_name(&app).as_deref()
        );
        assert_eq!(
            name_i18n
                .as_ref()
                .and_then(|names| names.get("zh"))
                .map(String::as_str),
            Some("飞书")
        );
        assert!(
            aliases.iter().any(|alias| alias == "Feishu"),
            "CFBundleName should be searchable as an app alias"
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn linux_desktop_entry_fixture_parses_visible_apps() {
        let dir = unique_home("linux-desktop-entry");
        fs::create_dir_all(&dir).expect("fixture dir should be created");
        let desktop = dir.join("example.desktop");
        fs::write(
            &desktop,
            "[Desktop Entry]\nType=Application\nName=Example App\nExec=/usr/bin/example %U\n",
        )
        .expect("desktop fixture should be written");

        let app = parse_linux_desktop_entry(&desktop).expect("desktop fixture should parse");
        assert_eq!(app.app_id, "linux:desktop-entry:example.desktop");
        assert_eq!(app.name, "Example App");
        assert_eq!(app.source, "desktop-entry");
        assert_eq!(app.launch_target, "example.desktop");

        fs::write(
            &desktop,
            "[Desktop Entry]\nType=Application\nName=Hidden App\nNoDisplay=true\n",
        )
        .expect("hidden desktop fixture should be written");
        assert!(parse_linux_desktop_entry(&desktop).is_none());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn windows_start_menu_fixture_indexes_lnk_files() {
        let dir = unique_home("windows-start-menu");
        let nested = dir.join("Programs").join("Tools");
        fs::create_dir_all(&nested).expect("start menu fixture should be created");
        fs::write(nested.join("Example Tool.lnk"), "shortcut")
            .expect("lnk fixture should be written");
        fs::write(nested.join("ignore.txt"), "not an app")
            .expect("non-app fixture should be written");

        let mut apps = Vec::new();
        collect_windows_start_menu_apps(&dir, &mut apps);
        assert_eq!(apps.len(), 1);
        assert_eq!(apps[0].name, "Example Tool");
        assert_eq!(apps[0].platform, "windows");
        assert_eq!(apps[0].source, "start-menu");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn windows_app_paths_fixture_parses_registry_output() {
        let raw = r#"
HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\App Paths\Example.exe
    (Default)    REG_SZ    C:\Program Files\Example\Example.exe
"#;

        let apps = parse_windows_app_paths_registry_output(raw);
        assert_eq!(apps.len(), 1);
        assert_eq!(apps[0].name, "Example");
        assert_eq!(apps[0].source, "app-paths");
        assert_eq!(
            apps[0].launch_target,
            r"C:\Program Files\Example\Example.exe"
        );
    }

    #[test]
    fn missing_icon_keeps_app_metadata_without_icon() {
        let entry = InstalledAppEntry {
            app_id: "macos:path:missing-icon".to_string(),
            name: "Missing Icon".to_string(),
            name_i18n: None,
            aliases: Vec::new(),
            platform: "macos".to_string(),
            source: "applications".to_string(),
            display_path: Some("/does/not/exist/Missing.app".to_string()),
            launch_target: "/does/not/exist/Missing.app".to_string(),
        };

        let app = installed_app_from_entry(&entry);
        assert_eq!(app.app_id, entry.app_id);
        assert_eq!(app.name, "Missing Icon");
        assert!(extract_app_icon(&entry).is_none());
    }

    #[test]
    fn plugin_kv_round_trips_lists_usage_and_deletes() {
        with_isolated_home("plugin-kv-round-trip", |home| {
            plugin_kv_set(
                "builtin".to_string(),
                "clipboard-history".to_string(),
                "items:a".to_string(),
                r#"{"text":"a"}"#.to_string(),
            )
            .expect("plugin KV set should upsert a value");
            plugin_kv_set(
                "builtin".to_string(),
                "clipboard-history".to_string(),
                "items:b".to_string(),
                r#"{"text":"bb"}"#.to_string(),
            )
            .expect("plugin KV set should upsert a second value");
            plugin_kv_set(
                "builtin".to_string(),
                "clipboard-history".to_string(),
                "index".to_string(),
                r#"{"entries":["a","b"]}"#.to_string(),
            )
            .expect("plugin KV set should allow non-prefixed keys");
            plugin_kv_set(
                "installed".to_string(),
                "clipboard-history".to_string(),
                "items:a".to_string(),
                r#"{"text":"isolated"}"#.to_string(),
            )
            .expect("plugin KV set should isolate sources");

            assert_eq!(
                plugin_kv_get(
                    "builtin".to_string(),
                    "clipboard-history".to_string(),
                    "items:a".to_string(),
                )
                .expect("plugin KV get should succeed")
                .as_deref(),
                Some(r#"{"text":"a"}"#),
            );
            assert_eq!(
                plugin_kv_get(
                    "builtin".to_string(),
                    "clipboard-history".to_string(),
                    "missing".to_string(),
                )
                .expect("missing plugin KV get should succeed"),
                None,
            );

            let mut item_keys: Vec<String> = plugin_kv_list(
                "builtin".to_string(),
                "clipboard-history".to_string(),
                Some("items:".to_string()),
            )
            .expect("plugin KV list should succeed")
            .into_iter()
            .map(|entry| entry.key)
            .collect();
            item_keys.sort();
            assert_eq!(
                item_keys,
                vec!["items:a".to_string(), "items:b".to_string()]
            );

            let usage = plugin_kv_usage("builtin".to_string(), "clipboard-history".to_string())
                .expect("plugin KV usage should succeed");
            assert_eq!(usage.item_count, 3);
            assert_eq!(
                usage.bytes,
                (r#"{"text":"a"}"#.len()
                    + r#"{"text":"bb"}"#.len()
                    + r#"{"entries":["a","b"]}"#.len()) as i64,
            );

            plugin_kv_delete(
                "builtin".to_string(),
                "clipboard-history".to_string(),
                "items:a".to_string(),
            )
            .expect("plugin KV delete should succeed");
            assert_eq!(
                plugin_kv_get(
                    "builtin".to_string(),
                    "clipboard-history".to_string(),
                    "items:a".to_string(),
                )
                .expect("deleted plugin KV get should succeed"),
                None,
            );
            assert!(
                home.join(".local")
                    .join("hiven")
                    .join("plugin-data")
                    .join("plugin-storage.sqlite")
                    .exists(),
                "plugin KV DB should live under the hiven config dir",
            );
        });
    }

    #[test]
    fn plugin_kv_prune_and_clear_are_namespace_scoped() {
        with_isolated_home("plugin-kv-prune", |_| {
            for (key, value) in [("a", r#""aaaa""#), ("b", r#""bbbb""#), ("c", r#""cccc""#)] {
                plugin_kv_set(
                    "builtin".to_string(),
                    "app-launcher".to_string(),
                    key.to_string(),
                    value.to_string(),
                )
                .expect("plugin KV fixture should be written");
            }
            plugin_kv_set(
                "builtin".to_string(),
                "other-plugin".to_string(),
                "a".to_string(),
                r#""keep""#.to_string(),
            )
            .expect("other namespace fixture should be written");

            let result = plugin_kv_prune(
                "builtin".to_string(),
                "app-launcher".to_string(),
                Some(2),
                None,
                None,
            )
            .expect("plugin KV prune should succeed");
            assert_eq!(result.removed_items, 1);
            assert!(result.removed_bytes > 0);
            assert_eq!(
                plugin_kv_usage("builtin".to_string(), "app-launcher".to_string())
                    .expect("plugin KV usage should succeed")
                    .item_count,
                2,
            );

            plugin_kv_clear("builtin".to_string(), "app-launcher".to_string())
                .expect("plugin KV clear should succeed");
            assert_eq!(
                plugin_kv_usage("builtin".to_string(), "app-launcher".to_string())
                    .expect("cleared plugin KV usage should succeed")
                    .item_count,
                0,
            );
            assert_eq!(
                plugin_kv_usage("builtin".to_string(), "other-plugin".to_string())
                    .expect("other namespace usage should succeed")
                    .item_count,
                1,
            );
        });
    }

    #[test]
    fn plugin_kv_prune_supports_max_bytes_and_max_age_days() {
        with_isolated_home("plugin-kv-prune-limits", |_| {
            for (key, value) in [("a", r#""aaaa""#), ("b", r#""bbbb""#), ("c", r#""cccc""#)] {
                plugin_kv_set(
                    "builtin".to_string(),
                    "clipboard-history".to_string(),
                    key.to_string(),
                    value.to_string(),
                )
                .expect("plugin KV fixture should be written");
            }

            let result = plugin_kv_prune(
                "builtin".to_string(),
                "clipboard-history".to_string(),
                None,
                Some(12),
                None,
            )
            .expect("plugin KV maxBytes prune should succeed");
            assert_eq!(result.removed_items, 1);
            assert!(
                plugin_kv_usage("builtin".to_string(), "clipboard-history".to_string())
                    .expect("plugin KV usage should succeed")
                    .bytes
                    <= 12,
            );

            plugin_kv_set(
                "builtin".to_string(),
                "clipboard-history".to_string(),
                "old".to_string(),
                r#""old""#.to_string(),
            )
            .expect("old plugin KV fixture should be written");
            let connection = open_plugin_kv_db().expect("plugin KV DB should open");
            connection
                .execute(
                    "UPDATE plugin_kv SET updated_at = 1 WHERE source = ?1 AND plugin_id = ?2 AND key = ?3",
                    params!["builtin", "clipboard-history", "old"],
                )
                .expect("old plugin KV fixture should be backdated");

            let result = plugin_kv_prune(
                "builtin".to_string(),
                "clipboard-history".to_string(),
                None,
                None,
                Some(1),
            )
            .expect("plugin KV maxAgeDays prune should succeed");
            assert_eq!(result.removed_items, 1);
            assert_eq!(
                plugin_kv_get(
                    "builtin".to_string(),
                    "clipboard-history".to_string(),
                    "old".to_string(),
                )
                .expect("plugin KV get should succeed"),
                None,
            );
        });
    }

    #[test]
    fn plugin_kv_rejects_invalid_source_plugin_id_and_key() {
        with_isolated_home("plugin-kv-rejects", |_| {
            assert!(plugin_kv_set(
                "remote".to_string(),
                "app-launcher".to_string(),
                "key".to_string(),
                "1".to_string(),
            )
            .is_err());
            assert!(plugin_kv_set(
                "builtin".to_string(),
                "../escape".to_string(),
                "key".to_string(),
                "1".to_string(),
            )
            .is_err());
            assert!(plugin_kv_set(
                "builtin".to_string(),
                "app-launcher".to_string(),
                "   ".to_string(),
                "1".to_string(),
            )
            .is_err());
        });
    }

    #[test]
    fn init_config_dir_migrates_legacy_fluxtext_config() {
        with_isolated_home("config-migration", |home| {
            let legacy = home.join(".local").join("fluxtext");
            let legacy_plugin = legacy
                .join("plugins")
                .join("installed")
                .join("legacy-plugin");
            fs::create_dir_all(&legacy_plugin).expect("legacy plugin dir should be created");
            fs::write(
                legacy_plugin.join("manifest.json"),
                r#"{"pluginId":"legacy-plugin"}"#,
            )
            .expect("legacy plugin manifest should be written");

            let config = PathBuf::from(init_config_dir().expect("config dir should initialize"));

            assert_eq!(config, home.join(".local").join("hiven"));
            assert!(
                config
                    .join("plugins")
                    .join("installed")
                    .join("legacy-plugin")
                    .join("manifest.json")
                    .exists(),
                "legacy installed plugin should exist under hiven config root",
            );
        });
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
}"#
                .to_string(),
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
}"#
                .to_string(),
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
            assert!(summaries[0]
                .error
                .as_ref()
                .is_some_and(|error| error.contains("must not declare entry")));

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
