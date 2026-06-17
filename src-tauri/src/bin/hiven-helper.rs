//! hiven-helper — macOS accessibility helper for Hiven.
//! Holds the single Accessibility permission entry for CGEventPost (paste).
//!
//! Protocol: newline-delimited JSON over a Unix-domain socket.
//!
//! Client → Helper:
//!   {"cmd":"simulate_paste"}
//!   {"cmd":"ping"}
//!
//! Helper → Client (responses):
//!   {"result":"ok"}
//!   {"result":"error","message":"..."}

fn main() {
    #[cfg(target_os = "macos")]
    run_server();
}

#[cfg(target_os = "macos")]
use std::io::{BufRead, BufReader, BufWriter, Write};
#[cfg(target_os = "macos")]
use std::os::unix::net::{UnixListener, UnixStream};
#[cfg(target_os = "macos")]
use std::path::PathBuf;
#[cfg(target_os = "macos")]
use std::sync::{Arc, Mutex};

#[cfg(target_os = "macos")]
fn socket_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(home)
        .join(".local")
        .join("hiven")
        .join("helper.sock")
}

#[cfg(target_os = "macos")]
fn dispatch(cmd: &serde_json::Value) -> serde_json::Value {
    match cmd.get("cmd").and_then(|v| v.as_str()) {
        Some("simulate_paste") => match do_simulate_paste() {
            Ok(()) => serde_json::json!({"result": "ok"}),
            Err(e) => serde_json::json!({"result": "error", "message": e}),
        },
        Some("ping") => serde_json::json!({"result": "ok", "pong": true}),
        _ => serde_json::json!({"result": "error", "message": "unknown command"}),
    }
}

#[cfg(target_os = "macos")]
fn client_thread(stream: UnixStream, writer: Arc<Mutex<BufWriter<UnixStream>>>) {
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
        let response = dispatch(&val);
        let json = serde_json::to_string(&response).unwrap_or_default();
        if let Ok(mut w) = writer.lock() {
            let _ = writeln!(w, "{}", json);
            let _ = w.flush();
        }
    }
}

#[cfg(target_os = "macos")]
fn run_server() {
    // Prompt for Accessibility permission on first launch so the user sees
    // the system dialog before they try to paste anything.
    ax_is_trusted(true);

    let path = socket_path();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::remove_file(&path);

    let listener = UnixListener::bind(&path).unwrap_or_else(|e| {
        eprintln!("[hiven-helper] Cannot bind {:?}: {}", path, e);
        std::process::exit(1);
    });

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
        let wr = Arc::clone(&writer);
        std::thread::spawn(move || client_thread(stream, wr));
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
