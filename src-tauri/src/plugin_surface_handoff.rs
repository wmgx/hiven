//! Bounded, window-owned handoff receipts. No plugin semantics or durable text.
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
use tauri::Manager;

const MAX_BYTES: usize = 10 * 1024 * 1024;
const TTL_MS: u64 = 120_000;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Receipt {
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    initial_text: Option<String>,
    status: String,
}
struct Entry {
    source: String,
    deadline: u64,
    receipt: Receipt,
}
#[derive(Default)]
struct Handoffs {
    next: u64,
    entries: HashMap<String, Entry>,
}
fn valid_target(label: &str) -> bool {
    let parts: Vec<_> = label.split(':').collect();
    parts.len() == 4 && parts[0] == "plugin-surface"
        && matches!(parts[1], "builtin" | "installed" | "dev")
        && parts[2..].iter().all(|s| !s.is_empty() && s.len() <= 200
            && s.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.')))
}
fn valid_source(label: &str) -> bool {
    matches!(label, "launcher" | "main" | "editor" | "quick-editor")
        || label.strip_prefix("editor:").is_some_and(|id| !id.is_empty() && !id.contains(':'))
        || valid_target(label)
}
fn settle(entry: &mut Entry, status: &str) {
    if entry.receipt.status == "pending" {
        entry.receipt.status = status.into();
        entry.receipt.initial_text = None;
    }
}
fn expire(entry: &mut Entry, now: u64) {
    if now >= entry.deadline { settle(entry, "expired"); }
}
impl Handoffs {
    fn begin(&mut self, source: &str, target: &str, text: String, now: u64) -> Result<Receipt, String> {
        if !valid_target(target) || !valid_source(source) || source == target {
            return Err("PluginSurfaceHandoffInvalidTarget".into());
        }
        if text.len() > MAX_BYTES { return Err("PluginSurfaceHandoffTooLarge".into()); }
        // Release expired text even when a different target is opened later.
        for entry in self.entries.values_mut() { expire(entry, now); }
        if self.entries.get(target).is_some_and(|e| e.receipt.status == "pending") {
            return Err("PluginSurfaceHandoffBusy".into());
        }
        self.next = self.next.checked_add(1).ok_or("PluginSurfaceHandoffExhausted")?;
        let receipt = Receipt { id: self.next.to_string(), initial_text: Some(text), status: "pending".into() };
        self.entries.insert(target.into(), Entry { source: source.into(), deadline: now.saturating_add(TTL_MS), receipt: receipt.clone() });
        Ok(receipt)
    }
    fn peek(&mut self, target: &str, now: u64) -> Option<Receipt> {
        let entry = self.entries.get_mut(target)?;
        expire(entry, now);
        (entry.receipt.status == "pending").then(|| entry.receipt.clone())
    }
    fn status(&mut self, caller: &str, target: &str, id: &str, now: u64) -> Result<String, String> {
        let Some(entry) = self.entries.get_mut(target) else { return Ok("expired".into()) };
        if caller != target && caller != entry.source { return Err("PluginSurfaceHandoffWrongOwner".into()); }
        expire(entry, now);
        Ok(if entry.receipt.id == id { entry.receipt.status.clone() } else { "expired".into() })
    }
    fn finish(&mut self, target: &str, id: &str, accepted: bool, source_alive: impl FnOnce(&str) -> bool, now: u64) -> String {
        let Some(entry) = self.entries.get_mut(target) else { return "expired".into() };
        expire(entry, now);
        if entry.receipt.id != id { return "expired".into(); }
        if entry.receipt.status == "pending" {
            let result = if accepted && source_alive(&entry.source) { "accepted" } else { "rejected" };
            settle(entry, result);
        }
        entry.receipt.status.clone()
    }
    fn cancel(&mut self, caller: &str, target: &str, id: &str, now: u64) -> Result<String, String> {
        let Some(entry) = self.entries.get_mut(target) else { return Ok("expired".into()) };
        if caller != entry.source { return Err("PluginSurfaceHandoffWrongOwner".into()); }
        expire(entry, now);
        if entry.receipt.id != id { return Ok("expired".into()); }
        settle(entry, "rejected");
        Ok(entry.receipt.status.clone())
    }
    fn invalidate(&mut self, label: &str) {
        for (target, entry) in &mut self.entries {
            if target == label || entry.source == label { settle(entry, "rejected"); }
        }
    }
}
fn state() -> &'static Mutex<Handoffs> {
    static STATE: OnceLock<Mutex<Handoffs>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(Handoffs::default()))
}
fn now() -> u64 {
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_millis().min(u64::MAX as u128) as u64
}
pub(crate) fn invalidate_window(label: &str) {
    if let Ok(mut state) = state().lock() { state.invalidate(label); }
}
#[tauri::command(rename_all = "camelCase")]
pub(crate) fn plugin_surface_handoff_begin(caller: tauri::WebviewWindow, label: String, initial_text: String) -> Result<Receipt, String> {
    state().lock().map_err(|_| "PluginSurfaceHandoffUnavailable")?.begin(caller.label(), &label, initial_text, now())
}
#[tauri::command(rename_all = "camelCase")]
pub(crate) fn plugin_surface_handoff_peek(caller: tauri::WebviewWindow) -> Result<Option<Receipt>, String> {
    if !valid_target(caller.label()) { return Err("PluginSurfaceHandoffWrongOwner".into()); }
    Ok(state().lock().map_err(|_| "PluginSurfaceHandoffUnavailable")?.peek(caller.label(), now()))
}
#[tauri::command(rename_all = "camelCase")]
pub(crate) fn plugin_surface_handoff_status(caller: tauri::WebviewWindow, label: String, id: String) -> Result<String, String> {
    state().lock().map_err(|_| "PluginSurfaceHandoffUnavailable")?.status(caller.label(), &label, &id, now())
}
#[tauri::command(rename_all = "camelCase")]
pub(crate) fn plugin_surface_handoff_finish(caller: tauri::WebviewWindow, id: String, accepted: bool) -> Result<String, String> {
    if !valid_target(caller.label()) { return Err("PluginSurfaceHandoffWrongOwner".into()); }
    Ok(state().lock().map_err(|_| "PluginSurfaceHandoffUnavailable")?.finish(caller.label(), &id, accepted,
        |source| caller.app_handle().get_webview_window(source).is_some(), now()))
}
#[tauri::command(rename_all = "camelCase")]
pub(crate) fn plugin_surface_handoff_cancel(caller: tauri::WebviewWindow, label: String, id: String) -> Result<String, String> {
    state().lock().map_err(|_| "PluginSurfaceHandoffUnavailable")?.cancel(caller.label(), &label, &id, now())
}

#[cfg(test)]
mod tests {
    use super::*;
    const TARGET: &str = "plugin-surface:builtin:tool:main";
    #[test]
    fn accepted_receipt_is_stable_and_drops_text() {
        let mut s = Handoffs::default();
        let r = s.begin("launcher", TARGET, "完整🙂".into(), 0).unwrap();
        assert_eq!(s.peek(TARGET, 1).unwrap().initial_text.as_deref(), Some("完整🙂"));
        assert_eq!(s.finish(TARGET, &r.id, true, |_| true, 2), "accepted");
        assert_eq!(s.cancel("launcher", TARGET, &r.id, 3).unwrap(), "accepted");
        assert_eq!(s.finish(TARGET, &r.id, false, |_| true, 4), "accepted");
        assert_eq!(s.status(TARGET, TARGET, &r.id, TTL_MS + 1).unwrap(), "accepted");
        assert!(s.entries[TARGET].receipt.initial_text.is_none());
        assert!(s.peek(TARGET, 5).is_none());
    }
    #[test]
    fn busy_cancel_retry_and_stale_callbacks() {
        let mut s = Handoffs::default();
        let a = s.begin("launcher", TARGET, "old".into(), 0).unwrap();
        assert!(s.begin("editor", TARGET, "other".into(), 1).is_err());
        assert!(s.cancel("editor", TARGET, &a.id, 1).is_err());
        assert!(s.status("editor", TARGET, &a.id, 1).is_err());
        assert_eq!(s.cancel("launcher", TARGET, &a.id, 2).unwrap(), "rejected");
        assert_eq!(s.finish(TARGET, &a.id, true, |_| true, 3), "rejected");
        let b = s.begin("launcher", TARGET, "new".into(), 4).unwrap();
        assert_ne!(a.id, b.id);
        assert_eq!(s.finish(TARGET, &a.id, true, |_| true, 5), "expired");
        assert_eq!(s.cancel("launcher", TARGET, &a.id, 5).unwrap(), "expired");
        assert_eq!(s.peek(TARGET, 5).unwrap().initial_text.as_deref(), Some("new"));
    }
    #[test]
    fn expiration_source_loss_and_window_close_reject() {
        let mut s = Handoffs::default();
        let a = s.begin("launcher", TARGET, "draft".into(), 0).unwrap();
        assert_eq!(s.finish(TARGET, &a.id, true, |_| true, TTL_MS), "expired");
        let b = s.begin("launcher", TARGET, "draft".into(), TTL_MS).unwrap();
        assert_eq!(s.finish(TARGET, &b.id, true, |_| false, TTL_MS + 1), "rejected");
        let c = s.begin("launcher", TARGET, "draft".into(), TTL_MS + 2).unwrap();
        s.invalidate(TARGET);
        assert_eq!(s.finish(TARGET, &c.id, true, |_| true, TTL_MS + 3), "rejected");
        let d = s.begin("launcher", TARGET, "draft".into(), TTL_MS + 4).unwrap();
        s.invalidate("launcher");
        assert_eq!(s.status("launcher", TARGET, &d.id, TTL_MS + 5).unwrap(), "rejected");
    }
    #[test]
    fn exact_byte_limit_empty_and_target_validation() {
        let mut s = Handoffs::default();
        assert!(s.begin(TARGET, TARGET, "".into(), 0).is_err());
        assert!(s.begin("toast-hud", TARGET, "".into(), 0).is_err());
        for invalid in ["launcher", "plugin-surface:", "plugin-surface:other:a:b", "plugin-surface:builtin:a:b:extra"] {
            assert!(s.begin("launcher", invalid, "".into(), 0).is_err());
        }
        let empty = s.begin("launcher", TARGET, "".into(), 0).unwrap();
        assert_eq!(empty.initial_text.as_deref(), Some(""));
        s.cancel("launcher", TARGET, &empty.id, 1).unwrap();
        assert!(s.begin("launcher", TARGET, "é".repeat(MAX_BYTES / 2 + 1), 2).is_err());
        assert!(s.begin("launcher", TARGET, "é".repeat(MAX_BYTES / 2), 2).is_ok());
    }
}
