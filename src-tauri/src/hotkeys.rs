use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::Emitter;

const DOUBLE_MODIFIER_HOTKEY_ERROR_EVENT: &str = "hiven://double-modifier-hotkey-error";
const DEFAULT_DOUBLE_MODIFIER_THRESHOLD_MS: u64 = 300;

#[derive(Clone, Debug, serde::Serialize)]
pub struct HotkeyRegistrationStatus {
    pub status: String,
}

struct DoubleModifierHotkeyState {
    enabled: Mutex<bool>,
    listener_running: Mutex<bool>,
    modifier: Mutex<DoubleModifier>,
}

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
    let mut listener_running = state.listener_running.lock().map_err(|e| e.to_string())?;
    if !*listener_running {
        *listener_running = true;
        start_double_modifier_listener(Arc::clone(&state), app);
    }
    Ok(HotkeyRegistrationStatus {
        status: format!("Double {} registered", modifier.label()),
    })
}

#[cfg(not(target_os = "macos"))]
fn register_double_modifier_hotkey_impl(
    _app: tauri::AppHandle,
    _modifier: DoubleModifier,
) -> Result<HotkeyRegistrationStatus, String> {
    Err("Double modifier global hotkey is only available on macOS".to_string())
}

#[cfg(target_os = "macos")]
fn start_double_modifier_listener(state: Arc<DoubleModifierHotkeyState>, app: tauri::AppHandle) {
    std::thread::spawn(move || {
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
        }

        let listener_state = RefCell::new(ListenerState {
            detector: DoubleModifierDetector::new(Duration::from_millis(
                DEFAULT_DOUBLE_MODIFIER_THRESHOLD_MS,
            )),
            started_at: Instant::now(),
            modifier: DoubleModifier::Command,
            modifier_was_down: false,
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
                    s.modifier_was_down = false;
                    return None;
                }

                let timestamp = s.started_at.elapsed();

                if matches!(event_type, CGEventType::FlagsChanged) {
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
                unsafe {
                    let loop_source = tap
                        .mach_port
                        .create_runloop_source(0)
                        .expect("failed to create runloop source");
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
                eprintln!(
                    "[hiven] Failed to create CGEventTap! Check Accessibility permissions."
                );
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
    let _ = crate::show_launcher_window_for_hotkey(app.clone());
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
