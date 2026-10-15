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
const SUCCESS_MIN_VISIBLE: Duration = Duration::from_secs(1);
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
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ResultKind { Copied, Pasted, CopyFailed, PasteFailed, CopiedPasteFailed, QueueReady, QueuePasted, QueueFailed, ImageSaved, ImageSavedPathFailed, ImageSaveFailed, ImageSaveCancelled, CountdownExpired }
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Receipt {
    operation: String, revision: u64, result: ResultKind,
    #[serde(default, skip_serializing)]
    target: Option<String>,
}
impl Receipt {
    fn valid(&self, level: &Level) -> bool {
        let bytes = self.operation.as_bytes();
        let uuid = bytes.len() == 36 && bytes.iter().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) { *c == b'-' } else { c.is_ascii_hexdigit() }
        });
        uuid && self.target.as_ref().map_or(true, |token| token.len() == 16 && token.bytes().all(|c| c.is_ascii_hexdigit())) && self.revision <= 9_007_199_254_740_991 && match self.result {
            ResultKind::Copied | ResultKind::Pasted | ResultKind::QueuePasted | ResultKind::ImageSaved => matches!(level, Level::Success),
            ResultKind::QueueReady | ResultKind::ImageSaveCancelled | ResultKind::CountdownExpired => matches!(level, Level::Info),
            _ => matches!(level, Level::Error),
        }
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Snapshot {
    id: String,
    level: Level,
    expires_at: u64,
    locale: Locale,
    theme: Theme,
    progress: Option<Progress>,
    receipt: Option<Receipt>,
}
#[derive(Clone, Debug, Serialize)]
pub(crate) struct HudUpdate { revision: u64, toast: Option<Snapshot> }
#[derive(Clone)]
struct Pending { owner: String, sequence: u64, snapshot: Snapshot, target: Option<PlacementTarget>, visible_since: Option<Instant> }
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
pub(crate) async fn capture_hud_target(window: tauri::WebviewWindow, operation: String, attempt_id: Option<String>) -> Option<String> {
    if window.label() != "launcher" || !(Receipt { operation: operation.clone(), revision: 0, result: ResultKind::Copied, target: None }).valid(&Level::Success) { return None; }
    #[cfg(target_os = "linux")]
    {
        let surface = if let Some(id) = attempt_id {
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
    { let _ = attempt_id; None }
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
    pending: Option<Pending>,
    deferred_passive: Option<Pending>,
    sequences: HashMap<String, u64>,
    dismissed: HashMap<String, HashSet<String>>,
    ready: bool,
    latest_sequence: u64,
    revision: u64,
    receipts: HashMap<(String, String), (u64, u64)>,
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
    fn accept_receipt(&mut self, owner: &str, receipt: Option<&Receipt>, now: u64) -> bool {
        self.receipts.retain(|_, (_, until)| *until > now);
        let Some(receipt) = receipt else { return true; };
        let key = (owner.to_owned(), receipt.operation.clone());
        if self.receipts.get(&key).is_some_and(|(revision, _)| receipt.revision <= *revision) { return false; }
        // Bound metadata without discarding live anti-replay entries.
        if !self.receipts.contains_key(&key) && self.receipts.len() >= 256 { return false; }
        self.receipts.insert(key, (receipt.revision, now.saturating_add(MAX_LIFETIME)));
        true
    }
    fn protects_failure(&self, owner: &str, receipt: Option<&Receipt>, level: &Level, now: u64) -> bool {
        self.pending.as_ref().is_some_and(|pending| {
            let same_operation = pending.owner == owner && pending.snapshot.receipt.as_ref().zip(receipt)
                .is_some_and(|(old, new)| old.operation == new.operation);
            pending.snapshot.expires_at > now && matches!(pending.snapshot.level, Level::Error)
                && !matches!(level, Level::Error) && !same_operation
        })
    }
    fn passive_delay(&self, incoming: &Snapshot, now: Instant) -> Option<Duration> {
        if !is_passive_info(incoming) { return None; }
        let current = self.pending.as_ref()?;
        if !is_user_success(&current.snapshot) { return None; }
        Some(current.visible_since.and_then(|shown| SUCCESS_MIN_VISIBLE.checked_sub(now.saturating_duration_since(shown))).unwrap_or(SUCCESS_MIN_VISIBLE))
    }
    fn promote_deferred(&mut self, owner: &str, sequence: u64, id: &str, wall_now: u64, instant_now: Instant) -> Option<Pending> {
        let matches = self.deferred_passive.as_ref().is_some_and(|pending| pending.owner == owner && pending.sequence == sequence && pending.snapshot.id == id);
        if !matches { return None; }
        if self.deferred_passive.as_ref().is_some_and(|pending| pending.snapshot.expires_at <= wall_now) {
            self.deferred_passive = None;
            return None;
        }
        let Some(current) = self.pending.as_ref() else { self.deferred_passive = None; return None; };
        if !is_user_success(&current.snapshot) || current.visible_since.is_none_or(|shown| instant_now.saturating_duration_since(shown) < SUCCESS_MIN_VISIBLE) {
            return None;
        }
        let mut next = self.deferred_passive.take()?;
        next.visible_since = Some(instant_now);
        self.pending = Some(next.clone());
        self.revision = self.revision.saturating_add(1);
        Some(next)
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
        let deferred = self.deferred_passive.as_ref().is_some_and(|p| p.owner == owner && p.snapshot.id == id);
        if deferred { self.deferred_passive = None; }
        matches || deferred
    }
}
fn is_user_success(snapshot: &Snapshot) -> bool {
    matches!(snapshot.level, Level::Success) && snapshot.receipt.as_ref().is_some_and(|receipt| matches!(receipt.result,
        ResultKind::Copied | ResultKind::Pasted | ResultKind::QueuePasted | ResultKind::ImageSaved))
}
fn is_passive_info(snapshot: &Snapshot) -> bool {
    matches!(snapshot.level, Level::Info) && snapshot.receipt.as_ref().is_some_and(|receipt| receipt.result == ResultKind::CountdownExpired)
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
    let valid = pending.snapshot.expires_at > now() && matches!(foreground_target(app, &pending.owner), Ok(None));
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
    if let Some(monitor) = target_monitor(&window, pending.target.as_ref()).or_else(|| super::monitor_under_cursor(&window)).or_else(|| window.primary_monitor().ok().flatten()) {
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        let width = (360.0 * scale).min(area.size.width as f64).max(1.0);
        // Fixed-result cards reserve room for a two-line headline; queue cards
        // additionally reserve their progress line. Both include a transparent edge.
        let logical_height = if pending.snapshot.progress.is_some() { 104.0 } else { 84.0 };
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
    let current = { registry().lock().map_err(|_| "hud-unavailable")?.pending.as_ref().is_some_and(|p| same_pending(Some(p), &pending) && p.snapshot.expires_at > now()) };
    if !current { return current_update(); }
    trace("show-map-enter");
    window.emit(EVENT, &update).map_err(|_| "hud-unavailable")?;
    window.show().map_err(|_| "hud-unavailable")?;
    {
        let mut state = registry().lock().map_err(|_| "hud-unavailable")?;
        if same_pending(state.pending.as_ref(), &pending) {
            if let Some(current) = state.pending.as_mut() {
                current.visible_since.get_or_insert_with(Instant::now);
            }
        }
    }
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
            if let Ok(mut state) = registry().lock() { state.ready = false; state.pending = None; state.deferred_passive = None; }
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
fn spawn_pending_monitor(app: tauri::AppHandle, owner: String, sequence: u64, id: String, monotonic_until: Option<Instant>) {
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
                let pending = { registry().lock().map_err(|_| "hud-unavailable")?.pending.clone() };
                let Some(pending) = pending.filter(|p| p.sequence == sequence && p.owner == timer_owner && p.snapshot.id == timer_id) else { return Ok(false); };
                let expired = monotonic_until.is_some_and(|until| Instant::now() >= until) || pending.snapshot.expires_at <= now() || !matches!(foreground_target(app, &pending.owner), Ok(None));
                let cleared = {
                    let mut state = registry().lock().map_err(|_| "hud-unavailable")?;
                    if !same_pending(state.pending.as_ref(), &pending) { return Ok(false); }
                    if expired { state.pending = None; state.deferred_passive = None; }
                    expired
                };
                if cleared { hide(app); return Ok(false); }
                if log_poll { trace("poll-first-returned"); }
                Ok(true)
            }).await;
            if result != Ok(true) { break; }
        }
    });
}
fn schedule_deferred_passive(app: tauri::AppHandle, owner: String, sequence: u64, id: String, delay: Duration, monotonic_until: Option<Instant>) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(delay.saturating_add(Duration::from_millis(1))).await;
        let expected_owner = owner.clone();
        let expected_id = id.clone();
        let (shown, retry) = ui(app.clone(), move |app| {
            let next = {
                let mut state = registry().lock().map_err(|_| "hud-unavailable")?;
                if monotonic_until.is_some_and(|until| Instant::now() >= until) {
                    let matches = state.deferred_passive.as_ref().is_some_and(|pending| pending.owner == expected_owner && pending.sequence == sequence && pending.snapshot.id == expected_id);
                    if matches { state.deferred_passive = None; }
                    return Ok((false, None));
                }
                let Some(next) = state.promote_deferred(&expected_owner, sequence, &expected_id, now(), Instant::now()) else {
                    let retry = state.deferred_passive.as_ref().filter(|pending| pending.owner == expected_owner && pending.sequence == sequence && pending.snapshot.id == expected_id)
                        .and_then(|pending| state.passive_delay(&pending.snapshot, Instant::now()));
                    return Ok((false, retry));
                };
                next
            };
            show_current(app)?;
            Ok((same_pending(registry().lock().map_err(|_| "hud-unavailable")?.pending.as_ref(), &next), None))
        }).await.unwrap_or((false, None));
        if shown { spawn_pending_monitor(app, owner, sequence, id, monotonic_until); }
        else if let Some(retry) = retry { schedule_deferred_passive(app, owner, sequence, id, retry, monotonic_until); }
    });
}
#[tauri::command]
pub(crate) async fn route_toast(app: tauri::AppHandle, window: tauri::WebviewWindow, id: String, sequence: u64, level: Level, expires_at: u64, locale: Locale, theme: Theme, progress: Option<Progress>, receipt: Option<Receipt>) -> Result<Option<String>, String> {
    trace("route-enter");
    let owner = window.label().to_owned();
    if receipt.as_ref().is_some_and(|r| !r.valid(&level)) || !surface(&owner) || id.is_empty() || id.len() > 160 || progress.as_ref().is_some_and(|p| !(1..=20).contains(&p.total) || p.completed > p.total) { return Err("hud-unavailable".into()); }
    let timer_owner = owner.clone();
    let timer_id = id.clone();
    let (target, needs_hud, deferred_delay) = ui(app.clone(), move |app| {
        trace("route-ui-enter");
        let mut state = registry().lock().map_err(|_| "hud-unavailable")?;
        if !state.accept(&owner, sequence, &id, expires_at, now()) { return Ok((None, false, None)); }
        if !state.accept_receipt(&owner, receipt.as_ref(), now()) { return Ok((None, false, None)); }
        if state.protects_failure(&owner, receipt.as_ref(), &level, now()) { return Ok((None, false, None)); }
        let snapshot = Snapshot { id, level, expires_at, locale, theme, progress, receipt };
        if let Some(delay) = state.passive_delay(&snapshot, Instant::now()) {
            state.deferred_passive = Some(Pending { target: take_target(&owner, snapshot.receipt.as_ref()), owner, sequence, snapshot, visible_since: None });
            return Ok((None, false, Some(delay)));
        }
        // A newer explicit result supersedes the one waiting passive notice.
        state.deferred_passive = None;
        let replacing = state.pending.is_some();
        state.pending = None;
        drop(state);
        trace("route-ui-accepted");
        trace("route-visible-query-enter");
        match foreground_target(app, &owner) {
            Ok(Some(target)) => { hide(app); trace("route-visible-target"); return Ok((Some(target), false, None)); },
            Err(()) => { hide(app); return Ok((None, false, None)); },
            Ok(None) => {},
        }
        // Updating the single card must not unmap/remap it between receipts.
        if !replacing { hide(app); }
        trace("route-visible-query-returned");
        {
            let mut state = registry().lock().map_err(|_| "hud-unavailable")?;
            state.revision = state.revision.saturating_add(1);
            state.pending = Some(Pending { target: take_target(&owner, snapshot.receipt.as_ref()), owner, sequence, snapshot, visible_since: None });
        }
        Ok((None, true, None))
    }).await?;
    if let Some(delay) = deferred_delay {
        schedule_deferred_passive(app, timer_owner, sequence, timer_id, delay, None);
        return Ok(None);
    }
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
            state.pending.as_ref().is_some_and(|p| p.sequence == sequence && p.owner == show_owner && p.snapshot.id == show_id)
        };
        if current { show_current(app)?; }
        Ok(current)
    }).await?;
    if !current { return Ok(None); }
    trace("route-returned");
    spawn_pending_monitor(app, timer_owner, sequence, timer_id, None);
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
    if let Ok(mut tickets) = target_tickets().lock() { tickets.retain(|_, ticket| ticket.owner != owner); }
    let cleared = {
        let Ok(mut state) = registry().lock() else { return };
        state.sequences.insert(owner.into(), now().saturating_mul(1000).saturating_add(999));
        let current = state.pending.as_ref().is_some_and(|p| p.owner == owner);
        if current { state.pending = None; }
        let deferred = state.deferred_passive.as_ref().is_some_and(|p| p.owner == owner);
        if deferred { state.deferred_passive = None; }
        current || deferred
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
        s.pending = Some(Pending { owner: "launcher".into(), sequence: 12, target: None, visible_since: Some(Instant::now()), snapshot: Snapshot { id: "new".into(), level: Level::Success, expires_at: 200, locale: Locale::En, theme: Theme::Dark, progress: None, receipt: None } });
        assert!(!s.cancel("launcher", "old"));
        assert!(!s.cancel("editor:1", "new"));
        assert!(s.pending.is_some());
        assert!(s.cancel("launcher", "new"));
        assert!(s.pending.is_none());
    }
    fn receipt(revision: u64, result: ResultKind) -> Receipt {
        Receipt { operation: "00000000-0000-4000-8000-000000000000".into(), revision, result, target: None }
    }
    #[test]
    fn receipts_are_bounded_fixed_and_monotonic() {
        let mut state = State::default();
        let first = receipt(1, ResultKind::Copied);
        assert!(first.valid(&Level::Success));
        assert!(!first.valid(&Level::Error));
        assert!(serde_json::from_str::<Receipt>(r#"{"operation":"path","revision":1,"result":"private-text"}"#).is_err());
        assert!(!Receipt { operation: "/private/path".into(), ..first.clone() }.valid(&Level::Success));
        assert!(state.accept_receipt("launcher", Some(&first), 100));
        assert!(!state.accept_receipt("launcher", Some(&first), 101));
        assert!(state.accept_receipt("launcher", Some(&receipt(2, ResultKind::Copied)), 102));
        assert!(!state.accept_receipt("launcher", Some(&first), 103));
    }
    #[test]
    fn failure_survives_unrelated_success_but_retry_can_resolve_it() {
        let mut state = State::default();
        state.pending = Some(Pending { owner: "launcher".into(), sequence: 1, target: None, visible_since: Some(Instant::now()), snapshot: Snapshot {
            id: "notice".into(), level: Level::Error, expires_at: 1000, locale: Locale::En, theme: Theme::Dark,
            progress: None, receipt: Some(receipt(1, ResultKind::PasteFailed)),
        } });
        assert!(state.protects_failure("launcher", None, &Level::Success, 100));
        assert!(state.protects_failure("editor:1", Some(&receipt(2, ResultKind::Pasted)), &Level::Success, 100));
        assert!(!state.protects_failure("launcher", Some(&receipt(2, ResultKind::Pasted)), &Level::Success, 100));
        assert!(!state.protects_failure("launcher", None, &Level::Success, 1000));
    }
    fn snapshot(id: &str, level: Level, result: ResultKind, expires_at: u64) -> Snapshot {
        Snapshot { id: id.into(), level, expires_at, locale: Locale::En, theme: Theme::Dark, progress: None, receipt: Some(receipt(1, result)) }
    }
    fn pending(owner: &str, sequence: u64, snapshot: Snapshot, visible_since: Instant) -> Pending {
        Pending { owner: owner.into(), sequence, snapshot, target: None, visible_since: Some(visible_since) }
    }
    #[test]
    fn user_success_defers_only_latest_passive_info_until_readable() {
        let start = Instant::now();
        let mut state = State::default();
        state.pending = Some(pending("launcher", 1, snapshot("success", Level::Success, ResultKind::Copied, 10_000), start));
        let first = snapshot("passive-1", Level::Info, ResultKind::CountdownExpired, 10_000);
        let second = snapshot("passive-2", Level::Info, ResultKind::CountdownExpired, 10_000);
        assert_eq!(state.passive_delay(&first, start + Duration::from_millis(500)), Some(Duration::from_millis(500)));
        state.pending.as_mut().unwrap().visible_since = None;
        assert_eq!(state.passive_delay(&first, start + Duration::from_secs(5)), Some(SUCCESS_MIN_VISIBLE));
        state.pending.as_mut().unwrap().visible_since = Some(start);
        assert!(state.passive_delay(&snapshot("queue", Level::Info, ResultKind::QueueReady, 10_000), start + Duration::from_millis(500)).is_none());
        state.deferred_passive = Some(pending("short-countdown", 2, first, start));
        state.deferred_passive = Some(pending("short-countdown", 3, second, start));
        assert!(state.promote_deferred("short-countdown", 2, "passive-1", 1_000, start + SUCCESS_MIN_VISIBLE).is_none());
        let promoted = state.promote_deferred("short-countdown", 3, "passive-2", 1_000, start + SUCCESS_MIN_VISIBLE).unwrap();
        assert_eq!(promoted.snapshot.id, "passive-2");
        assert!(state.deferred_passive.is_none());
    }
    #[test]
    fn cancelled_or_superseded_deferred_info_cannot_reappear() {
        let start = Instant::now();
        let mut state = State::default();
        state.pending = Some(pending("launcher", 1, snapshot("success", Level::Success, ResultKind::Copied, 10_000), start));
        state.deferred_passive = Some(pending("launcher", 2, snapshot("passive", Level::Info, ResultKind::CountdownExpired, 10_000), start));
        assert!(state.cancel("launcher", "passive"));
        assert!(state.promote_deferred("launcher", 2, "passive", 1_000, start + SUCCESS_MIN_VISIBLE).is_none());
        state.deferred_passive = Some(pending("launcher", 3, snapshot("passive-2", Level::Info, ResultKind::CountdownExpired, 10_000), start));
        state.pending = Some(pending("launcher", 4, snapshot("new-success", Level::Success, ResultKind::Pasted, 10_000), start));
        state.deferred_passive = None;
        assert!(state.promote_deferred("launcher", 3, "passive-2", 1_000, start + SUCCESS_MIN_VISIBLE).is_none());
        state.pending.as_mut().unwrap().visible_since = None;
        state.deferred_passive = Some(pending("launcher", 5, snapshot("expired", Level::Info, ResultKind::CountdownExpired, 999), start));
        assert!(state.promote_deferred("launcher", 5, "expired", 1_000, start + SUCCESS_MIN_VISIBLE).is_none());
        assert!(state.deferred_passive.is_none());
    }
    #[test]
    fn target_overlap_handles_negative_coordinates_and_disjoint_screens() {
        assert_eq!(intersection_area((-900, 100, 800, 500), (-1280, 0, 1280, 900)), 400_000);
        assert_eq!(intersection_area((1400, 100, 800, 500), (0, 0, 1280, 900)), 0);
        assert_eq!(intersection_area((1200, 100, 800, 500), (1280, 0, 1024, 768)), 360_000);
        assert_eq!(intersection_area((0, 0, u32::MAX, u32::MAX), (0, 0, u32::MAX, u32::MAX)), i64::MAX);
        let target = Receipt { target: Some("0000000000000001".into()), ..receipt(1, ResultKind::Copied) };
        assert!(target.valid(&Level::Success));
        assert!(!serde_json::to_string(&target).unwrap().contains("target"));
        assert!(!Receipt { target: Some("arbitrary-window".into()), ..target }.valid(&Level::Success));
    }
    #[test]
    fn hud_is_not_an_eligible_surface() { assert!(!surface(LABEL)); assert!(surface("launcher")); assert!(surface("plugin-surface:builtin:x:y")); }
}

/// App-owned deadline receipt; no plugin text, external target or generic scheduling API.
pub(crate) async fn short_countdown_due(app: tauri::AppHandle, id: String) -> Result<(), String> {
    { let _guard = CREATION.lock().await; ensure_window(&app)?; }
    let shown_id = id.clone();
    let (shown, deferred) = ui(app.clone(), move |app| {
        if !matches!(foreground_target(app, "short-countdown"), Ok(None)) { return Ok((false, None)); }
        let Some((locale, theme)) = super::short_countdown::presentation(&shown_id) else { return Ok((false, None)); };
        let receipt = Receipt { operation: shown_id.clone(), revision: 1, result: ResultKind::CountdownExpired, target: None };
        let mut s = registry().lock().map_err(|_| "hud-unavailable")?;
        if s.protects_failure("short-countdown", Some(&receipt), &Level::Info, now()) { return Ok((false, None)); }
        let sequence = now().saturating_mul(1000).max(s.latest_sequence.saturating_add(1))
            .max(s.sequences.get("short-countdown").copied().unwrap_or(0).saturating_add(1));
        if !s.accept("short-countdown", sequence, &shown_id, now() + MAX_LIFETIME, now()) { return Ok((false, None)); }
        let snapshot = Snapshot { id: shown_id, level: Level::Info, expires_at: now() + MAX_LIFETIME, locale, theme, progress: None, receipt: Some(receipt) };
        if let Some(delay) = s.passive_delay(&snapshot, Instant::now()) {
            s.deferred_passive = Some(Pending { owner: "short-countdown".into(), sequence, target: None, snapshot, visible_since: None });
            return Ok((false, Some((sequence, delay))));
        }
        s.deferred_passive = None;
        s.revision = s.revision.saturating_add(1);
        s.pending = Some(Pending { owner: "short-countdown".into(), sequence, target: None, snapshot, visible_since: None });
        drop(s); show_current(app)?; Ok((true, Some((sequence, Duration::ZERO))))
    }).await?;
    let display_until = Instant::now() + Duration::from_millis(MAX_LIFETIME);
    if let Some((sequence, delay)) = deferred {
        if shown { spawn_pending_monitor(app, "short-countdown".into(), sequence, id, Some(display_until)); }
        else { schedule_deferred_passive(app, "short-countdown".into(), sequence, id, delay, Some(display_until)); }
    }
    Ok(())
}
