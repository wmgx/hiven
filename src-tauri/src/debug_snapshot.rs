//! Read-only development diagnostics. Content never crosses this schema.
use serde::{Deserialize, Serialize};
use std::sync::{atomic::{AtomicU64, Ordering}, Mutex};
use tauri::{Emitter, Listener};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Frontend {
    request_id: u64,
    shortcuts: Vec<Shortcut>,
    queue: Queue,
    errors: Vec<NativeError>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Shortcut {
    role: String,
    kind: String,
    key: String,
    failure: Option<String>,
    #[serde(default)]
    registered: bool,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Queue { phase: String, busy: bool, total: u32, completed: u32, remaining: u32 }
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct NativeError { ts: u64, source: String, code: String }

#[tauri::command]
pub(crate) async fn hiven_debug_snapshot(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    if !cfg!(debug_assertions) { return Err("DebugUnavailable".into()); }
    static REQUEST: AtomicU64 = AtomicU64::new(1);
    let request_id = REQUEST.fetch_add(1, Ordering::Relaxed);
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let sender = Mutex::new(Some(sender));
    let listener = app.listen("hiven://debug-snapshot-response", move |event| {
        if let Ok(state) = serde_json::from_str::<Frontend>(event.payload()) {
            if state.request_id == request_id {
                if let Some(sender) = sender.lock().ok().and_then(|mut slot| slot.take()) { let _ = sender.send(state); }
            }
        }
    });
    let sent = app.emit_to("launcher", "hiven://debug-snapshot-request", request_id);
    let result = if sent.is_ok() {
        tokio::time::timeout(std::time::Duration::from_secs(2), receiver).await
            .map_err(|_| "DebugFrontendTimeout".to_string()).and_then(|value| value.map_err(|_| "DebugFrontendUnavailable".to_string()))
    } else { Err("DebugFrontendUnavailable".into()) };
    app.unlisten(listener);
    let mut state = result?;
    if state.errors.len() > 20 || state.shortcuts.len() > 1024 {
        return Err("DebugSnapshotInvalid".into());
    }
    for shortcut in &mut state.shortcuts {
        shortcut.registered = match shortcut.kind.as_str() {
            "accelerator" => app.global_shortcut().is_registered(shortcut.key.replace("Cmd", "Command").as_str()),
            "double-modifier" => crate::hotkeys::debug_double_modifier_registered(&shortcut.key),
            _ => false,
        };
    }
    Ok(serde_json::json!({
        "shortcuts": state.shortcuts, "queue": state.queue,
        "notifications": crate::toast_hud::debug_snapshot(app).await?,
        "errors": state.errors,
    }))
}
