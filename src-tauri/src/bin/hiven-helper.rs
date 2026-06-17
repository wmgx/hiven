//! hiven-helper — macOS accessibility helper for Hiven.
//! Runs as a long-lived daemon alongside the main app and holds the single
//! Accessibility permission entry for CGEventTap + CGEventPost.
//!
//! Protocol: newline-delimited JSON over a Unix-domain socket.
//!
//! Client → Helper:
//!   {"cmd":"register_hotkey","modifier":"Command"|"Shift"|"Option"}
//!   {"cmd":"unregister_hotkey"}
//!   {"cmd":"simulate_paste"}
//!   {"cmd":"ping"}
//!
//! Helper → Client (responses):
//!   {"result":"ok"}
//!   {"result":"ok","status":"..."}
//!   {"result":"error","message":"..."}
//!
//! Helper → Client (unsolicited events):
//!   {"event":"hotkey_triggered"}
//!   {"event":"hotkey_ready","status":"..."}
//!   {"event":"hotkey_error","message":"..."}

fn main() {
    #[cfg(target_os = "macos")]
    run_server();
    // On non-macOS platforms this binary exits immediately; the main app
    // handles hotkeys and paste directly (Windows WH_KEYBOARD_LL, etc.).
}

// ─── macOS-only: imports ──────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
use std::io::{BufRead, BufReader, BufWriter, Write};
#[cfg(target_os = "macos")]
use std::os::unix::net::{UnixListener, UnixStream};
#[cfg(target_os = "macos")]
use std::path::PathBuf;
#[cfg(target_os = "macos")]
use std::sync::{Arc, Mutex, OnceLock};
#[cfg(target_os = "macos")]
use std::time::{Duration, Instant};

// ─── macOS-only: socket plumbing ─────────────────────────────────────────────

#[cfg(target_os = "macos")]
type Writers = Arc<Mutex<Vec<Arc<Mutex<BufWriter<UnixStream>>>>>>;

#[cfg(target_os = "macos")]
fn socket_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(home)
        .join(".local")
        .join("hiven")
        .join("helper.sock")
}

#[cfg(target_os = "macos")]
fn broadcast(writers: &Writers, msg: &str) {
    let mut ws = writers.lock().unwrap();
    ws.retain(|w| match w.lock() {
        Ok(mut w) => writeln!(w, "{}", msg).is_ok() && w.flush().is_ok(),
        Err(_) => false,
    });
}

#[cfg(target_os = "macos")]
fn dispatch(cmd: &serde_json::Value, writers: &Writers) -> serde_json::Value {
    match cmd.get("cmd").and_then(|v| v.as_str()) {
        Some("simulate_paste") => match do_simulate_paste() {
            Ok(()) => serde_json::json!({"result": "ok"}),
            Err(e) => serde_json::json!({"result": "error", "message": e}),
        },
        Some("register_hotkey") => {
            let modifier = cmd["modifier"].as_str().unwrap_or("Command");
            match do_register_hotkey(modifier, Arc::clone(writers)) {
                Ok(status) => serde_json::json!({"result": "ok", "status": status}),
                Err(e) => serde_json::json!({"result": "error", "message": e}),
            }
        }
        Some("unregister_hotkey") => {
            do_unregister_hotkey();
            serde_json::json!({"result": "ok"})
        }
        Some("ping") => serde_json::json!({"result": "ok", "pong": true}),
        _ => serde_json::json!({"result": "error", "message": "unknown command"}),
    }
}

#[cfg(target_os = "macos")]
fn client_thread(stream: UnixStream, writer: Arc<Mutex<BufWriter<UnixStream>>>, writers: Writers) {
    let reader = BufReader::new(stream);
    for line in reader.lines() {
        let line = match line {
            Ok(l) if !l.trim().is_empty() => l,
            _ => break,
        };
        let val: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let response = dispatch(&val, &writers);
        let json = serde_json::to_string(&response).unwrap_or_default();
        if let Ok(mut w) = writer.lock() {
            let _ = writeln!(w, "{}", json);
            let _ = w.flush();
        }
    }
    writers
        .lock()
        .unwrap()
        .retain(|w| !Arc::ptr_eq(w, &writer));
}

#[cfg(target_os = "macos")]
fn run_server() {
    let path = socket_path();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::remove_file(&path);

    let listener = UnixListener::bind(&path).unwrap_or_else(|e| {
        eprintln!("[hiven-helper] Cannot bind {:?}: {}", path, e);
        std::process::exit(1);
    });

    let writers: Writers = Arc::new(Mutex::new(Vec::new()));

    for stream in listener.incoming() {
        let stream = match stream {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[hiven-helper] accept error: {}", e);
                continue;
            }
        };
        let writer_stream = match stream.try_clone() {
            Ok(s) => s,
            Err(_) => continue,
        };
        let writer = Arc::new(Mutex::new(BufWriter::new(writer_stream)));
        writers.lock().unwrap().push(Arc::clone(&writer));
        let wc = Arc::clone(&writers);
        let wr = Arc::clone(&writer);
        std::thread::spawn(move || client_thread(stream, wr, wc));
    }
}

// ─── macOS: accessibility check ───────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn ax_is_trusted(prompt: bool) -> bool {
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

    let key = CFString::new("AXTrustedCheckOptionPrompt");
    let val = if prompt {
        CFBoolean::true_value()
    } else {
        CFBoolean::false_value()
    };
    let opts = CFDictionary::from_CFType_pairs(&[(key.as_CFType(), val.as_CFType())]);
    unsafe { AXIsProcessTrustedWithOptions(opts.as_concrete_TypeRef()) }
}

// ─── macOS: simulate paste ────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn do_simulate_paste() -> Result<(), String> {
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

    if !ax_is_trusted(false) {
        return Err("Accessibility permission not granted".into());
    }
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

// ─── macOS: hotkey state ──────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
struct SendableMachPort(core_foundation::mach_port::CFMachPortRef);
#[cfg(target_os = "macos")]
unsafe impl Send for SendableMachPort {}
#[cfg(target_os = "macos")]
unsafe impl Sync for SendableMachPort {}

#[cfg(target_os = "macos")]
#[derive(Clone, Copy, PartialEq, Eq)]
enum HotkeyModifier {
    Command,
    Shift,
    Option,
}

#[cfg(target_os = "macos")]
impl HotkeyModifier {
    fn from_str(s: &str) -> Self {
        match s {
            "Shift" => Self::Shift,
            "Option" => Self::Option,
            _ => Self::Command,
        }
    }
    fn label(self) -> &'static str {
        match self {
            Self::Command => "Cmd",
            Self::Shift => "Shift",
            Self::Option => "Option",
        }
    }
}

#[cfg(target_os = "macos")]
struct HotkeyState {
    enabled: Mutex<bool>,
    modifier: Mutex<HotkeyModifier>,
    tap_port: Mutex<Option<SendableMachPort>>,
    listener_running: Mutex<bool>,
}

#[cfg(target_os = "macos")]
static HOTKEY_STATE: OnceLock<Arc<HotkeyState>> = OnceLock::new();

#[cfg(target_os = "macos")]
fn hotkey_state() -> Arc<HotkeyState> {
    HOTKEY_STATE
        .get_or_init(|| {
            Arc::new(HotkeyState {
                enabled: Mutex::new(false),
                modifier: Mutex::new(HotkeyModifier::Command),
                tap_port: Mutex::new(None),
                listener_running: Mutex::new(false),
            })
        })
        .clone()
}

// ─── macOS: register / unregister ────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn do_register_hotkey(modifier_str: &str, writers: Writers) -> Result<String, String> {
    let modifier = HotkeyModifier::from_str(modifier_str);
    let state = hotkey_state();
    *state.enabled.lock().unwrap() = true;
    *state.modifier.lock().unwrap() = modifier;

    let trusted = ax_is_trusted(true);

    if trusted {
        let mut running = state.listener_running.lock().unwrap();
        if !*running {
            *running = true;
            drop(running);
            let sc = Arc::clone(&state);
            let wc = Arc::clone(&writers);
            std::thread::spawn(move || event_tap_thread(sc, wc));
        }
        Ok(format!("Double {} registered", modifier.label()))
    } else {
        let sc = Arc::clone(&state);
        let wc = Arc::clone(&writers);
        std::thread::spawn(move || accessibility_poller(sc, wc));
        Ok("Accessibility permission required — please grant access in System Settings".into())
    }
}

#[cfg(target_os = "macos")]
fn do_unregister_hotkey() {
    if let Some(state) = HOTKEY_STATE.get() {
        if let Ok(mut e) = state.enabled.lock() {
            *e = false;
        }
    }
}

// ─── macOS: accessibility poller ─────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn accessibility_poller(state: Arc<HotkeyState>, writers: Writers) {
    for _ in 0..240 {
        std::thread::sleep(Duration::from_millis(500));
        if !state.enabled.lock().map(|v| *v).unwrap_or(false) {
            return;
        }
        if ax_is_trusted(false) {
            let mut running = state.listener_running.lock().unwrap();
            if !*running {
                *running = true;
                let modifier = *state.modifier.lock().unwrap();
                drop(running);
                let sc = Arc::clone(&state);
                let wc = Arc::clone(&writers);
                std::thread::spawn(move || event_tap_thread(sc, wc));
                broadcast(
                    &writers,
                    &format!(
                        r#"{{"event":"hotkey_ready","status":"Double {} registered"}}"#,
                        modifier.label()
                    ),
                );
            }
            return;
        }
    }
    broadcast(
        &writers,
        r#"{"event":"hotkey_error","message":"Accessibility permission was not granted."}"#,
    );
}

// ─── macOS: CGEventTap thread ─────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn event_tap_thread(state: Arc<HotkeyState>, writers: Writers) {
    use core_foundation::mach_port::CFMachPortRef;
    use core_foundation::runloop::{kCFRunLoopCommonModes, CFRunLoop};
    use core_graphics::event::{
        CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventType,
    };
    use std::cell::RefCell;

    struct Detector {
        threshold: Duration,
        last_down: Option<Duration>,
        current_down: Option<Duration>,
        press_valid: bool,
    }
    impl Detector {
        fn new() -> Self {
            Self {
                threshold: Duration::from_millis(300),
                last_down: None,
                current_down: None,
                press_valid: false,
            }
        }
        fn reset(&mut self) {
            self.last_down = None;
            self.current_down = None;
            self.press_valid = false;
        }
        fn on_down(&mut self, t: Duration, has_other: bool) -> bool {
            if has_other {
                self.reset();
                return false;
            }
            self.press_valid = true;
            self.current_down = Some(t);
            if let Some(last) = self.last_down {
                if t.saturating_sub(last) <= self.threshold {
                    self.reset();
                    return true;
                }
                self.last_down = None;
            }
            false
        }
        fn on_up(&mut self, t: Duration, has_other: bool) {
            if self.press_valid && !has_other {
                if let Some(down) = self.current_down {
                    self.last_down = if t.saturating_sub(down) <= self.threshold {
                        Some(down)
                    } else {
                        None
                    };
                } else {
                    self.last_down = None;
                }
            } else {
                self.last_down = None;
            }
            self.current_down = None;
            self.press_valid = false;
        }
    }

    struct TapState {
        detector: Detector,
        started_at: Instant,
        modifier: HotkeyModifier,
        modifier_was_down: bool,
    }

    let tap_state = RefCell::new(TapState {
        detector: Detector::new(),
        started_at: Instant::now(),
        modifier: HotkeyModifier::Command,
        modifier_was_down: false,
    });

    let cb_state = Arc::clone(&state);
    let cb_writers = Arc::clone(&writers);

    let tap = CGEventTap::new(
        CGEventTapLocation::HID,
        CGEventTapPlacement::HeadInsertEventTap,
        CGEventTapOptions::ListenOnly,
        vec![
            CGEventType::KeyDown,
            CGEventType::FlagsChanged,
            CGEventType::TapDisabledByTimeout,
        ],
        move |_proxy, event_type, event| {
            if matches!(event_type, CGEventType::TapDisabledByTimeout) {
                if let Ok(g) = cb_state.tap_port.lock() {
                    if let Some(ref p) = *g {
                        unsafe {
                            extern "C" {
                                fn CGEventTapEnable(tap: CFMachPortRef, enable: bool);
                            }
                            CGEventTapEnable(p.0, true);
                        }
                    }
                }
                return None;
            }

            if !cb_state.enabled.lock().map(|v| *v).unwrap_or(false) {
                return None;
            }

            let current_mod = cb_state
                .modifier
                .lock()
                .map(|v| *v)
                .unwrap_or(HotkeyModifier::Command);
            let mut ts = tap_state.borrow_mut();
            let timestamp = ts.started_at.elapsed();

            if matches!(event_type, CGEventType::FlagsChanged) {
                use core_graphics::event::CGEventFlags;
                let flags = event.get_flags();

                if ts.modifier != current_mod {
                    ts.detector.reset();
                    ts.modifier = current_mod;
                }

                let (mod_now, has_other) = match current_mod {
                    HotkeyModifier::Command => (
                        flags.contains(CGEventFlags::CGEventFlagCommand),
                        flags.intersects(
                            CGEventFlags::CGEventFlagControl
                                | CGEventFlags::CGEventFlagShift
                                | CGEventFlags::CGEventFlagAlternate,
                        ),
                    ),
                    HotkeyModifier::Shift => (
                        flags.contains(CGEventFlags::CGEventFlagShift),
                        flags.intersects(
                            CGEventFlags::CGEventFlagControl
                                | CGEventFlags::CGEventFlagCommand
                                | CGEventFlags::CGEventFlagAlternate,
                        ),
                    ),
                    HotkeyModifier::Option => (
                        flags.contains(CGEventFlags::CGEventFlagAlternate),
                        flags.intersects(
                            CGEventFlags::CGEventFlagControl
                                | CGEventFlags::CGEventFlagCommand
                                | CGEventFlags::CGEventFlagShift,
                        ),
                    ),
                };

                if mod_now && !ts.modifier_was_down {
                    if ts.detector.on_down(timestamp, has_other) {
                        broadcast(&cb_writers, r#"{"event":"hotkey_triggered"}"#);
                    }
                } else if !mod_now && ts.modifier_was_down {
                    ts.detector.on_up(timestamp, has_other);
                }
                ts.modifier_was_down = mod_now;
            } else if matches!(event_type, CGEventType::KeyDown) {
                ts.detector.reset();
            }
            None
        },
    );

    match tap {
        Ok(tap) => {
            use core_foundation::base::TCFType;
            if let Ok(mut g) = state.tap_port.lock() {
                *g = Some(SendableMachPort(tap.mach_port.as_concrete_TypeRef()));
            }
            let src = tap
                .mach_port
                .create_runloop_source(0)
                .expect("runloop source");
            let rl = CFRunLoop::get_current();
            unsafe { rl.add_source(&src, kCFRunLoopCommonModes) };
            tap.enable();
            CFRunLoop::run_current();
        }
        Err(_) => {
            eprintln!(
                "[hiven-helper] Failed to create CGEventTap — check Accessibility permission"
            );
            broadcast(
                &writers,
                r#"{"event":"hotkey_error","message":"Failed to create CGEventTap. Check Accessibility permissions."}"#,
            );
        }
    }

    if let Ok(mut r) = state.listener_running.lock() {
        *r = false;
    }
}
