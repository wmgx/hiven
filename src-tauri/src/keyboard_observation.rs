use serde::{Deserialize, Serialize};

/// Options are deliberately bounded: this command is a short-lived recorder
/// driven by the host's existing observation lifecycle, not a background daemon.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyboardObservationOptions {
    #[serde(default)]
    pub excluded_apps: Vec<String>,
    pub ends_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyboardEvent {
    at: u64,
    app_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    bundle_id: Option<String>,
    key_code: u16,
    key: String,
    modifiers: Vec<String>,
    repeat: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyboardBatch {
    status: String,
    events: Vec<KeyboardEvent>,
}

const HEARTBEAT_MS: u64 = 20_000;
const MAX_DURATION_MS: u64 = 14 * 24 * 60 * 60 * 1_000;

#[tauri::command]
pub async fn poll_keyboard_observation(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    options: KeyboardObservationOptions,
) -> Result<KeyboardBatch, String> {
    if window.label() != "launcher" {
        return Err("keyboard-observation-requires-launcher".into());
    }
    validate_options(&options)?;

    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || macos::poll(app, options))
            .await
            .map_err(|error| format!("keyboard-observation-task-failed: {error}"))?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, options);
        Ok(KeyboardBatch {
            status: "unsupported-platform".into(),
            events: Vec::new(),
        })
    }
}

#[tauri::command]
pub async fn stop_keyboard_observation(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    if window.label() != "launcher" {
        return Err("keyboard-observation-requires-launcher".into());
    }

    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || macos::stop(app))
            .await
            .map_err(|error| format!("keyboard-observation-stop-failed: {error}"))?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(())
    }
}

fn validate_options(options: &KeyboardObservationOptions) -> Result<(), String> {
    let now = now_ms()?;
    if options.ends_at <= now || options.ends_at.saturating_sub(now) > MAX_DURATION_MS {
        return Err("invalid-keyboard-observation-ends-at".into());
    }
    if options.excluded_apps.len() > 64
        || options
            .excluded_apps
            .iter()
            .any(|value| value.trim().is_empty() || value.len() > 256)
    {
        return Err("invalid-keyboard-observation-excluded-apps".into());
    }
    Ok(())
}

fn now_ms() -> Result<u64, String> {
    use std::time::{SystemTime, UNIX_EPOCH};
    u64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "clock-unavailable")?
            .as_millis(),
    )
    .map_err(|_| "clock-unavailable".into())
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{now_ms, KeyboardBatch, KeyboardEvent, KeyboardObservationOptions, HEARTBEAT_MS};
    use block2::RcBlock;
    use core_foundation::base::{CFType, CFTypeRef, TCFType};
    use core_foundation::string::{CFString, CFStringRef};
    use objc2::msg_send;
    use objc2::rc::autoreleasepool;
    use objc2::runtime::{AnyClass, AnyObject};
    use std::collections::VecDeque;
    use std::ffi::{c_char, c_void, CStr};
    use std::sync::{Mutex, OnceLock};

    const KEY_DOWN: u64 = 10;
    const FLAGS_CHANGED: u64 = 12;
    const MASK: u64 = (1 << KEY_DOWN) | (1 << FLAGS_CHANGED);
    const MAX_EVENTS: usize = 1_000;
    const CMD: u64 = 1 << 20;
    const SHIFT: u64 = 1 << 17;
    const OPTION: u64 = 1 << 19;
    const CONTROL: u64 = 1 << 18;
    const FUNCTION: u64 = 1 << 23;
    const AX_SUCCESS: i32 = 0;
    const AX_ERROR_ATTRIBUTE_UNSUPPORTED: i32 = -25205;
    const AX_ERROR_NO_VALUE: i32 = -25212;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXUIElementCreateSystemWide() -> *mut c_void;
        fn AXUIElementCopyAttributeValue(
            element: *mut c_void,
            attribute: CFStringRef,
            value: *mut CFTypeRef,
        ) -> i32;
        fn AXUIElementSetMessagingTimeout(element: *mut c_void, timeout: f32) -> i32;
        fn AXUIElementGetPid(element: *mut c_void, pid: *mut i32) -> i32;
        fn CGPreflightListenEventAccess() -> bool;
    }

    #[link(name = "Carbon", kind = "framework")]
    extern "C" {
        fn IsSecureEventInputEnabled() -> bool;
    }

    #[derive(Default)]
    struct State {
        active: bool,
        generation: u64,
        expires_at: u64,
        excluded_apps: Vec<String>,
        pending: VecDeque<KeyboardEvent>,
        status: &'static str,
        global_monitor: usize,
        local_monitor: usize,
    }

    fn state() -> &'static Mutex<State> {
        static STATE: OnceLock<Mutex<State>> = OnceLock::new();
        STATE.get_or_init(|| {
            Mutex::new(State {
                status: "off",
                ..State::default()
            })
        })
    }

    #[derive(Clone)]
    struct Foreground {
        pid: i32,
        app_name: String,
        bundle_id: Option<String>,
    }

    enum FocusSafety {
        Allow { pid: i32, element: CFType },
        Password,
        Unknown,
    }

    pub fn poll(
        app: tauri::AppHandle,
        options: KeyboardObservationOptions,
    ) -> Result<KeyboardBatch, String> {
        let now = now_ms()?;
        if !unsafe { AXIsProcessTrusted() } {
            return Ok(pause("accessibility-permission-required"));
        }
        if !unsafe { CGPreflightListenEventAccess() } {
            return Ok(pause("input-permission-required"));
        }

        let (install, generation) = {
            let guard = state()
                .lock()
                .map_err(|_| "keyboard-observation-state-poisoned")?;
            (
                guard.global_monitor == 0 && guard.local_monitor == 0,
                guard.generation,
            )
        };
        if install {
            install_monitors(&app)?;
        }

        {
            let mut guard = state()
                .lock()
                .map_err(|_| "keyboard-observation-state-poisoned")?;
            if guard.generation != generation {
                // stop won an in-flight poll race; do not revive capture from an old tick.
                drop(guard);
                remove_monitors(&app)?;
                return Ok(batch("off"));
            }
            // overflow is intentionally sticky until stop; a new poll must not resume it.
            if guard.status == "overflow" {
                return Ok(batch_with(&mut guard));
            }
            guard.active = true;
            guard.expires_at = options.ends_at.min(now.saturating_add(HEARTBEAT_MS));
            guard.excluded_apps = options.excluded_apps;
        }

        // Refresh the visible protection state on each heartbeat without looking
        // at an NSEvent/key value. This keeps password/unknown/excluded visible
        // even while the user is not pressing a key.
        let status = autoreleasepool(|_| current_focus_status());
        let mut guard = state()
            .lock()
            .map_err(|_| "keyboard-observation-state-poisoned")?;
        if guard.active {
            guard.status = status;
        }
        Ok(batch_with(&mut guard))
    }

    pub fn stop(app: tauri::AppHandle) -> Result<(), String> {
        {
            let mut guard = state()
                .lock()
                .map_err(|_| "keyboard-observation-state-poisoned")?;
            guard.active = false;
            guard.generation = guard.generation.wrapping_add(1);
            guard.expires_at = 0;
            guard.excluded_apps.clear();
            guard.pending.clear();
            guard.status = "off";
        }
        remove_monitors(&app)
    }

    fn batch(status: &'static str) -> KeyboardBatch {
        KeyboardBatch {
            status: status.into(),
            events: Vec::new(),
        }
    }

    fn pause(status: &'static str) -> KeyboardBatch {
        if let Ok(mut state) = state().lock() {
            state.active = false;
            state.expires_at = 0;
            state.pending.clear();
            state.status = status;
        }
        batch(status)
    }

    fn batch_with(state: &mut State) -> KeyboardBatch {
        let status = state.status.to_string();
        let events = state.pending.drain(..).collect();
        KeyboardBatch { status, events }
    }

    fn install_monitors(app: &tauri::AppHandle) -> Result<(), String> {
        let (tx, rx) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            let result = autoreleasepool(|_| unsafe {
                let class =
                    AnyClass::get(c"NSEvent").ok_or("keyboard-observation-nsevent-unavailable")?;
                let global_handler = RcBlock::new(move |event: *mut AnyObject| {
                    observe_event(event, None);
                });
                let local_pid = std::process::id() as i32;
                let local_handler = RcBlock::new(move |event: *mut AnyObject| -> *mut AnyObject {
                    observe_event(event, Some(local_pid));
                    event
                });
                // Cocoa copies the handler block for the monitor lifetime and releases it
                // from removeMonitor:. Keeping our own leaked copy would grow on every
                // start/stop cycle.
                let global: *mut AnyObject = msg_send![
                    class,
                    addGlobalMonitorForEventsMatchingMask: MASK,
                    handler: &*global_handler
                ];
                let local: *mut AnyObject = msg_send![
                    class,
                    addLocalMonitorForEventsMatchingMask: MASK,
                    handler: &*local_handler
                ];
                if global.is_null() || local.is_null() {
                    if !global.is_null() {
                        let _: () = msg_send![class, removeMonitor: global];
                    }
                    if !local.is_null() {
                        let _: () = msg_send![class, removeMonitor: local];
                    }
                    return Err("keyboard-observation-monitor-unavailable".into());
                }
                let mut state = match state().lock() {
                    Ok(state) => state,
                    Err(_) => {
                        let _: () = msg_send![class, removeMonitor: global];
                        let _: () = msg_send![class, removeMonitor: local];
                        return Err("keyboard-observation-state-poisoned".into());
                    }
                };
                state.global_monitor = global as usize;
                state.local_monitor = local as usize;
                Ok(())
            });
            let _ = tx.send(result);
        })
        .map_err(|error| error.to_string())?;
        rx.recv()
            .map_err(|_| "keyboard-observation-main-thread-unavailable".to_string())?
    }

    fn remove_monitors(app: &tauri::AppHandle) -> Result<(), String> {
        let (global, local) = {
            let mut state = state()
                .lock()
                .map_err(|_| "keyboard-observation-state-poisoned")?;
            let monitors = (state.global_monitor, state.local_monitor);
            state.global_monitor = 0;
            state.local_monitor = 0;
            monitors
        };
        if global == 0 && local == 0 {
            return Ok(());
        }
        let (tx, rx) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            autoreleasepool(|_| unsafe {
                if let Some(class) = AnyClass::get(c"NSEvent") {
                    if global != 0 {
                        let _: () = msg_send![class, removeMonitor: global as *mut AnyObject];
                    }
                    if local != 0 {
                        let _: () = msg_send![class, removeMonitor: local as *mut AnyObject];
                    }
                }
            });
            let _ = tx.send(());
        })
        .map_err(|error| error.to_string())?;
        rx.recv()
            .map_err(|_| "keyboard-observation-main-thread-unavailable".to_string())?;
        Ok(())
    }

    fn observe_event(event: *mut AnyObject, event_pid: Option<i32>) {
        if event.is_null() || !lease_is_live() {
            return;
        }
        autoreleasepool(|_| unsafe {
            // Secure Event Input can cover system authentication even when AX has
            // no focused element. Treat it as password data and read no key fields.
            if IsSecureEventInputEnabled() {
                set_status("password");
                return;
            }
            let Some(before) = allowed_focus(event_pid) else {
                return;
            };
            let event_type: u64 = msg_send![event, type];
            if event_type != KEY_DOWN && event_type != FLAGS_CHANGED {
                return;
            }
            // Do not inspect characters before both password/focus checks above.
            let key_code: u16 = msg_send![event, keyCode];
            let flags: u64 = msg_send![event, modifierFlags];
            let repeat = if event_type == KEY_DOWN {
                msg_send![event, isARepeat]
            } else {
                false
            };
            let key = if event_type == FLAGS_CHANGED {
                named_key(key_code)
                    .map(str::to_owned)
                    .unwrap_or_else(|| format!("KeyCode-{key_code}"))
            } else {
                key_name(event, key_code)
            };
            // If the user moved focus to a different *identified* element while an event was
            // being delivered, discard instead of attributing it to the prior element. When
            // either side is unclassified there's nothing reliable to compare, so let it record.
            let Some(after) = allowed_focus(event_pid) else {
                return;
            };
            let element_changed = match (&before.element, &after.element) {
                (Some(a), Some(b)) => a != b,
                _ => false,
            };
            if before.pid != after.pid || element_changed {
                set_status("unknown");
                return;
            }
            enqueue(KeyboardEvent {
                at: now_ms().unwrap_or_default(),
                app_name: before.app_name,
                bundle_id: before.bundle_id,
                key_code,
                key,
                modifiers: modifiers(flags),
                repeat,
            });
        });
    }

    fn lease_is_live() -> bool {
        let now = now_ms().unwrap_or(u64::MAX);
        let mut state = match state().lock() {
            Ok(value) => value,
            Err(_) => return false,
        };
        if !state.active {
            return false;
        }
        if now >= state.expires_at {
            state.active = false;
            state.pending.clear();
            state.status = "expired";
            return false;
        }
        true
    }

    #[derive(Clone)]
    struct AllowedFocus {
        pid: i32,
        // None when the focused control couldn't be classified (AX timeout, unrecognized role, ...).
        // Recorded anyway per product decision: only a *positively identified* password field or
        // secure-input/excluded-app context blocks recording — "can't tell" no longer fails closed.
        element: Option<CFType>,
        app_name: String,
        bundle_id: Option<String>,
    }

    fn allowed_focus(event_pid: Option<i32>) -> Option<AllowedFocus> {
        let before = match foreground() {
            Some(value) => value,
            None => return None,
        };
        if before.app_name.eq_ignore_ascii_case("loginwindow")
            || before.bundle_id.as_deref() == Some("com.apple.loginwindow")
        {
            set_status("password");
            return None;
        }
        if is_excluded(&before) {
            set_status("excluded");
            return None;
        }
        if event_pid.is_some_and(|pid| pid != before.pid) {
            return None;
        }
        match focused_safety(before.pid) {
            FocusSafety::Allow { pid, element } if pid == before.pid => Some(AllowedFocus {
                pid,
                element: Some(element),
                app_name: before.app_name,
                bundle_id: before.bundle_id,
            }),
            FocusSafety::Password => {
                set_status("password");
                None
            }
            _ => Some(AllowedFocus {
                pid: before.pid,
                element: None,
                app_name: before.app_name,
                bundle_id: before.bundle_id,
            }),
        }
    }

    fn enqueue(event: KeyboardEvent) {
        let mut state = match state().lock() {
            Ok(value) => value,
            Err(_) => return,
        };
        let now = now_ms().unwrap_or(u64::MAX);
        if !state.active {
            return;
        }
        if now >= state.expires_at {
            state.active = false;
            state.pending.clear();
            state.status = "expired";
            return;
        }
        if state.pending.len() >= MAX_EVENTS {
            state.active = false;
            state.pending.clear();
            state.status = "overflow";
            return;
        }
        state.pending.push_back(event);
        state.status = "recording";
    }

    fn set_status(status: &'static str) {
        if let Ok(mut state) = state().lock() {
            if state.active {
                state.status = status;
            }
        }
    }

    fn current_focus_status() -> &'static str {
        if unsafe { IsSecureEventInputEnabled() } {
            return "password";
        }
        let Some(foreground) = foreground() else {
            return "unknown";
        };
        if foreground.app_name.eq_ignore_ascii_case("loginwindow")
            || foreground.bundle_id.as_deref() == Some("com.apple.loginwindow")
        {
            return "password";
        }
        if is_excluded(&foreground) {
            return "excluded";
        }
        match focused_safety(foreground.pid) {
            FocusSafety::Allow { pid, .. } if pid == foreground.pid => "recording",
            FocusSafety::Password => "password",
            // Can't classify the focused control (AX timeout, unrecognized role, ...); still
            // recording — only a positively identified password field pauses capture.
            _ => "recording",
        }
    }

    fn focused_safety(expected_pid: i32) -> FocusSafety {
        unsafe {
            let system = AXUIElementCreateSystemWide();
            if system.is_null() {
                return FocusSafety::Unknown;
            }
            let _system_guard = CFType::wrap_under_create_rule(system as CFTypeRef);
            // A short timeout protects the NSEvent main thread from an unresponsive app.
            let timeout_error = AXUIElementSetMessagingTimeout(system, 0.015);
            if timeout_error != AX_SUCCESS {
                return FocusSafety::Unknown;
            }
            let focused_app = match copy_attribute(system, "AXFocusedApplication") {
                Ok(value) => value,
                Err(_) => return FocusSafety::Unknown,
            };
            let timeout_error =
                AXUIElementSetMessagingTimeout(focused_app.as_CFTypeRef() as *mut c_void, 0.015);
            if timeout_error != AX_SUCCESS {
                return FocusSafety::Unknown;
            }
            let mut pid = 0;
            let pid_error = AXUIElementGetPid(focused_app.as_CFTypeRef() as *mut c_void, &mut pid);
            if pid_error != AX_SUCCESS || pid != expected_pid {
                return FocusSafety::Unknown;
            }
            let focused = match copy_attribute(system, "AXFocusedUIElement") {
                Ok(value) => value,
                Err(_) => return FocusSafety::Unknown,
            };
            let timeout_error =
                AXUIElementSetMessagingTimeout(focused.as_CFTypeRef() as *mut c_void, 0.015);
            if timeout_error != AX_SUCCESS {
                return FocusSafety::Unknown;
            }
            let mut focused_pid = 0;
            let pid_error =
                AXUIElementGetPid(focused.as_CFTypeRef() as *mut c_void, &mut focused_pid);
            if pid_error != AX_SUCCESS || focused_pid != expected_pid {
                return FocusSafety::Unknown;
            }
            let role = copy_attribute(focused.as_CFTypeRef() as *mut c_void, "AXRole")
                .ok()
                .and_then(cf_string);
            let subrole = match copy_attribute(focused.as_CFTypeRef() as *mut c_void, "AXSubrole") {
                Ok(value) => Ok(cf_string(value)),
                Err(error) => Err(error),
            };
            let subrole_for_class = match &subrole {
                Ok(value) => Ok(value.as_deref()),
                Err(error) => Err(*error),
            };
            match classify_focus(role.as_deref(), subrole_for_class) {
                FocusClass::Allow => FocusSafety::Allow {
                    pid,
                    element: focused,
                },
                FocusClass::Password => FocusSafety::Password,
                FocusClass::Unknown => FocusSafety::Unknown,
            }
        }
    }

    unsafe fn copy_attribute(element: *mut c_void, name: &str) -> Result<CFType, i32> {
        let attribute = CFString::new(name);
        let mut value: CFTypeRef = std::ptr::null();
        let error =
            AXUIElementCopyAttributeValue(element, attribute.as_concrete_TypeRef(), &mut value);
        if error != AX_SUCCESS || value.is_null() {
            return Err(error);
        }
        Ok(CFType::wrap_under_create_rule(value))
    }

    fn cf_string(value: CFType) -> Option<String> {
        let value = value.downcast::<CFString>()?;
        Some(value.to_string())
    }

    #[derive(Debug, PartialEq)]
    enum FocusClass {
        Allow,
        Password,
        Unknown,
    }

    fn classify_focus(role: Option<&str>, subrole: Result<Option<&str>, i32>) -> FocusClass {
        if matches!(subrole, Ok(Some("AXSecureTextField"))) {
            return FocusClass::Password;
        }
        // kAXSubrole is optional. Only its two documented "absent" errors are
        // safe; malformed values and real AX failures remain fail-closed.
        if matches!(subrole, Ok(None))
            || matches!(subrole, Err(error) if error != AX_ERROR_ATTRIBUTE_UNSUPPORTED && error != AX_ERROR_NO_VALUE)
        {
            return FocusClass::Unknown;
        }
        match role {
            Some(
                "AXTextField" | "AXTextArea" | "AXComboBox" | "AXSearchField" | "AXButton"
                | "AXCheckBox" | "AXRadioButton" | "AXMenuItem" | "AXMenuBarItem"
                | "AXToolbarButton" | "AXPopUpButton" | "AXSlider" | "AXIncrementor" | "AXLink"
                | "AXStaticText",
            ) => FocusClass::Allow,
            None => FocusClass::Unknown,
            Some(_) => FocusClass::Unknown,
        }
    }

    fn foreground() -> Option<Foreground> {
        unsafe {
            let workspace: *mut AnyObject =
                msg_send![AnyClass::get(c"NSWorkspace")?, sharedWorkspace];
            if workspace.is_null() {
                return None;
            }
            let app: *mut AnyObject = msg_send![workspace, frontmostApplication];
            if app.is_null() {
                return None;
            }
            let pid: i32 = msg_send![app, processIdentifier];
            Some(Foreground {
                pid,
                app_name: ns_string(msg_send![app, localizedName])?,
                bundle_id: ns_string(msg_send![app, bundleIdentifier]),
            })
        }
    }

    fn is_excluded(app: &Foreground) -> bool {
        let state = match state().lock() {
            Ok(value) => value,
            Err(_) => return true,
        };
        state.excluded_apps.iter().any(|excluded| {
            excluded.eq_ignore_ascii_case(&app.app_name)
                || app
                    .bundle_id
                    .as_deref()
                    .is_some_and(|id| excluded.eq_ignore_ascii_case(id))
        })
    }

    unsafe fn ns_string(value: *mut AnyObject) -> Option<String> {
        if value.is_null() {
            return None;
        }
        let utf8: *const c_char = msg_send![value, UTF8String];
        (!utf8.is_null()).then(|| CStr::from_ptr(utf8).to_string_lossy().into_owned())
    }

    unsafe fn key_name(event: *mut AnyObject, key_code: u16) -> String {
        if let Some(name) = named_key(key_code) {
            return name.into();
        }
        let characters: *mut AnyObject = msg_send![event, charactersIgnoringModifiers];
        ns_string(characters)
            .filter(|value| !value.is_empty())
            .map(|value| value.chars().take(8).collect())
            .unwrap_or_else(|| format!("KeyCode-{key_code}"))
    }

    fn named_key(key_code: u16) -> Option<&'static str> {
        Some(match key_code {
            36 | 76 => "Enter",
            48 => "Tab",
            51 => "Backspace",
            53 => "Escape",
            49 => "Space",
            115 => "Home",
            116 => "PageUp",
            117 => "DeleteForward",
            119 => "End",
            121 => "PageDown",
            123 => "ArrowLeft",
            124 => "ArrowRight",
            125 => "ArrowDown",
            126 => "ArrowUp",
            54 | 55 => "Meta",
            56 | 60 => "Shift",
            57 => "CapsLock",
            58 | 61 => "Alt",
            59 | 62 => "Control",
            63 => "Fn",
            _ => return None,
        })
    }

    fn modifiers(flags: u64) -> Vec<String> {
        let mut values = Vec::with_capacity(5);
        if flags & CMD != 0 {
            values.push("Meta".into());
        }
        if flags & CONTROL != 0 {
            values.push("Control".into());
        }
        if flags & OPTION != 0 {
            values.push("Alt".into());
        }
        if flags & SHIFT != 0 {
            values.push("Shift".into());
        }
        if flags & FUNCTION != 0 {
            values.push("Fn".into());
        }
        values
    }

    #[cfg(test)]
    mod tests {
        use super::{
            classify_focus, FocusClass, AX_ERROR_ATTRIBUTE_UNSUPPORTED, AX_ERROR_NO_VALUE,
        };

        #[test]
        fn password_and_unknown_text_controls_fail_closed() {
            assert_eq!(
                classify_focus(Some("AXTextField"), Ok(Some("AXSecureTextField"))),
                FocusClass::Password
            );
            assert_eq!(
                classify_focus(Some("AXTextArea"), Err(AX_ERROR_NO_VALUE)),
                FocusClass::Allow
            );
            assert_eq!(
                classify_focus(Some("AXTextField"), Err(AX_ERROR_ATTRIBUTE_UNSUPPORTED)),
                FocusClass::Allow
            );
            assert_eq!(
                classify_focus(Some("AXTextField"), Err(-25204)),
                FocusClass::Unknown
            );
            assert_eq!(
                classify_focus(Some("AXButton"), Err(-25204)),
                FocusClass::Unknown
            );
            assert_eq!(
                classify_focus(Some("AXWebArea"), Err(AX_ERROR_NO_VALUE)),
                FocusClass::Unknown
            );
        }
    }
}
