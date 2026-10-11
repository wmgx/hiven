//! A single non-activating, content-free status window. All window mutations are
//! serialized on the UI thread; webview readiness never revives an old receipt.
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

const LABEL: &str = "toast-hud";
const EVENT: &str = "hiven://hud-toast";
const MAX_LIFETIME: u64 = 15_000;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Level { Success, Error, Warning, Info }
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Locale { Zh, En }
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Theme { Light, Dark }
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct Progress { completed: u32, total: u32 }
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Snapshot {
    id: String,
    level: Level,
    expires_at: u64,
    locale: Locale,
    theme: Theme,
    progress: Option<Progress>,
}
#[derive(Clone, Debug, Serialize)]
pub(crate) struct HudUpdate { revision: u64, toast: Option<Snapshot> }
#[derive(Clone)]
struct Pending { owner: String, sequence: u64, snapshot: Snapshot }
#[derive(Default)]
struct State {
    pending: Option<Pending>,
    sequences: HashMap<String, u64>,
    dismissed: HashMap<String, HashSet<String>>,
    ready: bool,
    latest_sequence: u64,
    revision: u64,
}
impl State {
    fn accept(&mut self, owner: &str, sequence: u64, id: &str, expires_at: u64, now: u64) -> bool {
        if expires_at <= now || expires_at > now.saturating_add(MAX_LIFETIME)
            || sequence < self.latest_sequence
            || sequence <= *self.sequences.get(owner).unwrap_or(&0)
            || self.dismissed.get(owner).is_some_and(|ids| ids.contains(id)) {
            return false;
        }
        self.latest_sequence = sequence;
        self.sequences.insert(owner.into(), sequence);
        true
    }
    fn cancel(&mut self, owner: &str, id: &str) -> bool {
        // Bounded per-owner tombstones cover dismiss-before-route races.
        let ids = self.dismissed.entry(owner.into()).or_default();
        if ids.len() >= 256 {
            ids.clear();
            self.sequences.insert(owner.into(), now().saturating_mul(1000).saturating_add(999));
        }
        ids.insert(id.into());
        let matches = self.pending.as_ref().is_some_and(|p| p.owner == owner && p.snapshot.id == id);
        if matches { self.pending = None; }
        matches
    }
}
fn registry() -> &'static Mutex<State> { static STATE: OnceLock<Mutex<State>> = OnceLock::new(); STATE.get_or_init(|| Mutex::new(State::default())) }
// Fixed lifecycle stages only: no owner labels, ids, bodies, paths, or credentials.
fn trace(stage: &'static str) { super::log_launcher_perf("native:hud.lifecycle", Instant::now(), stage); }
fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }
fn surface(label: &str) -> bool { label == "launcher" || label == "main" || label == "quick-editor" || label.starts_with("plugin-surface:") || label.starts_with("editor:") }
fn visible_target(app: &tauri::AppHandle, owner: &str) -> Option<String> {
    let mut windows: Vec<_> = app.webview_windows().into_iter()
        .filter(|(label, window)| surface(label) && window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false))
        .collect();
    windows.sort_by_key(|(label, window)| (label != owner, !window.is_focused().unwrap_or(false), label.clone()));
    windows.first().map(|(label, _)| label.clone())
}
fn hide(app: &tauri::AppHandle) {
    trace("hide-enter");
    let update = {
        let Ok(mut state) = registry().lock() else { return };
        state.revision = state.revision.saturating_add(1);
        HudUpdate { revision: state.revision, toast: None }
    };
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.hide();
        let _ = window.emit(EVENT, update);
    }
    trace("hide-returned");
}
fn same_pending(current: Option<&Pending>, expected: &Pending) -> bool {
    current.is_some_and(|p| p.sequence == expected.sequence && p.owner == expected.owner && p.snapshot.id == expected.snapshot.id)
}
fn current_update() -> Result<HudUpdate, String> {
    let state = registry().lock().map_err(|_| "hud-unavailable")?;
    Ok(HudUpdate { revision: state.revision, toast: state.pending.as_ref().map(|p| p.snapshot.clone()) })
}
fn show_current(app: &tauri::AppHandle) -> Result<HudUpdate, String> {
    trace("show-enter");
    // Never hold our state mutex across a Tauri/GTK call. Synchronous window
    // queries may reenter the event loop and owner/window lifecycle callbacks.
    let pending = { registry().lock().map_err(|_| "hud-unavailable")?.pending.clone() };
    let Some(pending) = pending else { hide(app); return current_update(); };
    trace("show-visible-query-enter");
    let valid = pending.snapshot.expires_at > now() && visible_target(app, &pending.owner).is_none();
    trace("show-visible-query-returned");
    let (update, ready, cleared) = {
        let mut state = registry().lock().map_err(|_| "hud-unavailable")?;
        if !same_pending(state.pending.as_ref(), &pending) {
            return Ok(HudUpdate { revision: state.revision, toast: state.pending.as_ref().map(|p| p.snapshot.clone()) });
        }
        if !valid { state.pending = None; }
        (HudUpdate { revision: state.revision, toast: state.pending.as_ref().map(|p| p.snapshot.clone()) }, state.ready, !valid)
    };
    if cleared { hide(app); return current_update(); }
    if !ready { return Ok(update); }
    let window = app.get_webview_window(LABEL).ok_or("hud-unavailable")?;
    trace("show-position-enter");
    if let Some(monitor) = super::monitor_under_cursor(&window).or_else(|| window.primary_monitor().ok().flatten()) {
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        let width = (360.0 * scale).min(area.size.width as f64).max(1.0);
        let height = (100.0 * scale).min(area.size.height as f64).max(1.0);
        let x = area.position.x as f64 + (area.size.width as f64 - width) / 2.0;
        let y = area.position.y as f64 + (area.size.height as f64 - height - 32.0 * scale).max(0.0);
        window.set_size(tauri::PhysicalSize::new(width as u32, height as u32)).map_err(|_| "hud-unavailable")?;
        window.set_position(tauri::PhysicalPosition::new(x as i32, y as i32)).map_err(|_| "hud-unavailable")?;
    }
    trace("show-position-returned");
    let current = { registry().lock().map_err(|_| "hud-unavailable")?.pending.as_ref().is_some_and(|p| same_pending(Some(p), &pending) && p.snapshot.expires_at > now()) };
    if !current { return current_update(); }
    trace("show-map-enter");
    window.emit(EVENT, &update).map_err(|_| "hud-unavailable")?;
    window.show().map_err(|_| "hud-unavailable")?;
    // Tao's GTK backend unwraps the GdkWindow when applying an input shape.
    // A never-shown hidden window has no GdkWindow yet. Queue this after show
    // (GTK show_all realizes it); focused(false)+focusable(false) already
    // prevents activation during the first map. Both requests use FIFO order.
    window.set_ignore_cursor_events(true).map_err(|_| "hud-unavailable")?;
    trace("show-returned");
    Ok(update)
}
fn ensure_window(app: &tauri::AppHandle) -> Result<(), String> {
    if app.get_webview_window(LABEL).is_some() { return Ok(()); }
    registry().lock().map_err(|_| "hud-unavailable")?.ready = false;
    let window = tauri::WebviewWindowBuilder::new(app, LABEL, tauri::WebviewUrl::App("index.html?window=toast-hud".into()))
        .title("Hiven").inner_size(360.0, 100.0).decorations(false).transparent(true)
        .shadow(false).resizable(false).visible(false).focused(false).focusable(false)
        .always_on_top(true).skip_taskbar(true).build().map_err(|_| "hud-unavailable")?;
    // Deliberately no paste recovery registration, foreground capture, or
    // launcher focus/blur handlers: this window is never a user input target.
    window.on_window_event(|event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            if let Ok(mut state) = registry().lock() { state.ready = false; state.pending = None; }
        }
    });
    Ok(())
}
async fn ui<T: Send + 'static>(app: tauri::AppHandle, work: impl FnOnce(&tauri::AppHandle) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || { let _ = tx.send(work(&handle)); }).map_err(|_| "hud-unavailable")?;
    rx.await.map_err(|_| "hud-unavailable")?
}
#[tauri::command]
pub(crate) async fn route_toast(app: tauri::AppHandle, window: tauri::WebviewWindow, id: String, sequence: u64, level: Level, expires_at: u64, locale: Locale, theme: Theme, progress: Option<Progress>) -> Result<Option<String>, String> {
    trace("route-enter");
    let owner = window.label().to_owned();
    if !surface(&owner) || id.is_empty() || id.len() > 160 || progress.as_ref().is_some_and(|p| !(1..=20).contains(&p.total) || p.completed > p.total) { return Err("hud-unavailable".into()); }
    let timer_owner = owner.clone();
    let timer_id = id.clone();
    let (target, needs_hud) = ui(app.clone(), move |app| {
        trace("route-ui-enter");
        let mut state = registry().lock().map_err(|_| "hud-unavailable")?;
        if !state.accept(&owner, sequence, &id, expires_at, now()) { return Ok((None, false)); }
        state.pending = None;
        drop(state);
        trace("route-ui-accepted");
        hide(app);
        trace("route-visible-query-enter");
        if let Some(target) = visible_target(app, &owner) { trace("route-visible-target"); return Ok((Some(target), false)); }
        trace("route-visible-query-returned");
        {
            let mut state = registry().lock().map_err(|_| "hud-unavailable")?;
            state.revision = state.revision.saturating_add(1);
            state.pending = Some(Pending { owner, sequence, snapshot: Snapshot { id, level, expires_at, locale, theme, progress } });
        }
        Ok((None, true))
    }).await?;
    if !needs_hud { return Ok(target); }

    // On Linux WebviewWindowBuilder synchronously waits for webview creation
    // dispatched to the UI loop. Calling it inside run_on_main_thread deadlocks
    // that loop. Serialize lazy creation on this async command's worker instead.
    static CREATION: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    {
        trace("ensure-enter");
        let _creation = CREATION.lock().await;
        ensure_window(&app)?;
        trace("ensure-returned");
    }
    let show_owner = timer_owner.clone();
    let show_id = timer_id.clone();
    let current = ui(app.clone(), move |app| {
        let current = {
            let state = registry().lock().map_err(|_| "hud-unavailable")?;
            state.pending.as_ref().is_some_and(|p| p.sequence == sequence && p.owner == show_owner && p.snapshot.id == show_id)
        };
        if current { show_current(app)?; }
        Ok(current)
    }).await?;
    if !current { return Ok(None); }
    trace("route-returned");
    tauri::async_runtime::spawn(async move {
        let mut first_poll = true;
        loop {
            tokio::time::sleep(Duration::from_millis(100)).await;
            let timer_owner = timer_owner.clone();
            let timer_id = timer_id.clone();
            let log_poll = first_poll;
            first_poll = false;
            let result = ui(app.clone(), move |app| {
                if log_poll { trace("poll-first-enter"); }
                let pending = { registry().lock().map_err(|_| "hud-unavailable")?.pending.clone() };
                let Some(pending) = pending.filter(|p| p.sequence == sequence && p.owner == timer_owner && p.snapshot.id == timer_id) else { return Ok(false); };
                let expired = pending.snapshot.expires_at <= now() || visible_target(app, &pending.owner).is_some();
                let cleared = {
                    let mut state = registry().lock().map_err(|_| "hud-unavailable")?;
                    if !same_pending(state.pending.as_ref(), &pending) { return Ok(false); }
                    if expired { state.pending = None; }
                    expired
                };
                if cleared { hide(app); return Ok(false); }
                if log_poll { trace("poll-first-returned"); }
                Ok(true)
            }).await;
            if result != Ok(true) { break; }
        }
    });
    Ok(None)
}
#[tauri::command]
pub(crate) async fn hud_ready(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<HudUpdate, String> {
    if window.label() != LABEL { return Err("hud-unavailable".into()); }
    trace("ready-enter");
    ui(app, |app| { registry().lock().map_err(|_| "hud-unavailable")?.ready = true; show_current(app) }).await
}
#[tauri::command]
pub(crate) async fn dismiss_toast(app: tauri::AppHandle, window: tauri::WebviewWindow, id: String) -> Result<(), String> {
    let owner = window.label().to_owned();
    if !surface(&owner) || id.len() > 160 { return Err("hud-unavailable".into()); }
    ui(app, move |app| {
        let cancelled = { registry().lock().map_err(|_| "hud-unavailable")?.cancel(&owner, &id) };
        if cancelled { hide(app); }
        Ok(())
    }).await
}
pub(crate) fn invalidate_owner(app: &tauri::AppHandle, owner: &str) {
    let cleared = {
        let Ok(mut state) = registry().lock() else { return };
        state.sequences.insert(owner.into(), now().saturating_mul(1000).saturating_add(999));
        let current = state.pending.as_ref().is_some_and(|p| p.owner == owner);
        if current { state.pending = None; }
        current
    };
    if cleared { hide(app); }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_expired_out_of_order_and_dismissed_receipts() {
        let mut s = State::default();
        assert!(s.accept("launcher", 10, "a", 200, 100));
        assert!(!s.accept("launcher", 9, "old", 200, 100));
        assert!(!s.accept("launcher", 11, "expired", 100, 100));
        assert!(!s.accept("launcher", 11, "unbounded", 20_000, 100));
        s.cancel("launcher", "cancelled");
        assert!(!s.accept("launcher", 11, "cancelled", 200, 100));
        assert!(!s.accept("editor:1", 1, "late-owner", 200, 100));
        assert!(s.accept("editor:1", 12, "cancelled", 200, 100));
    }
    #[test]
    fn dismissal_is_owner_and_id_scoped() {
        let mut s = State::default();
        s.pending = Some(Pending { owner: "launcher".into(), sequence: 12, snapshot: Snapshot { id: "new".into(), level: Level::Success, expires_at: 200, locale: Locale::En, theme: Theme::Dark, progress: None } });
        assert!(!s.cancel("launcher", "old"));
        assert!(!s.cancel("editor:1", "new"));
        assert!(s.pending.is_some());
        assert!(s.cancel("launcher", "new"));
        assert!(s.pending.is_none());
    }
    #[test]
    fn hud_is_not_an_eligible_surface() { assert!(!surface(LABEL)); assert!(surface("launcher")); assert!(surface("plugin-surface:builtin:x:y")); }
}
