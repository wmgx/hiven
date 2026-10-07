use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[path = "ai_codex_transport.rs"]
mod transport;
use transport::{Connection, PendingReply, CONNECTION_CHANGED};

const EVENT_NAME: &str = "hiven://ai-codex-event";
const RPC_TIMEOUT: Duration = Duration::from_secs(120);
const INITIALIZATION_REQUIRED: &str = "HIVEN_CODEX_INITIALIZATION_REQUIRED";

struct CodexProcess {
    child: Child,
    stdin: ChildStdin,
    connection: Arc<Connection>,
    initialized: bool,
}

impl Drop for CodexProcess {
    fn drop(&mut self) {
        self.connection.close("Codex App Server stopped");
        let _ = self.child.kill();
    }
}

static PROCESS: OnceLock<Mutex<Option<CodexProcess>>> = OnceLock::new();
static NEXT_ID: AtomicU64 = AtomicU64::new(1);
static NEXT_CONNECTION_ID: AtomicU64 = AtomicU64::new(1);

fn process_slot() -> &'static Mutex<Option<CodexProcess>> {
    PROCESS.get_or_init(|| Mutex::new(None))
}

fn allowed_method(method: &str) -> bool {
    matches!(
        method,
        "initialize"
            | "account/read"
            | "account/login/start"
            | "account/login/cancel"
            | "account/logout"
            | "account/rateLimits/read"
            | "account/usage/read"
            | "model/list"
            | "modelProvider/capabilities/read"
            | "thread/start"
            | "turn/start"
            | "turn/interrupt"
    )
}

fn spawn_codex(app: &AppHandle) -> Result<CodexProcess, String> {
    let ai_home = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?
        .join("ai");
    let codex_home = ai_home.join("codex");
    let workspace = ai_home.join("workspace");
    std::fs::create_dir_all(&codex_home).map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&workspace).map_err(|error| error.to_string())?;
    let configured = std::env::var("HIVEN_CODEX_BIN").ok();
    let mut candidates = configured.into_iter().collect::<Vec<_>>();
    #[cfg(target_os = "macos")]
    candidates.push("/Applications/ChatGPT.app/Contents/Resources/codex".to_string());
    candidates.extend([
        "codex".to_string(),
        "/opt/homebrew/bin/codex".to_string(),
        "/usr/local/bin/codex".to_string(),
    ]);

    let mut last_error = String::new();
    let mut child = None;
    for candidate in candidates {
        match Command::new(&candidate)
            .args(["app-server", "--stdio"])
            .env("CODEX_HOME", &codex_home)
            .current_dir(&workspace)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(value) => {
                child = Some(value);
                break;
            }
            Err(error) => last_error = format!("{}: {}", candidate, error),
        }
    }
    let mut child =
        child.ok_or_else(|| format!("Codex executable was not found ({})", last_error))?;
    let stdin = child.stdin.take().ok_or("Codex stdin is unavailable")?;
    let stdout = child.stdout.take().ok_or("Codex stdout is unavailable")?;
    let stderr = child.stderr.take().ok_or("Codex stderr is unavailable")?;
    let reader_app = app.clone();
    let connection = Connection::new(
        NEXT_CONNECTION_ID.fetch_add(1, Ordering::Relaxed).to_string(),
        move |event| { let _ = reader_app.emit(EVENT_NAME, event); },
    );
    let reader_connection = connection.clone();

    std::thread::spawn(move || {
        reader_connection.read(BufReader::new(stdout));
    });

    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            log::warn!("[ai/codex] {}", line);
        }
    });

    Ok(CodexProcess {
        child,
        stdin,
        connection,
        initialized: false,
    })
}

fn requires_initialization(initialized: bool, method: Option<&str>) -> bool {
    !initialized && !matches!(method, Some("initialize" | "initialized"))
}

fn reuses_completed_handshake(initialized: bool, method: Option<&str>) -> bool {
    initialized && matches!(method, Some("initialize" | "initialized"))
}

fn accepts_connection(
    method: Option<&str>,
    expected: Option<&str>,
    connection: Option<&Connection>,
) -> bool {
    match expected {
        Some(expected) => connection.is_some_and(|connection| connection.matches(expected)),
        None => method != Some("initialized"),
    }
}

fn write_message(
    app: &AppHandle,
    message: &Value,
    expected_connection_id: Option<&str>,
) -> Result<Option<PendingReply>, String> {
    let mut slot = process_slot().lock().map_err(|error| error.to_string())?;
    let method = message.get("method").and_then(Value::as_str);
    let should_restart = slot
        .as_mut()
        .map(|process| process.connection.is_closed() || process.child.try_wait().ok().flatten().is_some())
        .unwrap_or(true);
    // An acknowledgement or an existing turn belongs to one exact process.
    // Never spawn/replay it on a replacement process, even if the old one died
    // between initialize's response and the initialized notification.
    if expected_connection_id.is_some() || method == Some("initialized") {
        if should_restart || !accepts_connection(
            method, expected_connection_id, slot.as_ref().map(|process| process.connection.as_ref()),
        ) {
            return Err(CONNECTION_CHANGED.to_string());
        }
    }
    if should_restart {
        *slot = Some(spawn_codex(app)?);
    }
    let process = slot.as_mut().ok_or("Codex process is unavailable")?;
    if reuses_completed_handshake(process.initialized, method) {
        let receiver = message.get("id").and_then(Value::as_u64).map(|_| {
            PendingReply::ready(process.connection.tag(Value::Object(Default::default())))
        });
        return Ok(receiver);
    }
    if requires_initialization(process.initialized, method) {
        return Err(INITIALIZATION_REQUIRED.to_string());
    }
    let receiver = process.connection.write(&mut process.stdin, message)?;
    if method == Some("initialized") {
        if process.connection.is_closed() {
            return Err(CONNECTION_CHANGED.to_string());
        }
        // Keep the write and state change under the same process-slot lock.
        process.initialized = true;
    }
    Ok(receiver)
}

fn rpc_message(method: String, id: Option<u64>, params: Option<Value>) -> Value {
    let mut message = serde_json::Map::new();
    message.insert("method".to_string(), Value::String(method));
    if let Some(id) = id {
        message.insert("id".to_string(), Value::Number(id.into()));
    }
    if let Some(params) = params {
        message.insert("params".to_string(), params);
    }
    Value::Object(message)
}

#[tauri::command]
pub async fn ai_codex_rpc(
    app: AppHandle,
    method: String,
    params: Option<Value>,
    expected_connection_id: Option<String>,
) -> Result<Value, String> {
    if !allowed_method(&method) {
        return Err(format!("Codex RPC method is not allowed: {}", method));
    }
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let receiver = write_message(&app, &rpc_message(method, Some(id), params), expected_connection_id.as_deref())?
        .ok_or("Codex RPC response channel is unavailable")?;
    receiver.wait(RPC_TIMEOUT).await
}

#[tauri::command]
pub fn ai_codex_notify(
    app: AppHandle,
    method: String,
    params: Option<Value>,
    expected_connection_id: Option<String>,
) -> Result<(), String> {
    if method != "initialized" {
        return Err("Codex notification is not allowed".to_string());
    }
    write_message(&app, &rpc_message(method, None, params), expected_connection_id.as_deref())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rpc_allowlist_excludes_codex_shell() {
        assert!(allowed_method("turn/start"));
        assert!(allowed_method("account/login/start"));
        assert!(!allowed_method("command/exec"));
        assert!(!allowed_method("config/value/write"));
    }

    #[test]
    fn rpc_message_omits_absent_params() {
        let message = rpc_message("account/logout".to_string(), Some(1), None);
        assert_eq!(message.get("id").and_then(Value::as_u64), Some(1));
        assert!(message.get("params").is_none());
    }

    #[test]
    fn restarted_process_requires_initialize_before_requests() {
        assert!(requires_initialization(false, Some("account/read")));
        assert!(!requires_initialization(false, Some("initialize")));
        assert!(!requires_initialization(false, Some("initialized")));
        assert!(!requires_initialization(true, Some("account/read")));
    }

    #[test]
    fn repeated_handshake_reuses_live_initialized_process() {
        assert!(reuses_completed_handshake(true, Some("initialize")));
        assert!(reuses_completed_handshake(true, Some("initialized")));
        assert!(!reuses_completed_handshake(false, Some("initialize")));
        assert!(!reuses_completed_handshake(true, Some("account/read")));
    }

    #[test]
    fn initialized_ack_and_bound_turn_cannot_cross_connection_generations() {
        let connection = Connection::new("new".into(), |_| {});
        assert!(!accepts_connection(Some("initialized"), None, Some(&connection)));
        assert!(!accepts_connection(Some("initialized"), Some("old"), Some(&connection)));
        assert!(!accepts_connection(Some("initialized"), Some("old"), None));
        assert!(!accepts_connection(Some("turn/start"), Some("old"), Some(&connection)));
        assert!(accepts_connection(Some("initialized"), Some("new"), Some(&connection)));
        assert!(accepts_connection(Some("turn/interrupt"), Some("new"), Some(&connection)));
        connection.close("fixture close");
        assert!(!accepts_connection(Some("initialized"), Some("new"), Some(&connection)));
        assert!(accepts_connection(Some("initialize"), None, None));
    }
}
