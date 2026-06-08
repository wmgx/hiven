use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::{Emitter, Manager};

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
        let callback_app = app.clone();
        let callback_state = Arc::clone(&state);
        let mut runtime = DoubleCmdRuntime::new(
            Duration::from_millis(DEFAULT_DOUBLE_CMD_THRESHOLD_MS),
            Instant::now(),
        );
        let listen_result = rdev::listen(move |event| {
            let enabled = callback_state.enabled.lock().map(|value| *value).unwrap_or(false);
            if !enabled {
                runtime.reset();
                return;
            }
            if runtime.handle_rdev_event(event) {
                open_pinned_launcher(&callback_app);
            }
        });
        if let Err(error) = listen_result {
            if let Ok(mut listener_running) = state.listener_running.lock() {
                *listener_running = false;
            }
            if let Ok(mut enabled) = state.enabled.lock() {
                *enabled = false;
            }
            let _ = app.emit(
                DOUBLE_CMD_HOTKEY_ERROR_EVENT,
                serde_json::json!({ "error": format!("{:?}", error) }),
            );
        }
    });
}

#[cfg(target_os = "macos")]
struct DoubleCmdRuntime {
    detector: DoubleCmdDetector,
    started_at: Instant,
    other_keys_down: usize,
}

#[cfg(target_os = "macos")]
impl DoubleCmdRuntime {
    fn new(threshold: Duration, started_at: Instant) -> Self {
        Self {
            detector: DoubleCmdDetector::new(threshold),
            started_at,
            other_keys_down: 0,
        }
    }

    fn handle_rdev_event(&mut self, event: rdev::Event) -> bool {
        let timestamp = self.started_at.elapsed();
        match event.event_type {
            rdev::EventType::KeyPress(key) if is_meta_key(key) => {
                self.detector.handle_event(KeyEvent {
                    key: Key::Meta,
                    phase: KeyPhase::Down,
                    timestamp,
                    modifiers: Modifiers {
                        meta: true,
                        other: self.other_keys_down > 0,
                    },
                })
            }
            rdev::EventType::KeyRelease(key) if is_meta_key(key) => {
                self.detector.handle_event(KeyEvent {
                    key: Key::Meta,
                    phase: KeyPhase::Up,
                    timestamp,
                    modifiers: Modifiers {
                        meta: false,
                        other: self.other_keys_down > 0,
                    },
                })
            }
            rdev::EventType::KeyPress(_) => {
                self.other_keys_down = self.other_keys_down.saturating_add(1);
                self.detector.handle_event(KeyEvent {
                    key: Key::Other,
                    phase: KeyPhase::Down,
                    timestamp,
                    modifiers: Modifiers {
                        meta: false,
                        other: true,
                    },
                })
            }
            rdev::EventType::KeyRelease(_) => {
                self.other_keys_down = self.other_keys_down.saturating_sub(1);
                self.detector.handle_event(KeyEvent {
                    key: Key::Other,
                    phase: KeyPhase::Up,
                    timestamp,
                    modifiers: Modifiers {
                        meta: false,
                        other: self.other_keys_down > 0,
                    },
                })
            }
            _ => false,
        }
    }

    fn reset(&mut self) {
        self.detector.reset();
        self.other_keys_down = 0;
    }
}

#[cfg(target_os = "macos")]
fn is_meta_key(key: rdev::Key) -> bool {
    matches!(key, rdev::Key::MetaLeft | rdev::Key::MetaRight)
}

#[cfg(target_os = "macos")]
fn open_pinned_launcher(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
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
