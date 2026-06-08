use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::Emitter;

const OPEN_PINNED_LAUNCHER_EVENT: &str = "fluxtext://open-pinned-launcher";
const DOUBLE_CMD_HOTKEY_ERROR_EVENT: &str = "fluxtext://double-cmd-hotkey-error";
const DEFAULT_DOUBLE_CMD_THRESHOLD_MS: u64 = 300;

#[derive(Clone, Debug, serde::Serialize)]
pub struct HotkeyRegistrationStatus {
    pub status: String,
}

struct DoubleCmdHotkeyState {
    enabled: Mutex<bool>,
    listener_running: Mutex<bool>,
}

static DOUBLE_CMD_HOTKEY_STATE: OnceLock<Arc<DoubleCmdHotkeyState>> = OnceLock::new();

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Key {
    Meta,
    Other,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum KeyPhase {
    Down,
    Up,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct Modifiers {
    pub meta: bool,
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

pub struct DoubleCmdDetector {
    threshold: Duration,
    last_meta_up: Option<Duration>,
    current_meta_press_valid: bool,
}

impl DoubleCmdDetector {
    pub fn new(threshold: Duration) -> Self {
        Self {
            threshold,
            last_meta_up: None,
            current_meta_press_valid: false,
        }
    }

    pub fn handle_event(&mut self, event: KeyEvent) -> bool {
        match (event.key, event.phase) {
            (Key::Meta, KeyPhase::Down) => self.handle_meta_down(event),
            (Key::Meta, KeyPhase::Up) => self.handle_meta_up(event),
            (Key::Other, _) => {
                self.reset();
                false
            }
        }
    }

    fn handle_meta_down(&mut self, event: KeyEvent) -> bool {
        if event.modifiers.other {
            self.reset();
            return false;
        }

        self.current_meta_press_valid = true;
        let Some(last_meta_up) = self.last_meta_up else {
            return false;
        };

        let within_threshold =
            event.timestamp >= last_meta_up && event.timestamp - last_meta_up <= self.threshold;
        if within_threshold {
            self.last_meta_up = None;
            true
        } else {
            self.last_meta_up = None;
            false
        }
    }

    fn handle_meta_up(&mut self, event: KeyEvent) -> bool {
        if self.current_meta_press_valid && !event.modifiers.other {
            self.last_meta_up = Some(event.timestamp);
        } else {
            self.last_meta_up = None;
        }
        self.current_meta_press_valid = false;
        false
    }

    pub fn reset(&mut self) {
        self.last_meta_up = None;
        self.current_meta_press_valid = false;
    }
}

#[tauri::command]
pub fn register_double_cmd_hotkey(app: tauri::AppHandle) -> Result<HotkeyRegistrationStatus, String> {
    register_double_cmd_hotkey_impl(app)
}

#[tauri::command]
pub fn unregister_double_cmd_hotkey() -> Result<HotkeyRegistrationStatus, String> {
    if let Some(state) = DOUBLE_CMD_HOTKEY_STATE.get() {
        *state.enabled.lock().map_err(|e| e.to_string())? = false;
    }
    Ok(HotkeyRegistrationStatus {
        status: "Double Cmd detector unregistered".to_string(),
    })
}

#[cfg(target_os = "macos")]
fn register_double_cmd_hotkey_impl(app: tauri::AppHandle) -> Result<HotkeyRegistrationStatus, String> {
    let state = DOUBLE_CMD_HOTKEY_STATE
        .get_or_init(|| {
            Arc::new(DoubleCmdHotkeyState {
                enabled: Mutex::new(false),
                listener_running: Mutex::new(false),
            })
        })
        .clone();
    *state.enabled.lock().map_err(|e| e.to_string())? = true;
    let mut listener_running = state.listener_running.lock().map_err(|e| e.to_string())?;
    if !*listener_running {
        *listener_running = true;
        start_double_cmd_listener(Arc::clone(&state), app);
    }
    Ok(HotkeyRegistrationStatus {
        status: "Double Cmd registered".to_string(),
    })
}

#[cfg(not(target_os = "macos"))]
fn register_double_cmd_hotkey_impl(_app: tauri::AppHandle) -> Result<HotkeyRegistrationStatus, String> {
    Err("Double Cmd global hotkey is only available on macOS".to_string())
}

#[cfg(target_os = "macos")]
fn start_double_cmd_listener(state: Arc<DoubleCmdHotkeyState>, app: tauri::AppHandle) {
    std::thread::spawn(move || {
        use std::cell::RefCell;
        use core_foundation::runloop::{kCFRunLoopCommonModes, CFRunLoop};
        use core_graphics::event::{
            CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventType,
            CGEventFlags,
        };

        let callback_app = app.clone();
        let callback_state = Arc::clone(&state);

        struct ListenerState {
            detector: DoubleCmdDetector,
            started_at: Instant,
            meta_was_down: bool,
        }

        let listener_state = RefCell::new(ListenerState {
            detector: DoubleCmdDetector::new(Duration::from_millis(DEFAULT_DOUBLE_CMD_THRESHOLD_MS)),
            started_at: Instant::now(),
            meta_was_down: false,
        });

        let tap = CGEventTap::new(
            CGEventTapLocation::HID,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::ListenOnly,
            vec![
                CGEventType::KeyDown,
                CGEventType::KeyUp,
                CGEventType::FlagsChanged,
            ],
            move |_proxy, event_type, event| {
                let enabled = callback_state.enabled.lock().map(|v| *v).unwrap_or(false);
                let mut s = listener_state.borrow_mut();
                if !enabled {
                    s.detector.reset();
                    s.meta_was_down = false;
                    return None;
                }

                let timestamp = s.started_at.elapsed();

                if matches!(event_type, CGEventType::FlagsChanged) {
                    let flags = event.get_flags();
                    let meta_now = flags.contains(CGEventFlags::CGEventFlagCommand);
                    let has_other_modifiers = flags.intersects(
                        CGEventFlags::CGEventFlagShift
                        | CGEventFlags::CGEventFlagControl
                        | CGEventFlags::CGEventFlagAlternate
                    );

                    if meta_now && !s.meta_was_down {
                        let triggered = s.detector.handle_event(KeyEvent {
                            key: Key::Meta,
                            phase: KeyPhase::Down,
                            timestamp,
                            modifiers: Modifiers { meta: true, other: has_other_modifiers },
                        });
                        if triggered {
                            open_pinned_launcher(&callback_app);
                        }
                    } else if !meta_now && s.meta_was_down {
                        s.detector.handle_event(KeyEvent {
                            key: Key::Meta,
                            phase: KeyPhase::Up,
                            timestamp,
                            modifiers: Modifiers { meta: false, other: has_other_modifiers },
                        });
                    } else if !meta_now && !s.meta_was_down {
                        // Another modifier changed while meta not held — treat as other key
                        s.detector.handle_event(KeyEvent {
                            key: Key::Other,
                            phase: KeyPhase::Down,
                            timestamp,
                            modifiers: Modifiers { meta: false, other: true },
                        });
                    }
                    s.meta_was_down = meta_now;
                } else if matches!(event_type, CGEventType::KeyDown) {
                    // A real key was pressed between Cmd taps — invalidate
                    s.detector.reset();
                }
                None
            },
        );

        match tap {
            Ok(tap) => {
                unsafe {
                    let loop_source = tap.mach_port.create_runloop_source(0).expect("failed to create runloop source");
                    let run_loop = CFRunLoop::get_current();
                    run_loop.add_source(&loop_source, kCFRunLoopCommonModes);
                    tap.enable();
                    CFRunLoop::run_current();
                }
                if let Ok(mut listener_running) = state.listener_running.lock() {
                    *listener_running = false;
                }
            }
            Err(_) => {
                eprintln!("[FluxText] Failed to create CGEventTap! Check Accessibility permissions.");
                if let Ok(mut listener_running) = state.listener_running.lock() {
                    *listener_running = false;
                }
                if let Ok(mut enabled) = state.enabled.lock() {
                    *enabled = false;
                }
                let _ = app.emit(
                    DOUBLE_CMD_HOTKEY_ERROR_EVENT,
                    serde_json::json!({ "error": "Failed to create CGEventTap. Check Accessibility permissions." }),
                );
            }
        }
    });
}

#[cfg(target_os = "macos")]
fn open_pinned_launcher(app: &tauri::AppHandle) {
    let _ = app.emit(OPEN_PINNED_LAUNCHER_EVENT, ());
}

#[cfg(test)]
mod double_cmd_tests {
    use super::*;

    fn detector() -> DoubleCmdDetector {
        DoubleCmdDetector::new(Duration::from_millis(300))
    }

    fn meta_down(timestamp_ms: u64) -> KeyEvent {
        KeyEvent::new(
            Key::Meta,
            KeyPhase::Down,
            timestamp_ms,
            Modifiers {
                meta: true,
                other: false,
            },
        )
    }

    fn meta_up(timestamp_ms: u64) -> KeyEvent {
        KeyEvent::new(
            Key::Meta,
            KeyPhase::Up,
            timestamp_ms,
            Modifiers {
                meta: false,
                other: false,
            },
        )
    }

    fn other_down(timestamp_ms: u64) -> KeyEvent {
        KeyEvent::new(
            Key::Other,
            KeyPhase::Down,
            timestamp_ms,
            Modifiers {
                meta: false,
                other: true,
            },
        )
    }

    fn meta_combo_down(timestamp_ms: u64) -> KeyEvent {
        KeyEvent::new(
            Key::Meta,
            KeyPhase::Down,
            timestamp_ms,
            Modifiers {
                meta: true,
                other: true,
            },
        )
    }

    #[test]
    fn double_cmd_within_threshold_triggers() {
        let mut detector = detector();

        assert!(!detector.handle_event(meta_down(0)));
        assert!(!detector.handle_event(meta_up(20)));
        assert!(detector.handle_event(meta_down(140)));
    }

    #[test]
    fn double_cmd_after_threshold_does_not_trigger() {
        let mut detector = detector();

        assert!(!detector.handle_event(meta_down(0)));
        assert!(!detector.handle_event(meta_up(20)));
        assert!(!detector.handle_event(meta_down(380)));
    }

    #[test]
    fn double_cmd_with_interleaved_other_key_does_not_trigger() {
        let mut detector = detector();

        assert!(!detector.handle_event(meta_down(0)));
        assert!(!detector.handle_event(meta_up(20)));
        assert!(!detector.handle_event(other_down(80)));
        assert!(!detector.handle_event(meta_down(140)));
    }

    #[test]
    fn double_cmd_with_key_combo_does_not_trigger() {
        let mut detector = detector();

        assert!(!detector.handle_event(meta_combo_down(0)));
        assert!(!detector.handle_event(meta_up(20)));
        assert!(!detector.handle_event(meta_down(140)));
    }
}
