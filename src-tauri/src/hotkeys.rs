use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
#[cfg(target_os = "macos")]
use std::time::Instant;

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

const ROUTE_GLOBAL_PINNED_LAUNCHER_SHORTCUT_EVENT: &str =
    "hiven://route-global-pinned-launcher-shortcut";
const DEFAULT_DOUBLE_MODIFIER_THRESHOLD_MS: u64 = 500;

#[derive(Clone, Debug, serde::Serialize)]
pub struct HotkeyRegistrationStatus {
    pub status: String,
}

// macOS: hotkey detection runs in-process via NSEvent global monitors.
#[cfg(target_os = "macos")]
struct DoubleModifierHotkeyState {
    enabled: Mutex<bool>,
    listener_running: Mutex<bool>,
    modifier: Mutex<DoubleModifier>,
}

#[cfg(target_os = "macos")]
static DOUBLE_MODIFIER_HOTKEY_STATE: OnceLock<Arc<DoubleModifierHotkeyState>> = OnceLock::new();

#[cfg(target_os = "windows")]
struct DoubleModifierHotkeyState {
    enabled: Mutex<bool>,
    listener_running: Mutex<bool>,
    modifier: Mutex<DoubleModifier>,
    detector: Mutex<DoubleModifierDetector>,
    app_handle: std::sync::OnceLock<tauri::AppHandle>,
}

#[cfg(target_os = "windows")]
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
    last_modifier_up: Option<Duration>,
    current_modifier_down: Option<Duration>,
    current_modifier_press_valid: bool,
}

impl DoubleModifierDetector {
    pub fn new(threshold: Duration) -> Self {
        Self {
            threshold,
            last_modifier_up: None,
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
        let Some(last_modifier_up) = self.last_modifier_up else {
            return false;
        };

        let within_threshold = event.timestamp >= last_modifier_up
            && event.timestamp - last_modifier_up <= self.threshold;
        if within_threshold {
            self.last_modifier_up = None;
            self.current_modifier_down = None;
            true
        } else {
            self.last_modifier_up = None;
            false
        }
    }

    fn handle_modifier_up(&mut self, event: KeyEvent) -> bool {
        if self.current_modifier_press_valid && !event.modifiers.other {
            if let Some(current_modifier_down) = self.current_modifier_down {
                let was_short_press = event.timestamp >= current_modifier_down
                    && event.timestamp - current_modifier_down <= self.threshold;
                self.last_modifier_up = was_short_press.then_some(event.timestamp);
            } else {
                self.last_modifier_up = None;
            }
        } else {
            self.last_modifier_up = None;
        }
        self.current_modifier_down = None;
        self.current_modifier_press_valid = false;
        false
    }

    pub fn reset(&mut self) {
        self.last_modifier_up = None;
        self.current_modifier_down = None;
        self.current_modifier_press_valid = false;
    }
}

struct DoubleModifierListenerState {
    detector: DoubleModifierDetector,
    modifier: DoubleModifier,
    was_down: bool,
}

impl DoubleModifierListenerState {
    fn new(threshold: Duration, modifier: DoubleModifier) -> Self {
        Self {
            detector: DoubleModifierDetector::new(threshold),
            modifier,
            was_down: false,
        }
    }

    fn handle_flags_changed(
        &mut self,
        modifier: DoubleModifier,
        mod_now: bool,
        has_other: bool,
        timestamp: Duration,
    ) -> bool {
        if self.modifier != modifier {
            self.detector.reset();
            self.modifier = modifier;
        }

        if mod_now && !self.was_down {
            let triggered = self.detector.handle_event(KeyEvent {
                key: Key::Modifier,
                phase: KeyPhase::Down,
                timestamp,
                modifiers: Modifiers { other: has_other },
            });
            if triggered {
                self.detector.reset();
                self.was_down = false;
                return true;
            }
        } else if !mod_now && self.was_down {
            self.detector.handle_event(KeyEvent {
                key: Key::Modifier,
                phase: KeyPhase::Up,
                timestamp,
                modifiers: Modifiers { other: has_other },
            });
        }
        self.was_down = mod_now;
        false
    }

    fn handle_other_key_down(&mut self, timestamp: Duration) {
        self.detector.handle_event(KeyEvent {
            key: Key::Other,
            phase: KeyPhase::Down,
            timestamp,
            modifiers: Modifiers { other: true },
        });
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
    #[cfg(target_os = "macos")]
    {
        if let Some(state) = DOUBLE_MODIFIER_HOTKEY_STATE.get() {
            if let Ok(mut e) = state.enabled.lock() {
                *e = false;
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Some(state) = DOUBLE_MODIFIER_HOTKEY_STATE.get() {
            *state.enabled.lock().map_err(|e| e.to_string())? = false;
        }
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
    hotkey_log(&format!(
        "register_double_modifier_hotkey_impl NSEvent path {:?}",
        modifier
    ));

    let state = DOUBLE_MODIFIER_HOTKEY_STATE
        .get_or_init(|| {
            Arc::new(DoubleModifierHotkeyState {
                enabled: Mutex::new(false),
                listener_running: Mutex::new(false),
                modifier: Mutex::new(DoubleModifier::Command),
            })
        })
        .clone();

    *state.enabled.lock().map_err(|e| e.to_string())? = true;
    *state.modifier.lock().map_err(|e| e.to_string())? = modifier;

    let mut lr = state.listener_running.lock().map_err(|e| e.to_string())?;
    if !*lr {
        *lr = true;
        drop(lr);
        start_nsevent_listener(Arc::clone(&state), app);
    }

    Ok(HotkeyRegistrationStatus {
        status: format!("Double {} registered", modifier.label()),
    })
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
        use windows::Win32::Foundation::HINSTANCE;
        use windows::Win32::System::LibraryLoader::GetModuleHandleW;
        use windows::Win32::UI::WindowsAndMessaging::{
            DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage,
            UnhookWindowsHookEx, WH_KEYBOARD_LL, MSG,
        };

        let hmod = unsafe { GetModuleHandleW(None).unwrap_or_default() };
        // HMODULE → HINSTANCE conversion for SetWindowsHookExW
        let hinstance: HINSTANCE = unsafe { std::mem::transmute(hmod) };

        let hook = unsafe {
            SetWindowsHookExW(WH_KEYBOARD_LL, Some(low_level_keyboard_proc), Some(hinstance), 0)
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

// Thread-local: tracks which modifier the hook last observed so the detector
// can be reset when the configured modifier changes.
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

    CallNextHookEx(None, code, wparam, lparam)
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

/// Install a `NSEvent` global monitor for FlagsChanged+KeyDown events.
/// These are delivered on the main thread without requiring Accessibility.
#[cfg(target_os = "macos")]
fn start_nsevent_listener(state: Arc<DoubleModifierHotkeyState>, app: tauri::AppHandle) {
    use block2::RcBlock;
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2::msg_send;

    // NSEventMaskFlagsChanged = 1<<12, NSEventMaskKeyDown = 1<<10
    let mask: u64 = (1u64 << 12) | (1u64 << 10);
    const FLAGS_CHANGED: u64 = 12; // NSEventTypeFlagsChanged

    // NSEventModifierFlags bit positions
    const CMD: u64 = 1 << 20;
    const SHIFT: u64 = 1 << 17;
    const OPTION: u64 = 1 << 19;
    const CTRL: u64 = 1 << 18;

    struct ListenerState {
        started_at: Instant,
        double_modifier: DoubleModifierListenerState,
    }

    let ls = Arc::new(Mutex::new(ListenerState {
        double_modifier: DoubleModifierListenerState::new(
            Duration::from_millis(DEFAULT_DOUBLE_MODIFIER_THRESHOLD_MS),
            DoubleModifier::Command,
        ),
        started_at: Instant::now(),
    }));

    let ls2 = Arc::clone(&ls);
    let state2 = Arc::clone(&state);
    let app2 = app.clone();

    let block = RcBlock::new(move |event: *mut AnyObject| {
        if !state2.enabled.lock().map(|v| *v).unwrap_or(false) {
            return;
        }

        let event_type: u64 = unsafe { msg_send![event, type] };
        let modifier = state2
            .modifier
            .lock()
            .map(|v| *v)
            .unwrap_or(DoubleModifier::Command);
        let mut ls = ls2.lock().unwrap();
        let timestamp = ls.started_at.elapsed();

        if event_type == FLAGS_CHANGED {
            let flags: u64 = unsafe { msg_send![event, modifierFlags] };
            let (mod_now, has_other) = match modifier {
                DoubleModifier::Command => (
                    flags & CMD != 0,
                    flags & (CTRL | SHIFT | OPTION) != 0,
                ),
                DoubleModifier::Shift => (
                    flags & SHIFT != 0,
                    flags & (CTRL | CMD | OPTION) != 0,
                ),
                DoubleModifier::Option => (
                    flags & OPTION != 0,
                    flags & (CTRL | CMD | SHIFT) != 0,
                ),
            };
            if ls
                .double_modifier
                .handle_flags_changed(modifier, mod_now, has_other, timestamp)
            {
                let a = app2.clone();
                std::thread::spawn(move || route_pinned_launcher_hotkey(a));
            }
        } else {
            // KeyDown — invalidate any in-progress double-tap
            ls.double_modifier.handle_other_key_down(timestamp);
        }
    });

    // Box::leak keeps the block alive for the app lifetime (monitor is never removed).
    let block_ref: &'static _ = Box::leak(Box::new(block));

    unsafe {
        let cls = AnyClass::get(c"NSEvent").expect("NSEvent class not found");
        let _monitor: *mut AnyObject = msg_send![
            cls,
            addGlobalMonitorForEventsMatchingMask: mask,
            handler: &**block_ref
        ];
    }

    hotkey_log("NSEvent global monitor installed (no Accessibility needed)");
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

#[cfg(test)]
mod double_modifier_tests {
    use super::*;

    fn detector() -> DoubleModifierDetector {
        DoubleModifierDetector::new(Duration::from_millis(300))
    }

    fn default_detector() -> DoubleModifierDetector {
        DoubleModifierDetector::new(Duration::from_millis(DEFAULT_DOUBLE_MODIFIER_THRESHOLD_MS))
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

    fn timestamp(timestamp_ms: u64) -> Duration {
        Duration::from_millis(timestamp_ms)
    }

    #[test]
    fn double_modifier_within_threshold_triggers() {
        let mut detector = detector();

        assert!(!detector.handle_event(modifier_down(0)));
        assert!(!detector.handle_event(modifier_up(20)));
        assert!(detector.handle_event(modifier_down(140)));
    }

    #[test]
    fn default_double_modifier_window_accepts_500ms() {
        let mut detector = default_detector();

        assert!(!detector.handle_event(modifier_down(0)));
        assert!(!detector.handle_event(modifier_up(20)));
        assert!(detector.handle_event(modifier_down(500)));
    }

    #[test]
    fn listener_recovers_when_key_up_is_lost_after_trigger() {
        let mut listener =
            DoubleModifierListenerState::new(Duration::from_millis(300), DoubleModifier::Command);

        assert!(!listener.handle_flags_changed(
            DoubleModifier::Command,
            true,
            false,
            timestamp(0),
        ));
        assert!(!listener.handle_flags_changed(
            DoubleModifier::Command,
            false,
            false,
            timestamp(20),
        ));
        assert!(listener.handle_flags_changed(
            DoubleModifier::Command,
            true,
            false,
            timestamp(140),
        ));

        assert!(!listener.handle_flags_changed(
            DoubleModifier::Command,
            true,
            false,
            timestamp(1_000),
        ));
        assert!(!listener.handle_flags_changed(
            DoubleModifier::Command,
            false,
            false,
            timestamp(1_020),
        ));
        assert!(listener.handle_flags_changed(
            DoubleModifier::Command,
            true,
            false,
            timestamp(1_140),
        ));
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
