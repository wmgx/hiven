//! A single non-activating status window with two slots: one transient flash
//! and one persistent status. Text is host-localized status copy only (never
//! clipboard or selection content). All window mutations are serialized on the
//! UI thread; webview readiness never revives an old receipt.
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

const LABEL: &str = "toast-hud";
const EVENT: &str = "hiven://hud-toast";
const MAX_LIFETIME: u64 = 15_000;
// A persistent status lives until its session ends; this only bounds leaks.
const STATUS_MAX_LIFETIME: u64 = 600_000;
const MAX_MESSAGE_CHARS: usize = 80;
static CREATION: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

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
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Slot { Flash, Status }
impl Slot {
    fn index(self) -> usize { match self { Slot::Flash => 0, Slot::Status => 1 } }
    fn max_lifetime(self) -> u64 { match self { Slot::Flash => MAX_LIFETIME, Slot::Status => STATUS_MAX_LIFETIME } }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Receipt {
    operation: String, revision: u64,
    #[serde(default, skip_serializing)]
    target: Option<String>,
}
impl Receipt {
    fn valid(&self) -> bool {
        let bytes = self.operation.as_bytes();
        let uuid = bytes.len() == 36 && bytes.iter().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) { *c == b'-' } else { c.is_ascii_hexdigit() }
        });
        uuid && self.target.as_ref().map_or(true, |token| token.len() == 16 && token.bytes().all(|c| c.is_ascii_hexdigit())) && self.revision <= 9_007_199_254_740_991
    }
}
/// Short single-line status copy; callers pass localized host text, never user content.
fn valid_text(text: Option<&String>) -> bool {
    text.map_or(true, |text| !text.trim().is_empty() && text.chars().count() <= MAX_MESSAGE_CHARS && !text.chars().any(char::is_control))
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Snapshot {
    id: String,
    slot: Slot,
    level: Level,
    message: Option<String>,
    detail: Option<String>,
    expires_at: u64,
    locale: Locale,
    theme: Theme,
    progress: Option<Progress>,
    receipt: Option<Receipt>,
}
#[derive(Clone, Debug, Serialize)]
pub(crate) struct HudUpdate { revision: u64, toasts: Vec<Snapshot> }
#[derive(Clone)]
struct Pending { owner: String, sequence: u64, snapshot: Snapshot, target: Option<PlacementTarget> }
#[derive(Clone)]
struct PlacementTarget {
    #[cfg(target_os = "linux")]
    window: std::sync::Arc<super::linux_x11_paste::PasteTarget>,
    until: Instant,
}
struct TargetTicket { owner: String, operation: String, target: PlacementTarget }
fn target_tickets() -> &'static Mutex<HashMap<String, TargetTicket>> {
    static TICKETS: OnceLock<Mutex<HashMap<String, TargetTicket>>> = OnceLock::new();
    TICKETS.get_or_init(|| Mutex::new(HashMap::new()))
}
/// Only the current material's remembered target or a live queue attempt may
/// produce a ticket. No caller-selected XID, title, application or coordinates.
#[tauri::command]
pub(crate) async fn capture_hud_target(window: tauri::WebviewWindow, operation: String, attempt_id: Option<String>, background_action: Option<String>) -> Option<String> {
    if window.label() != "launcher" || !(Receipt { operation: operation.clone(), revision: 0, target: None }).valid() { return None; }
    #[cfg(target_os = "linux")]
    {
        let surface = if background_action.as_deref() == Some("image-save-shortcut") {
            if attempt_id.is_some() || window.is_visible().ok()? || window.is_focused().ok()? { return None; }
            // This exact background action captures only the currently focused,
            // confirmed-external X11 window; failure replaces any stale target.
            super::linux_x11_paste::remember_target("image-save-shortcut", false);
            "image-save-shortcut"
        } else if background_action.is_some() {
            return None;
        } else if let Some(id) = attempt_id {
            super::paste_recovery::current("launcher", &id).ok()?.ensure_active().ok()?;
            if window.is_visible().ok()? { return None; }
            "history-paste-queue"
        } else {
            if !window.is_visible().ok()? || !window.is_focused().ok()? { return None; }
            "launcher"
        };
        let captured = super::linux_x11_paste::snapshot(surface).ok()?;
        super::linux_x11_paste::hud_target_rect(&captured)?;
        let target = PlacementTarget { window: captured, until: Instant::now() + Duration::from_secs(30) };
        let mut tickets = target_tickets().lock().ok()?;
        tickets.retain(|_, ticket| ticket.target.until > Instant::now());
        if tickets.len() >= 64 { return None; }
        static SERIAL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        let token = format!("{:016x}", SERIAL.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
        tickets.insert(token.clone(), TargetTicket { owner: window.label().into(), operation, target });
        drop(tickets);
        let expiry_token = token.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(30)).await;
            if let Ok(mut tickets) = target_tickets().lock() { tickets.remove(&expiry_token); }
        });
        Some(token)
    }
    #[cfg(not(target_os = "linux"))]
    { let _ = (attempt_id, background_action); None }
}
fn take_target(owner: &str, receipt: Option<&Receipt>) -> Option<PlacementTarget> {
    let receipt = receipt?;
    let token = receipt.target.as_ref()?;
    let mut tickets = target_tickets().lock().ok()?;
    let ticket = tickets.get(token)?;
    if ticket.owner != owner || ticket.operation != receipt.operation { return None; }
    let ticket = tickets.remove(token)?;
    (ticket.target.until > Instant::now()).then_some(ticket.target)
}
#[cfg(any(target_os = "linux", test))]
fn intersection_area(a: (i32, i32, u32, u32), b: (i32, i32, u32, u32)) -> i64 {
    let width = (i64::from(a.0) + i64::from(a.2)).min(i64::from(b.0) + i64::from(b.2)) - i64::from(a.0.max(b.0));
    let height = (i64::from(a.1) + i64::from(a.3)).min(i64::from(b.1) + i64::from(b.3)) - i64::from(a.1.max(b.1));
    width.max(0).saturating_mul(height.max(0))
}
fn target_monitor(window: &tauri::WebviewWindow, target: Option<&PlacementTarget>) -> Option<tauri::Monitor> {
    let target = target?;
    if target.until <= Instant::now() { return None; }
    #[cfg(target_os = "linux")]
    {
        let rect = super::linux_x11_paste::hud_target_rect(&target.window)?;
        window.available_monitors().ok()?.into_iter().filter_map(|monitor| {
            let p = monitor.position(); let size = monitor.size();
            let area = intersection_area(rect, (p.x, p.y, size.width, size.height));
            (area > 0).then_some((area, monitor))
        }).max_by_key(|(area, _)| *area).map(|(_, monitor)| monitor)
    }
    #[cfg(not(target_os = "linux"))]
    { let _ = window; None }
}
#[derive(Default)]
struct State {
    /// Indexed by `Slot::index`: at most one flash and one persistent status.
    slots: [Option<Pending>; 2],
    sequences: HashMap<String, u64>,
    dismissed: HashMap<String, HashSet<String>>,
    ready: bool,
    latest_sequence: u64,
    revision: u64,
    receipts: HashMap<(String, String), (u64, u64)>,
}
impl State {
    fn accept(&mut self, owner: &str, sequence: u64, id: &str, expires_at: u64, now: u64, slot: Slot) -> bool {
        if expires_at <= now || expires_at > now.saturating_add(slot.max_lifetime())
            || sequence < self.latest_sequence
            || sequence <= *self.sequences.get(owner).unwrap_or(&0)
            || self.dismissed.get(owner).is_some_and(|ids| ids.contains(id)) {
            return false;
        }
        self.latest_sequence = sequence;
        self.sequences.insert(owner.into(), sequence);
        true
    }
    fn accept_receipt(&mut self, owner: &str, receipt: Option<&Receipt>, now: u64) -> bool {
        self.receipts.retain(|_, (_, until)| *until > now);
        let Some(receipt) = receipt else { return true; };
        let key = (owner.to_owned(), receipt.operation.clone());
        if self.receipts.get(&key).is_some_and(|(revision, _)| receipt.revision <= *revision) { return false; }
        // Bound metadata without discarding live anti-replay entries.
        if !self.receipts.contains_key(&key) && self.receipts.len() >= 256 { return false; }
        self.receipts.insert(key, (receipt.revision, now.saturating_add(STATUS_MAX_LIFETIME)));
        true
    }
    /// A visible failure flash survives an unrelated success flash.
    fn protects_failure(&self, owner: &str, receipt: Option<&Receipt>, level: &Level, now: u64) -> bool {
        self.slots[Slot::Flash.index()].as_ref().is_some_and(|pending| {
            let same_operation = pending.owner == owner && pending.snapshot.receipt.as_ref().zip(receipt)
                .is_some_and(|(old, new)| old.operation == new.operation);
            pending.snapshot.expires_at > now && matches!(pending.snapshot.level, Level::Error)
                && !matches!(level, Level::Error) && !same_operation
        })
    }
    fn cancel(&mut self, owner: &str, id: &str) -> bool {
        // Bounded per-owner tombstones cover dismiss-before-route races.
        let ids = self.dismissed.entry(owner.into()).or_default();
        if ids.len() >= 256 {
            ids.clear();
            self.sequences.insert(owner.into(), now().saturating_mul(1000).saturating_add(999));
        }
        ids.insert(id.into());
        let mut matches = false;
        for slot in self.slots.iter_mut() {
            if slot.as_ref().is_some_and(|p| p.owner == owner && p.snapshot.id == id) { *slot = None; matches = true; }
        }
        matches
    }
    fn is_empty(&self) -> bool { self.slots.iter().all(Option::is_none) }
    /// Render order: the flash stacks above the persistent status.
    fn visible(&self) -> Vec<Snapshot> { self.slots.iter().flatten().map(|p| p.snapshot.clone()).collect() }
}
fn registry() -> &'static Mutex<State> { static STATE: OnceLock<Mutex<State>> = OnceLock::new(); STATE.get_or_init(|| Mutex::new(State::default())) }
// Fixed lifecycle stages only: no owner labels, ids, bodies, paths, or credentials.
fn trace(stage: &'static str) { super::log_launcher_perf("native:hud.lifecycle", Instant::now(), stage); }
fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }
fn surface(label: &str) -> bool { label == "launcher" || label == "main" || label == "quick-editor" || label.starts_with("plugin-surface:") || label.starts_with("editor:") }
// Own key windows take precedence over OS frontmost app (macOS non-activating panels).
// Err is unknown, never evidence that an external app owns the keyboard.
fn foreground_target(app: &tauri::AppHandle, owner: &str) -> Result<Option<String>, ()> {
    let windows = app.webview_windows();
    let mut focused = Vec::new();
    let mut unknown = false;
    for (label, window) in &windows {
        if !surface(label) { continue; }
        match window.is_visible() {
            Ok(false) => continue,
            Err(_) => { unknown = true; continue; },
            Ok(true) => {},
        }
        match window.is_focused() {
            Ok(true) => focused.push(label.clone()),
            Ok(false) => {},
            Err(_) => unknown = true,
        }
    }
    focused.sort_by_key(|label| (label != owner, label.clone()));
    if let Some(label) = focused.first() { return Ok(Some(label.clone())); }
    if unknown { return Err(()); }
    if external_foreground() == Some(true) { Ok(None) } else { Err(()) }
}
#[cfg(target_os = "linux")]
fn external_foreground() -> Option<bool> { super::linux_x11_windows::foreground_is_external() }
#[cfg(target_os = "macos")]
fn external_foreground() -> Option<bool> {
    super::current_foreground_process_id().filter(|pid| *pid != 0).map(|pid| pid != std::process::id())
}
#[cfg(target_os = "windows")]
fn external_foreground() -> Option<bool> {
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
    unsafe {
        let window = GetForegroundWindow();
        if window.0.is_null() { return None; }
        let mut pid = 0;
        GetWindowThreadProcessId(window, Some(&mut pid));
        (pid != 0).then_some(pid != std::process::id())
    }
}
#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn external_foreground() -> Option<bool> { None }

fn hide(app: &tauri::AppHandle) {
    trace("hide-enter");
    let update = {
        let Ok(mut state) = registry().lock() else { return };
        state.revision = state.revision.saturating_add(1);
        HudUpdate { revision: state.revision, toasts: Vec::new() }
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
    Ok(HudUpdate { revision: state.revision, toasts: state.visible() })
}
/// Logical card height; a detail, progress or generic "review" line adds a second row.
fn card_height(snapshot: &Snapshot) -> f64 {
    if snapshot.message.is_none() || snapshot.detail.is_some() || snapshot.progress.is_some() { 72.0 } else { 52.0 }
}
/// Render whatever slots remain valid; hides the window when none do.
fn show_current(app: &tauri::AppHandle) -> Result<HudUpdate, String> {
    trace("show-enter");
    // Never hold our state mutex across a Tauri/GTK call. Synchronous window
    // queries may reenter the event loop and owner/window lifecycle callbacks.
    let slots = { registry().lock().map_err(|_| "hud-unavailable")?.slots.clone() };
    if slots.iter().all(Option::is_none) { hide(app); return current_update(); }
    trace("show-visible-query-enter");
    let valid: Vec<bool> = slots.iter().map(|slot| slot.as_ref().map_or(true, |pending| {
        pending.snapshot.expires_at > now() && matches!(foreground_target(app, &pending.owner), Ok(None))
    })).collect();
    trace("show-visible-query-returned");
    let (update, ready, target) = {
        let mut state = registry().lock().map_err(|_| "hud-unavailable")?;
        for (index, expected) in slots.iter().enumerate() {
            if let Some(expected) = expected {
                if !valid[index] && same_pending(state.slots[index].as_ref(), expected) {
                    state.slots[index] = None;
                    state.revision = state.revision.saturating_add(1);
                }
            }
        }
        if state.is_empty() { drop(state); hide(app); return current_update(); }
        let target = state.slots.iter().flatten().find_map(|p| p.target.clone());
        (HudUpdate { revision: state.revision, toasts: state.visible() }, state.ready, target)
    };
    if !ready { return Ok(update); }
    let window = app.get_webview_window(LABEL).ok_or("hud-unavailable")?;
    trace("show-position-enter");
    if let Some(monitor) = target_monitor(&window, target.as_ref()).or_else(|| super::monitor_under_cursor(&window)).or_else(|| window.primary_monitor().ok().flatten()) {
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        let width = (360.0 * scale).min(area.size.width as f64).max(1.0);
        // Stacked cards plus an 8px gap and the transparent antialiasing edge.
        let cards: f64 = update.toasts.iter().map(card_height).sum();
        let logical_height = cards + 8.0 * (update.toasts.len().saturating_sub(1)) as f64 + 4.0;
        let height = (logical_height * scale).min(area.size.height as f64).max(1.0);
        let x = area.position.x as f64 + (area.size.width as f64 - width) / 2.0;
        let y = area.position.y as f64 + (area.size.height as f64 - height - 32.0 * scale).max(0.0);
        // GTK recomputes a non-resizable window's natural size after its menu
        // is destroyed. Pin its widget request too, otherwise it can map at
        // WebKit's 200px natural height despite the requested native size.
        #[cfg(target_os = "linux")]
        {
            use gtk::prelude::WidgetExt;
            window.gtk_window().map_err(|_| "hud-unavailable")?
                .set_size_request((width / scale) as i32, (height / scale) as i32);
        }
        window.set_size(tauri::PhysicalSize::new(width as u32, height as u32)).map_err(|_| "hud-unavailable")?;
        window.set_position(tauri::PhysicalPosition::new(x as i32, y as i32)).map_err(|_| "hud-unavailable")?;
    }
    trace("show-position-returned");
    if registry().lock().map_err(|_| "hud-unavailable")?.is_empty() { return current_update(); }
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
        .title("Hiven").inner_size(360.0, 84.0).decorations(false).transparent(true)
        .shadow(false).resizable(false).visible(false).focused(false).focusable(false)
        .always_on_top(true).skip_taskbar(true).build().map_err(|_| "hud-unavailable")?;
    // The global Edit menu belongs to editable windows, not this passive HUD.
    // Remove only this hidden window's inherited menu before its first map.
    // macOS menus are app-wide: never remove or replace the application's menu.
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    window.remove_menu().map_err(|_| "hud-unavailable")?;
    // Deliberately no paste recovery registration, foreground capture, or
    // launcher focus/blur handlers: this window is never a user input target.
    window.on_window_event(|event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            if let Ok(mut state) = registry().lock() { state.ready = false; state.slots = [None, None]; }
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
fn spawn_pending_monitor(app: tauri::AppHandle, slot: Slot, owner: String, sequence: u64, id: String) {
    tauri::async_runtime::spawn(async move {
        let mut first_poll = true;
        loop {
            tokio::time::sleep(Duration::from_millis(100)).await;
            let timer_owner = owner.clone();
            let timer_id = id.clone();
            let log_poll = first_poll;
            first_poll = false;
            let result = ui(app.clone(), move |app| {
                if log_poll { trace("poll-first-enter"); }
                let pending = { registry().lock().map_err(|_| "hud-unavailable")?.slots[slot.index()].clone() };
                let Some(pending) = pending.filter(|p| p.sequence == sequence && p.owner == timer_owner && p.snapshot.id == timer_id) else { return Ok(false); };
                let expired = pending.snapshot.expires_at <= now() || !matches!(foreground_target(app, &pending.owner), Ok(None));
                if expired {
                    {
                        let mut state = registry().lock().map_err(|_| "hud-unavailable")?;
                        if !same_pending(state.slots[slot.index()].as_ref(), &pending) { return Ok(false); }
                        state.slots[slot.index()] = None;
                        state.revision = state.revision.saturating_add(1);
                    }
                    // The other slot, if any, stays on screen at its own size.
                    show_current(app)?;
                    return Ok(false);
                }
                if log_poll { trace("poll-first-returned"); }
                Ok(true)
            }).await;
            if result != Ok(true) { break; }
        }
    });
}
#[tauri::command]
pub(crate) async fn route_toast(app: tauri::AppHandle, window: tauri::WebviewWindow, id: String, sequence: u64, level: Level, expires_at: u64, locale: Locale, theme: Theme, progress: Option<Progress>, receipt: Option<Receipt>, slot: Option<Slot>, message: Option<String>, detail: Option<String>) -> Result<Option<String>, String> {
    trace("route-enter");
    let owner = window.label().to_owned();
    let slot = slot.unwrap_or(Slot::Flash);
    if receipt.as_ref().is_some_and(|r| !r.valid()) || !surface(&owner) || id.is_empty() || id.len() > 160
        || !valid_text(message.as_ref()) || !valid_text(detail.as_ref()) || (detail.is_some() && message.is_none())
        || progress.as_ref().is_some_and(|p| !(1..=20).contains(&p.total) || p.completed > p.total) { return Err("hud-unavailable".into()); }
    let timer_owner = owner.clone();
    let timer_id = id.clone();
    let (target, needs_hud) = ui(app.clone(), move |app| {
        trace("route-ui-enter");
        let mut state = registry().lock().map_err(|_| "hud-unavailable")?;
        if !state.accept(&owner, sequence, &id, expires_at, now(), slot) { return Ok((None, false)); }
        if !state.accept_receipt(&owner, receipt.as_ref(), now()) { return Ok((None, false)); }
        if slot == Slot::Flash && state.protects_failure(&owner, receipt.as_ref(), &level, now()) { return Ok((None, false)); }
        let snapshot = Snapshot { id, slot, level, message, detail, expires_at, locale, theme, progress, receipt };
        let replacing = state.slots[slot.index()].is_some();
        state.slots[slot.index()] = None;
        let empty = state.is_empty();
        drop(state);
        trace("route-ui-accepted");
        trace("route-visible-query-enter");
        match foreground_target(app, &owner) {
            Ok(Some(target)) => { if empty { hide(app); } trace("route-visible-target"); return Ok((Some(target), false)); },
            Err(()) => { if empty { hide(app); } return Ok((None, false)); },
            Ok(None) => {},
        }
        // Updating a visible card must not unmap/remap the window between receipts.
        if !replacing && empty { hide(app); }
        trace("route-visible-query-returned");
        {
            let mut state = registry().lock().map_err(|_| "hud-unavailable")?;
            state.revision = state.revision.saturating_add(1);
            state.slots[slot.index()] = Some(Pending { target: take_target(&owner, snapshot.receipt.as_ref()), owner, sequence, snapshot });
        }
        Ok((None, true))
    }).await?;
    if !needs_hud { return Ok(target); }

    // On Linux WebviewWindowBuilder synchronously waits for webview creation
    // dispatched to the UI loop. Calling it inside run_on_main_thread deadlocks
    // that loop. Serialize lazy creation on this async command's worker instead.
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
            state.slots[slot.index()].as_ref().is_some_and(|p| p.sequence == sequence && p.owner == show_owner && p.snapshot.id == show_id)
        };
        if current { show_current(app)?; }
        Ok(current)
    }).await?;
    if !current { return Ok(None); }
    trace("route-returned");
    spawn_pending_monitor(app, slot, timer_owner, sequence, timer_id);
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
        if cancelled { show_current(app)?; }
        Ok(())
    }).await
}
pub(crate) fn invalidate_owner(app: &tauri::AppHandle, owner: &str) {
    if let Ok(mut tickets) = target_tickets().lock() { tickets.retain(|_, ticket| ticket.owner != owner); }
    let cleared = {
        let Ok(mut state) = registry().lock() else { return };
        state.sequences.insert(owner.into(), now().saturating_mul(1000).saturating_add(999));
        let mut cleared = false;
        for slot in state.slots.iter_mut() {
            if slot.as_ref().is_some_and(|p| p.owner == owner) { *slot = None; cleared = true; }
        }
        cleared
    };
    if cleared { let _ = show_current(app); }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn snapshot(id: &str, slot: Slot, level: Level, receipt: Option<Receipt>) -> Snapshot {
        Snapshot { id: id.into(), slot, level, message: None, detail: None, expires_at: 1000, locale: Locale::En, theme: Theme::Dark, progress: None, receipt }
    }
    fn pending(owner: &str, sequence: u64, snapshot: Snapshot) -> Option<Pending> {
        Some(Pending { owner: owner.into(), sequence, target: None, snapshot })
    }
    #[test]
    fn rejects_expired_out_of_order_and_dismissed_receipts() {
        let mut s = State::default();
        assert!(s.accept("launcher", 10, "a", 200, 100, Slot::Flash));
        assert!(!s.accept("launcher", 9, "old", 200, 100, Slot::Flash));
        assert!(!s.accept("launcher", 11, "expired", 100, 100, Slot::Flash));
        assert!(!s.accept("launcher", 11, "unbounded", 20_000, 100, Slot::Flash));
        s.cancel("launcher", "cancelled");
        assert!(!s.accept("launcher", 11, "cancelled", 200, 100, Slot::Flash));
        assert!(!s.accept("editor:1", 1, "late-owner", 200, 100, Slot::Flash));
        assert!(s.accept("editor:1", 12, "cancelled", 200, 100, Slot::Flash));
    }
    #[test]
    fn status_outlives_flash_bound_but_stays_bounded() {
        let mut s = State::default();
        assert!(s.accept("main", 1, "queue", 100 + 300_000, 100, Slot::Status));
        assert!(!s.accept("main", 2, "flash", 100 + 300_000, 100, Slot::Flash));
        assert!(!s.accept("main", 3, "queue", 100 + STATUS_MAX_LIFETIME + 1, 100, Slot::Status));
        assert!(s.accept("main", 4, "queue", 200, 100, Slot::Status), "same id updates the status");
    }
    #[test]
    fn dismissal_is_owner_and_id_scoped_per_slot() {
        let mut s = State::default();
        s.slots[Slot::Flash.index()] = pending("launcher", 12, snapshot("new", Slot::Flash, Level::Success, None));
        s.slots[Slot::Status.index()] = pending("main", 13, snapshot("queue", Slot::Status, Level::Info, None));
        assert_eq!(s.visible().iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), ["new", "queue"], "flash stacks above status");
        assert!(!s.cancel("launcher", "old"));
        assert!(!s.cancel("editor:1", "new"));
        assert!(s.cancel("launcher", "new"));
        assert!(s.slots[Slot::Flash.index()].is_none());
        assert!(s.slots[Slot::Status.index()].is_some(), "ending a flash keeps the status");
        assert!(s.cancel("main", "queue"));
        assert!(s.is_empty());
    }
    fn receipt(revision: u64) -> Receipt {
        Receipt { operation: "00000000-0000-4000-8000-000000000000".into(), revision, target: None }
    }
    #[test]
    fn receipts_are_bounded_fixed_and_monotonic() {
        let mut state = State::default();
        let first = receipt(1);
        assert!(first.valid());
        assert!(serde_json::from_str::<Receipt>(r#"{"operation":"path","revision":1,"result":"private-text"}"#).is_err());
        assert!(!Receipt { operation: "/private/path".into(), ..first.clone() }.valid());
        assert!(state.accept_receipt("launcher", Some(&first), 100));
        assert!(!state.accept_receipt("launcher", Some(&first), 101));
        assert!(state.accept_receipt("launcher", Some(&receipt(2)), 102));
        assert!(!state.accept_receipt("launcher", Some(&first), 103));
    }
    #[test]
    fn status_text_is_short_single_line() {
        assert!(valid_text(None));
        assert!(valid_text(Some(&"已复制".into())));
        assert!(!valid_text(Some(&"  ".into())));
        assert!(!valid_text(Some(&"line\nbreak".to_string())));
        assert!(!valid_text(Some(&"x".repeat(MAX_MESSAGE_CHARS + 1))));
    }
    #[test]
    fn failure_survives_unrelated_success_but_retry_can_resolve_it() {
        let mut state = State::default();
        state.slots[Slot::Flash.index()] = pending("launcher", 1, snapshot("notice", Slot::Flash, Level::Error, Some(receipt(1))));
        assert!(state.protects_failure("launcher", None, &Level::Success, 100));
        assert!(state.protects_failure("editor:1", Some(&receipt(2)), &Level::Success, 100));
        assert!(!state.protects_failure("launcher", Some(&receipt(2)), &Level::Success, 100));
        assert!(!state.protects_failure("launcher", None, &Level::Success, 1000));
    }
    #[test]
    fn target_overlap_handles_negative_coordinates_and_disjoint_screens() {
        assert_eq!(intersection_area((-900, 100, 800, 500), (-1280, 0, 1280, 900)), 400_000);
        assert_eq!(intersection_area((1400, 100, 800, 500), (0, 0, 1280, 900)), 0);
        assert_eq!(intersection_area((1200, 100, 800, 500), (1280, 0, 1024, 768)), 360_000);
        assert_eq!(intersection_area((0, 0, u32::MAX, u32::MAX), (0, 0, u32::MAX, u32::MAX)), i64::MAX);
        let target = Receipt { target: Some("0000000000000001".into()), ..receipt(1) };
        assert!(target.valid());
        assert!(!serde_json::to_string(&target).unwrap().contains("target"));
        assert!(!Receipt { target: Some("arbitrary-window".into()), ..target }.valid());
    }
    #[test]
    fn hud_is_not_an_eligible_surface() { assert!(!surface(LABEL)); assert!(surface("launcher")); assert!(surface("plugin-surface:builtin:x:y")); }
}
