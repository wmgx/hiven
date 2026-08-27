use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

const EVENT_NAME: &str = "hiven://ai-codex-event";
const RPC_TIMEOUT: Duration = Duration::from_secs(120);
const INITIALIZATION_REQUIRED: &str = "HIVEN_CODEX_INITIALIZATION_REQUIRED";

type RpcResult = Result<Value, String>;
type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<RpcResult>>>>;

struct CodexProcess {
    child: Child,
    stdin: ChildStdin,
    pending: Pending,
    initialized: bool,
}

impl Drop for CodexProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

static PROCESS: OnceLock<Mutex<Option<CodexProcess>>> = OnceLock::new();
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

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
    let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
    let reader_pending = pending.clone();
    let reader_app = app.clone();

    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if let Some(id) = message.get("id").and_then(Value::as_u64) {
                if let Some(sender) = reader_pending
                    .lock()
                    .ok()
                    .and_then(|mut map| map.remove(&id))
                {
                    let result = if let Some(error) = message.get("error") {
                        Err(error
                            .get("message")
                            .and_then(Value::as_str)
                            .unwrap_or("Codex RPC failed")
                            .to_string())
                    } else {
                        Ok(message.get("result").cloned().unwrap_or(Value::Null))
                    };
                    let _ = sender.send(result);
                }
            } else {
                let _ = reader_app.emit(EVENT_NAME, message);
            }
        }
        if let Ok(mut map) = reader_pending.lock() {
            for (_, sender) in map.drain() {
                let _ = sender.send(Err("Codex App Server stopped".to_string()));
            }
        }
    });

    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            log::warn!("[ai/codex] {}", line);
        }
    });

    Ok(CodexProcess {
        child,
        stdin,
        pending,
        initialized: false,
    })
}

fn requires_initialization(initialized: bool, method: Option<&str>) -> bool {
    !initialized && !matches!(method, Some("initialize" | "initialized"))
}

fn reuses_completed_handshake(initialized: bool, method: Option<&str>) -> bool {
    initialized && matches!(method, Some("initialize" | "initialized"))
}

fn write_message(
    app: &AppHandle,
    message: &Value,
) -> Result<Option<oneshot::Receiver<RpcResult>>, String> {
    let mut slot = process_slot().lock().map_err(|error| error.to_string())?;
    let should_restart = slot
        .as_mut()
        .map(|process| process.child.try_wait().ok().flatten().is_some())
        .unwrap_or(true);
    if should_restart {
        *slot = Some(spawn_codex(app)?);
    }
    let process = slot.as_mut().ok_or("Codex process is unavailable")?;
    let method = message.get("method").and_then(Value::as_str);
    if reuses_completed_handshake(process.initialized, method) {
        let receiver = message.get("id").and_then(Value::as_u64).map(|_| {
            let (sender, receiver) = oneshot::channel();
            let _ = sender.send(Ok(Value::Object(Default::default())));
            receiver
        });
        return Ok(receiver);
    }
    if requires_initialization(process.initialized, method) {
        return Err(INITIALIZATION_REQUIRED.to_string());
    }
    let receiver = if let Some(id) = message.get("id").and_then(Value::as_u64) {
        let (sender, receiver) = oneshot::channel();
        process
            .pending
            .lock()
            .map_err(|error| error.to_string())?
            .insert(id, sender);
        Some(receiver)
    } else {
        None
    };
    let mut encoded = serde_json::to_vec(message).map_err(|error| error.to_string())?;
    encoded.push(b'\n');
    if let Err(error) = process
        .stdin
        .write_all(&encoded)
        .and_then(|_| process.stdin.flush())
    {
        if let Some(id) = message.get("id").and_then(Value::as_u64) {
            process
                .pending
                .lock()
                .ok()
                .and_then(|mut map| map.remove(&id));
        }
        return Err(error.to_string());
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
) -> Result<Value, String> {
    if !allowed_method(&method) {
        return Err(format!("Codex RPC method is not allowed: {}", method));
    }
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let receiver = write_message(&app, &rpc_message(method, Some(id), params))?
        .ok_or("Codex RPC response channel is unavailable")?;
    tokio::time::timeout(RPC_TIMEOUT, receiver)
        .await
        .map_err(|_| "Codex RPC timed out".to_string())?
        .map_err(|_| "Codex RPC response channel closed".to_string())?
}

#[tauri::command]
pub fn ai_codex_notify(
    app: AppHandle,
    method: String,
    params: Option<Value>,
) -> Result<(), String> {
    if method != "initialized" {
        return Err("Codex notification is not allowed".to_string());
    }
    write_message(&app, &rpc_message(method, None, params))?;
    let mut slot = process_slot().lock().map_err(|error| error.to_string())?;
    if let Some(process) = slot.as_mut() {
        process.initialized = true;
    }
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
}
