//! Bundled History's bounded, session-only handoff to the hidden launcher.
//! No arbitrary plugin messages, persistence, target selection, or workflow API.
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use serde::{Deserialize, Serialize};
use tauri::Emitter;
#[cfg(target_os = "linux")]
use tauri_plugin_clipboard_manager::ClipboardExt;

const HISTORY: &str = "plugin-surface:builtin:clipboard-history:main";
const MAX_BYTES: usize = 1024 * 1024;
#[cfg(target_os = "linux")]
const TARGET: &str = "history-paste-queue";
#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct Item { id: String, text: String }
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Action { Start, Cancel, Status }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Request { id: String, action: Action, items: Vec<Item>, session_id: Option<String> }
struct Envelope { owner: String, request: Request, expires: Instant, taken: bool }
fn requests() -> &'static Mutex<HashMap<String, Envelope>> {
    static STORE: OnceLock<Mutex<HashMap<String, Envelope>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(HashMap::new()))
}
fn require_launcher(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "launcher" { Ok(()) } else { Err("QueueUnavailableError".into()) }
}
fn valid_id(id: &str) -> bool { !id.is_empty() && id.len() <= 160 }
fn validate(items: &[Item]) -> bool {
    let mut ids = std::collections::HashSet::new();
    (1..=20).contains(&items.len()) && items.iter().all(|item| !item.id.is_empty() && item.id.len() <= 256 && ids.insert(&item.id))
        && items.iter().try_fold(0usize, |size, item| size.checked_add(item.text.len())).is_some_and(|size| size <= MAX_BYTES)
}
#[tauri::command]
pub(crate) fn history_queue_request(app: tauri::AppHandle, window: tauri::WebviewWindow, id: String, action: Action, items: Option<Vec<Item>>, session_id: Option<String>) -> Result<(), String> {
    if !["launcher", HISTORY].contains(&window.label()) || !valid_id(&id) || session_id.as_ref().is_some_and(|id| !valid_id(id)) { return Err("QueueUnavailableError".into()); }
    let items = items.unwrap_or_default();
    if matches!(action, Action::Start) && (!window.is_visible().unwrap_or(false) || !validate(&items)) { return Err("QueueSnapshotError".into()); }
    if !matches!(action, Action::Start) && !items.is_empty() { return Err("QueueSnapshotError".into()); }
    {
        let mut store = requests().lock().map_err(|_| "QueueUnavailableError")?;
        store.retain(|_, value| value.expires > Instant::now());
        if store.len() >= 64 || store.contains_key(&id) { return Err("QueueBusyError".into()); }
        store.insert(id.clone(), Envelope { owner: window.label().into(), request: Request { id: id.clone(), action, items, session_id }, expires: Instant::now() + Duration::from_secs(10), taken: false });
    }
    let expiry_id = id.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(10)).await;
        if let Ok(mut store) = requests().lock() {
            if store.get(&expiry_id).is_some_and(|entry| entry.expires <= Instant::now()) { store.remove(&expiry_id); }
        }
    });
    app.emit_to("launcher", "hiven://history-queue-request", id).map_err(|_| "QueueUnavailableError".into())
}
#[tauri::command]
pub(crate) fn history_queue_take(window: tauri::WebviewWindow, id: String) -> Result<Option<Request>, String> {
    require_launcher(&window)?;
    let mut store = requests().lock().map_err(|_| "QueueUnavailableError")?;
    let Some(value) = store.get_mut(&id) else { return Ok(None) };
    if value.taken || value.expires <= Instant::now() { return Ok(None); }
    value.taken = true;
    // Move full snapshots out; the response receipt keeps no user text.
    let items = std::mem::take(&mut value.request.items);
    let mut request = value.request.clone();
    request.items = items;
    Ok(Some(request))
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Status {
    session_id: String, version: u64, phase: String, busy: bool,
    total: u32, completed: u32, remaining: u32, current_id: Option<String>,
}
impl Status {
    fn valid(&self) -> bool {
        self.total <= 20 && self.completed <= self.total && self.remaining <= self.total
            && ["idle", "ready", "failed", "completed", "cancelled"].contains(&self.phase.as_str())
            && (self.session_id.is_empty() || valid_id(&self.session_id))
            && self.current_id.as_ref().map_or(true, |id| id.len() <= 256)
    }
}
#[tauri::command]
pub(crate) fn history_queue_reply(app: tauri::AppHandle, window: tauri::WebviewWindow, id: String, ok: bool, status: Status, error_code: Option<String>) -> Result<(), String> {
    require_launcher(&window)?;
    if !status.valid() || error_code.as_ref().is_some_and(|code| !["QueueUnavailableError", "QueueShortcutConflictError", "QueueCancelledError", "QueueSnapshotError", "QueuePlatformUnavailableError"].contains(&code.as_str())) { return Err("QueueUnavailableError".into()); }
    let envelope = requests().lock().map_err(|_| "QueueUnavailableError")?.remove(&id);
    if let Some(envelope) = envelope.filter(|value| value.taken && value.expires > Instant::now()) {
        app.emit_to(&envelope.owner, "hiven://history-queue-reply", serde_json::json!({"id":id,"ok":ok,"status":status,"errorCode":error_code})).map_err(|_| "QueueUnavailableError")?;
    }
    Ok(())
}
#[tauri::command]
pub(crate) fn history_queue_publish(app: tauri::AppHandle, window: tauri::WebviewWindow, status: Status) -> Result<(), String> {
    require_launcher(&window)?;
    if !status.valid() { return Err("QueueUnavailableError".into()); }
    app.emit_to(HISTORY, "hiven://history-queue-status", &status).map_err(|_| "QueueUnavailableError")?;
    app.emit_to("launcher", "hiven://history-queue-status", &status).map_err(|_| "QueueUnavailableError".into())
}

#[tauri::command]
pub(crate) async fn begin_history_queue_paste(window: tauri::WebviewWindow) -> Result<String, String> {
    require_launcher(&window)?;
    if window.is_visible().unwrap_or(true) { return Err("QueueTargetError".into()); }
    #[cfg(target_os = "linux")]
    {
        crate::linux_x11_paste::remember_target(TARGET, false);
        let target = crate::linux_x11_paste::snapshot(TARGET).map_err(|_| "QueueTargetError")?;
        crate::linux_x11_paste::verify_focused_target(&target).map_err(|_| "QueueTargetError")?;
        return crate::paste_recovery::begin("launcher").map(|attempt| attempt.id.clone()).ok_or_else(|| "QueueTargetError".into());
    }
    // Other platforms must implement equally strict target identity and held-key
    // checks before enabling hidden delivery; no unverified timed fallback.
    #[cfg(not(target_os = "linux"))]
    Err("QueuePlatformUnavailableError".into())
}
#[tauri::command]
pub(crate) async fn paste_history_queue_text(app: tauri::AppHandle, window: tauri::WebviewWindow, attempt_id: String, text: String) -> Result<(), String> {
    require_launcher(&window)?;
    if text.len() > MAX_BYTES || window.is_visible().unwrap_or(true) { return Err("QueueTargetError".into()); }
    let attempt = crate::paste_recovery::current("launcher", &attempt_id)?;
    attempt.claim()?;
    #[cfg(target_os = "linux")]
    {
        let target = crate::linux_x11_paste::snapshot(TARGET).map_err(|_| "QueueTargetError")?;
        let for_write = attempt.clone();
        let verify_target = target.clone();
        let (tx, rx) = tokio::sync::oneshot::channel();
        let handle = app.clone();
        app.run_on_main_thread(move || {
            let result = (|| {
                for_write.ensure_active()?;
                crate::linux_x11_paste::verify_focused_target(&verify_target).map_err(|_| "QueueTargetError")?;
                for_write.ensure_active()?;
                handle.clipboard().write_text(text).map_err(|_| "QueueClipboardError")?;
                Ok::<(), String>(())
            })();
            let _ = tx.send(result);
        }).map_err(|_| "QueueUnavailableError")?;
        let result = async {
            rx.await.map_err(|_| "QueueUnavailableError")??;
            let delivery_attempt = attempt.clone();
            let delivery_target = target.clone();
            tokio::task::spawn_blocking(move || crate::linux_x11_paste::paste_focused_owned(delivery_target, &delivery_attempt)).await.map_err(|_| "QueueDeliveryError")?.map_err(|_| String::from("QueueDeliveryError"))
        }.await;
        crate::linux_x11_paste::clear_target_if_current(&target);
        crate::paste_recovery::cancel("launcher", &attempt_id);
        return result;
    }
    #[cfg(not(target_os = "linux"))]
    { let _ = (app, text, attempt); Err("QueuePlatformUnavailableError".into()) }
}

#[tauri::command]
pub(crate) fn get_history_queue_availability(window: tauri::WebviewWindow) -> Result<&'static str, String> {
    if !["launcher", HISTORY].contains(&window.label()) { return Err("QueueUnavailableError".into()); }
    #[cfg(target_os = "linux")]
    { Ok(if crate::linux_x11_paste::can_attempt() { "can-attempt" } else { "unsupported" }) }
    #[cfg(not(target_os = "linux"))]
    { Ok("unsupported") }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn handoff_rejects_empty_duplicate_and_over_limit_snapshots() {
        assert!(!validate(&[]));
        assert!(!validate(&[Item { id: "a".into(), text: "one".into() }, Item { id: "a".into(), text: "two".into() }]));
        assert!(!validate(&[Item { id: "a".into(), text: "界".repeat(MAX_BYTES / 3 + 1) }]));
        assert!(validate(&[Item { id: "a".into(), text: "".into() }, Item { id: "b".into(), text: "完整\ntext".into() }]));
    }
    #[test]
    fn status_contains_only_bounded_metadata() {
        let mut status = Status { session_id: String::new(), version: 0, phase: "idle".into(), busy: false, total: 0, completed: 0, remaining: 0, current_id: None };
        assert!(status.valid());
        status.phase = "arbitrary body".into();
        assert!(!status.valid());
        status.phase = "ready".into(); status.total = 21;
        assert!(!status.valid());
    }
}
