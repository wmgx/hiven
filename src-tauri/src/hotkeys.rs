use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::Emitter;

/// Debug: append a line to /tmp/hiven-hotkey.log for diagnosing release builds.
#[cfg(target_os = "macos")]
pub(crate) fn hotkey_log(msg: &str) {
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/hiven-hotkey.log")
    {
        let _ = writeln!(f, "[{:?}] {}", Instant::now(), msg);
    }
}

const DOUBLE_MODIFIER_HOTKEY_ERROR_EVENT: &str = "hiven://double-modifier-hotkey-error";
const DOUBLE_MODIFIER_HOTKEY_READY_EVENT: &str = "hiven://double-modifier-hotkey-ready";
const ROUTE_GLOBAL_PINNED_LAUNCHER_SHORTCUT_EVENT: &str =
    "hiven://route-global-pinned-launcher-shortcut";
const DEFAULT_DOUBLE_MODIFIER_THRESHOLD_MS: u64 = 300;

#[derive(Clone, Debug, serde::Serialize)]
pub struct HotkeyRegistrationStatus {
    pub status: String,
}

struct DoubleModifierHotkeyState {
    enabled: Mutex<bool>,
    listener_running: Mutex<bool>,
    modifier: Mutex<DoubleModifier>,
    /// Raw CFMachPortRef for the CGEventTap so the callback can re-enable
    /// the tap when macOS disables it due to timeout.
    #[cfg(target_os = "macos")]
    tap_port: Mutex<Option<SendableMachPort>>,
    /// Windows: persistent double-tap detector shared with the hook callback.
    #[cfg(target_os = "windows")]
    detector: Mutex<DoubleModifierDetector>,
    /// Windows: app handle used by the hook callback to open the launcher.
    /// Set once before the hook thread starts; never changes.
    #[cfg(target_os = "windows")]
    app_handle: std::sync::OnceLock<tauri::AppHandle>,
}

/// Wrapper to make CFMachPortRef Send+Sync. The pointer is only ever used
/// to call CGEventTapEnable which is thread-safe for a given tap.
#[cfg(target_os = "macos")]
struct SendableMachPort(core_foundation::mach_port::CFMachPortRef);
#[cfg(target_os = "macos")]
unsafe impl Send for SendableMachPort {}
#[cfg(target_os = "macos")]
unsafe impl Sync for SendableMachPort {}

static DOUBLE_MODIFIER_HOTKEY_STATE: OnceLock<Arc<DoubleModifierHotkeyState>> = OnceLock::new();

#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Deserialize, serde::Serialize)]
pub enum DoubleModifier {
    Command,
    Shift,
    Option,
}

impl DoubleModifier {
    fn label(self) -> &'static str {
        match self {
            DoubleModifier::Command => "Cmd",
            DoubleModifier::Shift => "Shift",
            DoubleModifier::Option => "Option",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Key {
    Modifier,
    Other,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum KeyPhase {
    Down,
    Up,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct Modifiers {
    pub other: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct KeyEvent {
    pub key: Key,
    pub phase: KeyPhase,
    pub timestamp: Duration,
    pub modifiers: Modifiers,
}

impl KeyEvent {
    pub fn new(key: Key, phase: KeyPhase, timestamp_ms: u64, modifiers: Modifiers) -> Self {
        Self {
            key,
            phase,
            timestamp: Duration::from_millis(timestamp_ms),
            modifiers,
        }
    }
}

pub struct DoubleModifierDetector {
    threshold: Duration,
    last_modifier_down: Option<Duration>,
    current_modifier_down: Option<Duration>,
    current_modifier_press_valid: bool,
}

impl DoubleModifierDetector {
    pub fn new(threshold: Duration) -> Self {
        Self {
            threshold,
            last_modifier_down: None,
            current_modifier_down: None,
            current_modifier_press_valid: false,
        }
    }

    pub fn handle_event(&mut self, event: KeyEvent) -> bool {
        match (event.key, event.phase) {
            (Key::Modifier, KeyPhase::Down) => self.handle_modifier_down(event),
            (Key::Modifier, KeyPhase::Up) => self.handle_modifier_up(event),
            (Key::Other, _) => {
                self.reset();
                false
            }
        }
    }

    fn handle_modifier_down(&mut self, event: KeyEvent) -> bool {
        if event.modifiers.other {
            self.reset();
            return false;
        }

        self.current_modifier_press_valid = true;
        self.current_modifier_down = Some(event.timestamp);
        let Some(last_modifier_down) = self.last_modifier_down else {
            return false;
        };

        let within_threshold = event.timestamp >= last_modifier_down
            && event.timestamp - last_modifier_down <= self.threshold;
        if within_threshold {
            self.last_modifier_down = None;
            self.current_modifier_down = None;
            true
        } else {
            self.last_modifier_down = None;
            false
        }
    }

    fn handle_modifier_up(&mut self, event: KeyEvent) -> bool {
        if self.current_modifier_press_valid && !event.modifiers.other {
            if let Some(current_modifier_down) = self.current_modifier_down {
                let was_short_press = event.timestamp >= current_modifier_down
                    && event.timestamp - current_modifier_down <= self.threshold;
                self.last_modifier_down = was_short_press.then_some(current_modifier_down);
            } else {
                self.last_modifier_down = None;
            }
        } else {
            self.last_modifier_down = None;
        }
        self.current_modifier_down = None;
        self.current_modifier_press_valid = false;
        false
    }

    pub fn reset(&mut self) {
        self.last_modifier_down = None;
        self.current_modifier_down = None;
        self.current_modifier_press_valid = false;
    }
}

#[tauri::command]
pub fn register_double_modifier_hotkey(
    app: tauri::AppHandle,
    modifier: DoubleModifier,
) -> Result<HotkeyRegistrationStatus, String> {
    register_double_modifier_hotkey_impl(app, modifier)
}

#[tauri::command]
pub fn unregister_double_modifier_hotkey() -> Result<HotkeyRegistrationStatus, String> {
    if let Some(state) = DOUBLE_MODIFIER_HOTKEY_STATE.get() {
        *state.enabled.lock().map_err(|e| e.to_string())? = false;
    }
    Ok(HotkeyRegistrationStatus {
        status: "Double modifier detector unregistered".to_string(),
    })
}

#[cfg(target_os = "macos")]
fn register_double_modifier_hotkey_impl(
    app: tauri::AppHandle,
    modifier: DoubleModifier,
) -> Result<HotkeyRegistrationStatus, String> {
    hotkey_log(&format!("register_double_modifier_hotkey_impl called with {:?}", modifier));

    let state = DOUBLE_MODIFIER_HOTKEY_STATE
        .get_or_init(|| {
            Arc::new(DoubleModifierHotkeyState {
                enabled: Mutex::new(false),
                listener_running: Mutex::new(false),
                modifier: Mutex::new(DoubleModifier::Command),
                #[cfg(target_os = "macos")]
                tap_port: Mutex::new(None),
            })
        })
        .clone();
    *state.enabled.lock().map_err(|e| e.to_string())? = true;
    *state.modifier.lock().map_err(|e| e.to_string())? = modifier;

    // Show the accessibility prompt (non-blocking — returns immediately even if user hasn't acted yet).
    let trusted = check_accessibility_permission(true);
    hotkey_log(&format!("accessibility trusted: {}", trusted));

    if trusted {
        let mut listener_running = state.listener_running.lock().map_err(|e| e.to_string())?;
        if !*listener_running {
            *listener_running = true;
            start_double_modifier_listener(Arc::clone(&state), app);
        }
        Ok(HotkeyRegistrationStatus {
            status: format!("Double {} registered", modifier.label()),
        })
    } else {
        // Prompt was shown to the user. Poll in the background and auto-register once granted.
        // This avoids requiring a restart after granting accessibility in System Settings.
        start_accessibility_poller(Arc::clone(&state), app);
        Ok(HotkeyRegistrationStatus {
            status: "Accessibility permission required — please grant access in System Settings".to_string(),
        })
    }
}

#[cfg(target_os = "macos")]
pub fn check_accessibility_trusted() -> bool {
    check_accessibility_permission(false)
}

#[cfg(target_os = "macos")]
fn check_accessibility_permission(with_prompt: bool) -> bool {
    use core_foundation::base::TCFType;
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::string::CFString;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrustedWithOptions(
            options: core_foundation::dictionary::CFDictionaryRef,
        ) -> bool;
    }

    let prompt_key = CFString::new("AXTrustedCheckOptionPrompt");
    let prompt = if with_prompt {
        CFBoolean::true_value()
    } else {
        CFBoolean::false_value()
    };
    let options = CFDictionary::from_CFType_pairs(&[(prompt_key.as_CFType(), prompt.as_CFType())]);
    unsafe { AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef()) }
}

/// After showing the accessibility prompt, poll silently until the user grants access,
/// then auto-register the event tap without requiring an app restart.
#[cfg(target_os = "macos")]
fn start_accessibility_poller(state: Arc<DoubleModifierHotkeyState>, app: tauri::AppHandle) {
    std::thread::spawn(move || {
        hotkey_log("accessibility poller started");
        // Poll every 500 ms for up to 2 minutes.
        for _ in 0..240 {
            std::thread::sleep(Duration::from_millis(500));

            // Stop polling if the hotkey was disabled in the meantime.
            if !state.enabled.lock().map(|v| *v).unwrap_or(false) {
                hotkey_log("accessibility poller: hotkey disabled, stopping");
                return;
            }

            if check_accessibility_permission(false) {
                hotkey_log("accessibility poller: permission granted, starting listener");
                if let Ok(mut listener_running) = state.listener_running.lock() {
                    if !*listener_running {
                        *listener_running = true;
                        let modifier = state
                            .modifier
                            .lock()
                            .map(|v| *v)
                            .unwrap_or(DoubleModifier::Command);
                        drop(listener_running);
                        start_double_modifier_listener(Arc::clone(&state), app.clone());
                        let _ = app.emit(
                            DOUBLE_MODIFIER_HOTKEY_READY_EVENT,
                            serde_json::json!({ "status": format!("Double {} registered", modifier.label()) }),
                        );
                    }
                }
                return;
            }
        }
        hotkey_log("accessibility poller: timed out waiting for permission");
        let _ = app.emit(
            DOUBLE_MODIFIER_HOTKEY_ERROR_EVENT,
            serde_json::json!({ "error": "Accessibility permission was not granted. Please grant access in System Settings › Privacy & Security › Accessibility, then re-enable the shortcut." }),
        );
    });
}

#[cfg(target_os = "windows")]
fn register_double_modifier_hotkey_impl(
    app: tauri::AppHandle,
    modifier: DoubleModifier,
) -> Result<HotkeyRegistrationStatus, String> {
    let state = DOUBLE_MODIFIER_HOTKEY_STATE
        .get_or_init(|| {
            Arc::new(DoubleModifierHotkeyState {
                enabled: Mutex::new(false),
                listener_running: Mutex::new(false),
                modifier: Mutex::new(DoubleModifier::Command),
                #[cfg(target_os = "windows")]
                detector: Mutex::new(DoubleModifierDetector::new(Duration::from_millis(
                    DEFAULT_DOUBLE_MODIFIER_THRESHOLD_MS,
                ))),
                #[cfg(target_os = "windows")]
                app_handle: std::sync::OnceLock::new(),
            })
        })
        .clone();

    *state.enabled.lock().map_err(|e| e.to_string())? = true;
    *state.modifier.lock().map_err(|e| e.to_string())? = modifier;
    // Reset detector whenever modifier is (re)configured.
    if let Ok(mut det) = state.detector.lock() {
        det.reset();
    }

    let mut listener_running = state.listener_running.lock().map_err(|e| e.to_string())?;
    if !*listener_running {
        *listener_running = true;
        drop(listener_running);
        start_double_modifier_listener(Arc::clone(&state), app);
    }

    Ok(HotkeyRegistrationStatus {
        status: format!("Double {} registered", modifier.label()),
    })
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn register_double_modifier_hotkey_impl(
    _app: tauri::AppHandle,
    _modifier: DoubleModifier,
) -> Result<HotkeyRegistrationStatus, String> {
    Err("Double modifier global hotkey is not supported on this platform".to_string())
}

// ─── Windows low-level keyboard hook implementation ─────────────────────────

#[cfg(target_os = "windows")]
fn start_double_modifier_listener(state: Arc<DoubleModifierHotkeyState>, app: tauri::AppHandle) {
    // Store the app handle once; the hook callback reads it without locking.
    let _ = state.app_handle.set(app);

    std::thread::spawn(move || {
        use windows::Win32::System::LibraryLoader::GetModuleHandleW;
        use windows::Win32::UI::WindowsAndMessaging::{
            DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage,
            UnhookWindowsHookEx, WH_KEYBOARD_LL, MSG,
        };

        let hmod = unsafe { GetModuleHandleW(None).unwrap_or_default() };

        let hook = unsafe {
            SetWindowsHookExW(WH_KEYBOARD_LL, Some(low_level_keyboard_proc), hmod, 0)
        };
        let hook = match hook {
            Ok(h) => h,
            Err(e) => {
                eprintln!("[hiven] Failed to install keyboard hook: {}", e);
                if let Some(s) = DOUBLE_MODIFIER_HOTKEY_STATE.get() {
                    if let Ok(mut lr) = s.listener_running.lock() {
                        *lr = false;
                    }
                }
                return;
            }
        };

        // Message pump required for WH_KEYBOARD_LL callbacks to fire.
        let mut msg = MSG::default();
        unsafe {
            while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            UnhookWindowsHookEx(hook).ok();
        }

        if let Some(s) = DOUBLE_MODIFIER_HOTKEY_STATE.get() {
            if let Ok(mut lr) = s.listener_running.lock() {
                *lr = false;
            }
        }
    });
}

/// Thread-local: tracks which modifier the hook last observed so the detector
/// can be reset when the configured modifier changes.
#[cfg(target_os = "windows")]
thread_local! {
    static HOOK_LAST_MODIFIER: std::cell::Cell<Option<DoubleModifier>> =
        std::cell::Cell::new(None);
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn low_level_keyboard_proc(
    code: i32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, KBDLLHOOKSTRUCT, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
    };
    use windows::Win32::Foundation::HHOOK;

    if code >= 0 {
        if let Some(state) = DOUBLE_MODIFIER_HOTKEY_STATE.get() {
            let enabled = state.enabled.lock().map(|v| *v).unwrap_or(false);
            if enabled {
                let kbd = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
                let vk = kbd.vkCode;
                let timestamp_ms = kbd.time as u64;

                let modifier = state
                    .modifier
                    .lock()
                    .map(|v| *v)
                    .unwrap_or(DoubleModifier::Command);

                // Reset detector when modifier setting changes.
                HOOK_LAST_MODIFIER.with(|cell| {
                    if cell.get() != Some(modifier) {
                        if let Ok(mut det) = state.detector.lock() {
                            det.reset();
                        }
                        cell.set(Some(modifier));
                    }
                });

                let is_target = windows_is_target_modifier(vk, modifier);
                let msg = wparam.0 as u32;
                let is_down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
                let is_up = msg == WM_KEYUP || msg == WM_SYSKEYUP;

                if is_target && (is_down || is_up) {
                    let has_others = windows_has_other_modifiers(modifier);
                    let phase = if is_down { KeyPhase::Down } else { KeyPhase::Up };
                    let event = KeyEvent::new(
                        Key::Modifier,
                        phase,
                        timestamp_ms,
                        Modifiers { other: has_others },
                    );
                    if let Ok(mut det) = state.detector.lock() {
                        let triggered = det.handle_event(event);
                        if triggered {
                            if let Some(app) = state.app_handle.get() {
                                let app_clone = app.clone();
                                std::thread::spawn(move || {
                                    windows_route_pinned_launcher(app_clone);
                                });
                            }
                        }
                    }
                } else if is_down && !windows_is_any_modifier_vk(vk) {
                    // A regular (non-modifier) key was pressed — invalidate double-tap sequence.
                    if let Ok(mut det) = state.detector.lock() {
                        det.handle_event(KeyEvent::new(
                            Key::Other,
                            KeyPhase::Down,
                            timestamp_ms,
                            Modifiers { other: true },
                        ));
                    }
                }
            }
        }
    }

    CallNextHookEx(HHOOK::default(), code, wparam, lparam)
}

#[cfg(target_os = "windows")]
fn windows_is_target_modifier(vk: u32, modifier: DoubleModifier) -> bool {
    match modifier {
        DoubleModifier::Command => vk == 0x5B || vk == 0x5C, // VK_LWIN, VK_RWIN
        DoubleModifier::Shift => vk == 0xA0 || vk == 0xA1,   // VK_LSHIFT, VK_RSHIFT
        DoubleModifier::Option => vk == 0xA4 || vk == 0xA5,  // VK_LMENU, VK_RMENU (Alt)
    }
}

#[cfg(target_os = "windows")]
fn windows_is_any_modifier_vk(vk: u32) -> bool {
    matches!(
        vk,
        0x10  // VK_SHIFT
        | 0x11  // VK_CONTROL
        | 0x12  // VK_MENU (Alt)
        | 0x5B  // VK_LWIN
        | 0x5C  // VK_RWIN
        | 0xA0  // VK_LSHIFT
        | 0xA1  // VK_RSHIFT
        | 0xA2  // VK_LCONTROL
        | 0xA3  // VK_RCONTROL
        | 0xA4  // VK_LMENU
        | 0xA5  // VK_RMENU
    )
}

/// Check whether any modifier *other* than the configured one is currently held.
#[cfg(target_os = "windows")]
fn windows_has_other_modifiers(modifier: DoubleModifier) -> bool {
    #[inline]
    fn pressed(vk: i32) -> bool {
        unsafe {
            use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
            (GetAsyncKeyState(vk) as u16 & 0x8000) != 0
        }
    }
    let ctrl = pressed(0x11);
    let shift = pressed(0x10);
    let alt = pressed(0x12);
    let win = pressed(0x5B) || pressed(0x5C);
    match modifier {
        DoubleModifier::Command => ctrl || shift || alt,
        DoubleModifier::Shift => ctrl || alt || win,
        DoubleModifier::Option => ctrl || shift || win,
    }
}

#[cfg(target_os = "windows")]
fn windows_route_pinned_launcher(app: tauri::AppHandle) {
    use tauri::Manager;
    let main_focused = app
        .get_webview_window("main")
        .and_then(|w| w.is_focused().ok())
        .unwrap_or(false);
    if main_focused {
        let _ = app.emit(
            ROUTE_GLOBAL_PINNED_LAUNCHER_SHORTCUT_EVENT,
            (),
        );
        return;
    }
    if let Err(e) = crate::show_launcher_window_for_hotkey(app) {
        eprintln!("[hiven] Failed to show launcher from double modifier hotkey: {}", e);
    }
}

#[cfg(target_os = "macos")]
fn start_double_modifier_listener(state: Arc<DoubleModifierHotkeyState>, app: tauri::AppHandle) {
    hotkey_log("start_double_modifier_listener: spawning listener thread");
    std::thread::spawn(move || {
        use core_foundation::mach_port::CFMachPortRef;
        use core_foundation::runloop::{kCFRunLoopCommonModes, CFRunLoop};
        use core_graphics::event::{
            CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventType,
        };
        use std::cell::RefCell;

        let callback_app = app.clone();
        let callback_state = Arc::clone(&state);

        struct ListenerState {
            detector: DoubleModifierDetector,
            started_at: Instant,
            modifier: DoubleModifier,
            modifier_was_down: bool,
            flags_changed_count: u64,
        }

        let listener_state = RefCell::new(ListenerState {
            detector: DoubleModifierDetector::new(Duration::from_millis(
                DEFAULT_DOUBLE_MODIFIER_THRESHOLD_MS,
            )),
            started_at: Instant::now(),
            modifier: DoubleModifier::Command,
            modifier_was_down: false,
            flags_changed_count: 0,
        });

        let tap = CGEventTap::new(
            CGEventTapLocation::HID,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::ListenOnly,
            vec![
                CGEventType::KeyDown,
                CGEventType::KeyUp,
                CGEventType::FlagsChanged,
                CGEventType::TapDisabledByTimeout,
            ],
            move |_proxy, event_type, event| {
                // When macOS disables the tap due to timeout, re-enable it immediately.
                // This happens in release builds when the system considers the tap
                // unresponsive (e.g. after sleep/wake cycles or heavy system load).
                if matches!(event_type, CGEventType::TapDisabledByTimeout) {
                    hotkey_log("TapDisabledByTimeout received! re-enabling tap");
                    if let Ok(port_guard) = callback_state.tap_port.lock() {
                        if let Some(ref port) = *port_guard {
                            unsafe {
                                extern "C" {
                                    fn CGEventTapEnable(tap: CFMachPortRef, enable: bool);
                                }
                                CGEventTapEnable(port.0, true);
                            }
                        }
                    }
                    return None;
                }

                let enabled = callback_state.enabled.lock().map(|v| *v).unwrap_or(false);
                let mut s = listener_state.borrow_mut();
                if !enabled {
                    // Only log once to avoid spam — use a static flag
                    s.detector.reset();
                    s.modifier_was_down = false;
                    return None;
                }

                let timestamp = s.started_at.elapsed();

                if matches!(event_type, CGEventType::FlagsChanged) {
                    s.flags_changed_count += 1;
                    // Log every 50th FlagsChanged to prove tap is alive without spam
                    if s.flags_changed_count % 50 == 1 {
                        hotkey_log(&format!("FlagsChanged #{}, modifier_was_down={}", s.flags_changed_count, s.modifier_was_down));
                    }
                    let flags = event.get_flags();
                    let modifier = callback_state
                        .modifier
                        .lock()
                        .map(|value| *value)
                        .unwrap_or(DoubleModifier::Command);
                    if modifier != s.modifier {
                        s.detector.reset();
                        s.modifier = modifier;
                        s.modifier_was_down = modifier_flag_is_down(flags, modifier);
                        return None;
                    }

                    let modifier_now = modifier_flag_is_down(flags, modifier);
                    let has_other_modifiers = has_other_modifier_flags(flags, modifier);

                    if modifier_now && !s.modifier_was_down {
                        let triggered = s.detector.handle_event(KeyEvent {
                            key: Key::Modifier,
                            phase: KeyPhase::Down,
                            timestamp,
                            modifiers: Modifiers {
                                other: has_other_modifiers,
                            },
                        });
                        if triggered {
                            hotkey_log("DOUBLE MODIFIER TRIGGERED! calling open_pinned_launcher");
                            open_pinned_launcher(&callback_app);
                        }
                    } else if !modifier_now && s.modifier_was_down {
                        s.detector.handle_event(KeyEvent {
                            key: Key::Modifier,
                            phase: KeyPhase::Up,
                            timestamp,
                            modifiers: Modifiers {
                                other: has_other_modifiers,
                            },
                        });
                    } else if !modifier_now && !s.modifier_was_down && has_other_modifiers {
                        // Another modifier changed while the configured modifier is not held.
                        s.detector.handle_event(KeyEvent {
                            key: Key::Other,
                            phase: KeyPhase::Down,
                            timestamp,
                            modifiers: Modifiers { other: true },
                        });
                    }
                    s.modifier_was_down = modifier_now;
                } else if matches!(event_type, CGEventType::KeyDown) {
                    // A real key was pressed between modifier taps — invalidate
                    s.detector.reset();
                }
                None
            },
        );

        match tap {
            Ok(tap) => {
                hotkey_log("CGEventTap created successfully, starting RunLoop");
                unsafe {
                    // Store the mach port ref so the callback can re-enable the tap
                    use core_foundation::base::TCFType;
                    if let Ok(mut port_guard) = state.tap_port.lock() {
                        *port_guard = Some(SendableMachPort(tap.mach_port.as_concrete_TypeRef()));
                    }

                    let loop_source = tap
                        .mach_port
                        .create_runloop_source(0)
                        .expect("failed to create runloop source");
                    let run_loop = CFRunLoop::get_current();
                    run_loop.add_source(&loop_source, kCFRunLoopCommonModes);
                    tap.enable();
                    CFRunLoop::run_current();
                }
                if let Ok(mut port_guard) = state.tap_port.lock() {
                    *port_guard = None;
                }
                if let Ok(mut listener_running) = state.listener_running.lock() {
                    *listener_running = false;
                }
            }
            Err(_) => {
                hotkey_log("CGEventTap FAILED to create!");
                eprintln!("[hiven] Failed to create CGEventTap! Check Accessibility permissions.");
                if let Ok(mut listener_running) = state.listener_running.lock() {
                    *listener_running = false;
                }
                if let Ok(mut enabled) = state.enabled.lock() {
                    *enabled = false;
                }
                let _ = app.emit(
                    DOUBLE_MODIFIER_HOTKEY_ERROR_EVENT,
                    serde_json::json!({ "error": "Failed to create CGEventTap. Check Accessibility permissions." }),
                );
            }
        }
    });
}

#[cfg(target_os = "macos")]
fn open_pinned_launcher(app: &tauri::AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        route_pinned_launcher_hotkey(app);
    });
}

#[cfg(target_os = "macos")]
fn route_pinned_launcher_hotkey(app: tauri::AppHandle) {
    use tauri::Manager;

    hotkey_log("route_pinned_launcher_hotkey entered");

    let main_window_focused = app
        .get_webview_window("main")
        .and_then(|window| window.is_focused().ok())
        .unwrap_or(false);
    hotkey_log(&format!("main_window_focused = {}", main_window_focused));
    if main_window_focused {
        let _ = app.emit(ROUTE_GLOBAL_PINNED_LAUNCHER_SHORTCUT_EVENT, ());
        return;
    }

    hotkey_log("calling show_launcher_window_for_hotkey");
    if let Err(error) = crate::show_launcher_window_for_hotkey(app) {
        hotkey_log(&format!("show_launcher_window_for_hotkey ERROR: {}", error));
        eprintln!(
            "[hiven] Failed to show launcher window from double modifier hotkey: {}",
            error
        );
    } else {
        hotkey_log("show_launcher_window_for_hotkey returned Ok");
    }

    // Wake the main RunLoop AFTER submitting the closure via run_on_main_thread
    // (inside show_launcher_window_for_hotkey). If we wake before submitting,
    // the main thread may process the wake, find nothing pending, and go back
    // to sleep before the closure arrives. Waking after ensures the queued
    // closure is dispatched promptly.
    wake_main_runloop();
    hotkey_log("wake_main_runloop called");
}

/// Poke the main CFRunLoop so it wakes from any idle/nap state immediately.
#[cfg(target_os = "macos")]
fn wake_main_runloop() {
    use core_foundation::base::TCFType;
    use core_foundation::runloop::CFRunLoop;
    unsafe {
        core_foundation::runloop::CFRunLoopWakeUp(CFRunLoop::get_main().as_concrete_TypeRef());
    }
}

#[cfg(target_os = "macos")]
fn modifier_flag_is_down(
    flags: core_graphics::event::CGEventFlags,
    modifier: DoubleModifier,
) -> bool {
    use core_graphics::event::CGEventFlags;
    match modifier {
        DoubleModifier::Command => flags.contains(CGEventFlags::CGEventFlagCommand),
        DoubleModifier::Shift => flags.contains(CGEventFlags::CGEventFlagShift),
        DoubleModifier::Option => flags.contains(CGEventFlags::CGEventFlagAlternate),
    }
}

#[cfg(target_os = "macos")]
fn has_other_modifier_flags(
    flags: core_graphics::event::CGEventFlags,
    modifier: DoubleModifier,
) -> bool {
    use core_graphics::event::CGEventFlags;
    let mut other_flags = CGEventFlags::CGEventFlagControl;
    if modifier != DoubleModifier::Command {
        other_flags |= CGEventFlags::CGEventFlagCommand;
    }
    if modifier != DoubleModifier::Shift {
        other_flags |= CGEventFlags::CGEventFlagShift;
    }
    if modifier != DoubleModifier::Option {
        other_flags |= CGEventFlags::CGEventFlagAlternate;
    }
    flags.intersects(other_flags)
}

#[cfg(test)]
mod double_modifier_tests {
    use super::*;

    fn detector() -> DoubleModifierDetector {
        DoubleModifierDetector::new(Duration::from_millis(300))
    }

    fn modifier_down(timestamp_ms: u64) -> KeyEvent {
        KeyEvent::new(
            Key::Modifier,
            KeyPhase::Down,
            timestamp_ms,
            Modifiers { other: false },
        )
    }

    fn modifier_up(timestamp_ms: u64) -> KeyEvent {
        KeyEvent::new(
            Key::Modifier,
            KeyPhase::Up,
            timestamp_ms,
            Modifiers { other: false },
        )
    }

    fn other_down(timestamp_ms: u64) -> KeyEvent {
        KeyEvent::new(
            Key::Other,
            KeyPhase::Down,
            timestamp_ms,
            Modifiers { other: true },
        )
    }

    fn modifier_combo_down(timestamp_ms: u64) -> KeyEvent {
        KeyEvent::new(
            Key::Modifier,
            KeyPhase::Down,
            timestamp_ms,
            Modifiers { other: true },
        )
    }

    #[test]
    fn double_modifier_within_threshold_triggers() {
        let mut detector = detector();

        assert!(!detector.handle_event(modifier_down(0)));
        assert!(!detector.handle_event(modifier_up(20)));
        assert!(detector.handle_event(modifier_down(140)));
    }

    #[test]
    fn double_modifier_after_threshold_does_not_trigger() {
        let mut detector = detector();

        assert!(!detector.handle_event(modifier_down(0)));
        assert!(!detector.handle_event(modifier_up(20)));
        assert!(!detector.handle_event(modifier_down(380)));
    }

    #[test]
    fn double_modifier_with_interleaved_other_key_does_not_trigger() {
        let mut detector = detector();

        assert!(!detector.handle_event(modifier_down(0)));
        assert!(!detector.handle_event(modifier_up(20)));
        assert!(!detector.handle_event(other_down(80)));
        assert!(!detector.handle_event(modifier_down(140)));
    }

    #[test]
    fn double_modifier_with_key_combo_does_not_trigger() {
        let mut detector = detector();

        assert!(!detector.handle_event(modifier_combo_down(0)));
        assert!(!detector.handle_event(modifier_up(20)));
        assert!(!detector.handle_event(modifier_down(140)));
    }

    #[test]
    fn long_modifier_hold_then_second_down_does_not_trigger() {
        let mut detector = detector();

        assert!(!detector.handle_event(modifier_down(0)));
        assert!(!detector.handle_event(modifier_up(900)));
        assert!(!detector.handle_event(modifier_down(980)));
    }
}
