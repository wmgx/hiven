//! IPC client for communicating with hiven-helper (macOS only).
//!
//! The helper binary holds the Accessibility permission and handles:
//!   - CGEventPost (simulate Cmd+V paste)
//!
//! Double-modifier hotkey detection runs in-process via NSEvent (no Accessibility).
//! This module connects to the helper's Unix-domain socket and sends commands.

#[cfg(target_os = "macos")]
mod inner {
    use std::collections::VecDeque;
    use std::io::{BufRead, BufReader, BufWriter, Write};
    use std::os::unix::net::UnixStream;
    use std::path::PathBuf;
    use std::sync::{mpsc, Arc, Mutex, OnceLock};
    use std::time::Duration;

    type ResponseTx = mpsc::SyncSender<serde_json::Value>;

    struct HelperIpc {
        writer: Mutex<BufWriter<UnixStream>>,
        pending: Mutex<VecDeque<ResponseTx>>,
    }

    static HELPER_IPC: OnceLock<Arc<HelperIpc>> = OnceLock::new();

    fn socket_path() -> PathBuf {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        PathBuf::from(home)
            .join(".local")
            .join("hiven")
            .join("helper.sock")
    }

    fn helper_binary_path() -> Option<PathBuf> {
        let exe = std::env::current_exe().ok()?;
        let dir = exe.parent()?;
        let path = dir.join("hiven-helper");
        if path.exists() {
            Some(path)
        } else {
            None
        }
    }

    pub fn launch_and_connect() -> Result<(), String> {
        let helper_path = helper_binary_path()
            .ok_or_else(|| "hiven-helper binary not found next to app binary".to_string())?;

        // Kill any stale socket file so the helper can bind cleanly.
        let sock_path = socket_path();

        // Launch helper as a detached background process.
        std::process::Command::new(&helper_path)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to launch hiven-helper: {}", e))?;

        // Wait for the helper to bind its socket (up to ~2 s).
        let mut stream_opt: Option<UnixStream> = None;
        for attempt in 0..20u64 {
            std::thread::sleep(Duration::from_millis(50 + attempt * 50));
            match UnixStream::connect(&sock_path) {
                Ok(s) => {
                    stream_opt = Some(s);
                    break;
                }
                Err(_) => continue,
            }
        }
        let stream =
            stream_opt.ok_or_else(|| "hiven-helper did not start in time".to_string())?;

        let read_stream = stream
            .try_clone()
            .map_err(|e| format!("Failed to clone helper connection: {}", e))?;

        let ipc = Arc::new(HelperIpc {
            writer: Mutex::new(BufWriter::new(stream)),
            pending: Mutex::new(VecDeque::new()),
        });

        HELPER_IPC
            .set(Arc::clone(&ipc))
            .map_err(|_| "HelperIpc already initialised".to_string())?;

        // Background reader thread: dispatches command responses to waiting callers.
        let ipc_for_reader = Arc::clone(&ipc);
        std::thread::spawn(move || {
            let reader = BufReader::new(read_stream);
            for line in reader.lines() {
                let line = match line {
                    Ok(l) => l,
                    Err(_) => break,
                };
                let val: serde_json::Value = match serde_json::from_str(&line) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                if val.get("result").is_some() {
                    // Response to a pending command — FIFO match.
                    if let Some(tx) = ipc_for_reader.pending.lock().unwrap().pop_front() {
                        let _ = tx.try_send(val);
                    }
                } // unknown events are ignored
            }
        });

        Ok(())
    }

    /// Send a command to the helper and block until a response arrives (5 s timeout).
    pub fn send_command(cmd: serde_json::Value) -> Result<serde_json::Value, String> {
        let ipc = HELPER_IPC
            .get()
            .ok_or_else(|| "Helper IPC not connected".to_string())?;

        let (tx, rx) = mpsc::sync_channel::<serde_json::Value>(1);
        ipc.pending.lock().unwrap().push_back(tx);

        let line =
            serde_json::to_string(&cmd).map_err(|e| format!("JSON encode error: {}", e))?;
        {
            let mut w = ipc.writer.lock().unwrap();
            writeln!(w, "{}", line).map_err(|e| format!("Helper write error: {}", e))?;
            w.flush()
                .map_err(|e| format!("Helper flush error: {}", e))?;
        }

        rx.recv_timeout(Duration::from_secs(5))
            .map_err(|_| "Helper IPC timeout or disconnected".to_string())
    }
}

// ─── Public surface (macOS only) ──────────────────────────────────────────────

#[cfg(target_os = "macos")]
pub use inner::{launch_and_connect, send_command};
