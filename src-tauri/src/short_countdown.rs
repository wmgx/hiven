//! One app-owned short countdown. No wall-clock deadline, user text or task queue.
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use crate::toast_hud::{Locale, Theme};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum Phase { Running, Expired, Cancelled, Interrupted }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Record { version: u8, id: String, seconds: u32, phase: Phase }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Snapshot { supported: bool, record: Option<Record>, remaining_seconds: u32, storage_error: bool }
struct State { record: Option<Record>, deadline: Option<u64>, loaded: bool, storage_error: bool, locale: Locale, theme: Theme }
impl Default for State {
    fn default() -> Self { Self { record: None, deadline: None, loaded: false, storage_error: false, locale: Locale::En, theme: Theme::Dark } }
}
fn state() -> &'static Mutex<State> { static STATE: OnceLock<Mutex<State>> = OnceLock::new(); STATE.get_or_init(|| Mutex::new(State::default())) }
fn wake() -> &'static tokio::sync::Notify { static WAKE: OnceLock<tokio::sync::Notify> = OnceLock::new(); WAKE.get_or_init(tokio::sync::Notify::new) }
fn elapsed_ms() -> Result<u64, String> {
    #[cfg(target_os = "linux")]
    {
        let mut value = libc::timespec { tv_sec: 0, tv_nsec: 0 };
        if unsafe { libc::clock_gettime(libc::CLOCK_BOOTTIME, &mut value) } == 0 && value.tv_sec >= 0 {
            return Ok(value.tv_sec as u64 * 1000 + value.tv_nsec as u64 / 1_000_000);
        }
    }
    Err("countdown-unavailable".into())
}
fn valid_id(id: &str) -> bool {
    id.len() == 36 && id.bytes().enumerate().all(|(i, c)| if [8,13,18,23].contains(&i) { c == b'-' } else { c.is_ascii_hexdigit() })
}
fn path() -> Result<std::path::PathBuf, String> { Ok(super::config_dir()?.join("short-countdown.json")) }
fn save(record: &Record) -> Result<(), String> {
    use std::io::Write;
    let path = path()?;
    let root = path.parent().ok_or("countdown-storage")?;
    std::fs::create_dir_all(root).map_err(|_| "countdown-storage")?;
    let mut file = tempfile::NamedTempFile::new_in(root).map_err(|_| "countdown-storage")?;
    file.write_all(&serde_json::to_vec(record).map_err(|_| "countdown-storage")?).map_err(|_| "countdown-storage")?;
    file.as_file().sync_all().map_err(|_| "countdown-storage")?;
    file.persist(&path).map_err(|_| "countdown-storage")?;
    Ok(())
}
fn recover(mut record: Record) -> Record { if record.phase == Phase::Running { record.phase = Phase::Interrupted; } record }
fn load(s: &mut State) -> Result<(), String> {
    if s.loaded { return Ok(()); }
    let path = path()?;
    match std::fs::metadata(&path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {},
        Err(_) => return Err("countdown-storage".into()),
        Ok(meta) => {
            if meta.len() > 1024 { return Err("countdown-storage".into()); }
            let data = std::fs::read(path).map_err(|_| "countdown-storage")?;
            let record: Record = serde_json::from_slice(&data).map_err(|_| "countdown-storage")?;
            if record.version != 1 || !valid_id(&record.id) || !(1..=3600).contains(&record.seconds) { return Err("countdown-storage".into()); }
            let was_running = record.phase == Phase::Running;
            let record = recover(record);
            if was_running { save(&record)?; }
            s.record = Some(record);
        }
    }
    s.loaded = true;
    Ok(())
}
fn due(record: Option<&Record>, deadline: Option<u64>, now: u64) -> bool { record.is_some_and(|r| r.phase == Phase::Running) && deadline.is_some_and(|d| now >= d) }
fn commit(s: &mut State, record: Record, deadline: Option<u64>, persist: impl FnOnce(&Record) -> Result<(), String>) -> Result<(), String> {
    persist(&record)?;
    s.record = Some(record); s.deadline = deadline; s.storage_error = false;
    Ok(())
}
fn begin(s: &mut State, id: String, seconds: u32, now: u64, persist: impl FnOnce(&Record) -> Result<(), String>) -> Result<bool, String> {
    if s.storage_error { return Err("countdown-storage".into()); }
    if s.record.as_ref().is_some_and(|r| r.phase == Phase::Running) { return Ok(false); }
    commit(s, Record { version: 1, id, seconds, phase: Phase::Running }, Some(now + seconds as u64 * 1000), persist)?;
    Ok(true)
}
fn cancel(s: &mut State, id: &str, persist: impl FnOnce(&Record) -> Result<(), String>) -> Result<bool, String> {
    let Some(record) = s.record.as_ref().filter(|r| r.id == id && r.phase == Phase::Running) else { return Ok(false); };
    if s.storage_error { return Err("countdown-storage".into()); }
    let mut next = record.clone(); next.phase = Phase::Cancelled;
    commit(s, next, None, persist)?;
    Ok(true)
}
fn presentable(s: &State, id: &str) -> bool { s.record.as_ref().is_some_and(|r| r.id == id && r.phase == Phase::Expired) && !s.storage_error }
fn advance(s: &mut State, now: u64) -> Option<String> {
    if !due(s.record.as_ref(), s.deadline, now) { return None; }
    let mut next = s.record.clone()?; next.phase = Phase::Expired;
    let id = next.id.clone();
    if commit(s, next, None, save).is_err() { s.storage_error = true; return None; }
    Some(id)
}
fn publish(app: &tauri::AppHandle, id: Option<String>) {
    if let Some(id) = id { let app = app.clone(); tauri::async_runtime::spawn(async move { let _ = super::toast_hud::short_countdown_due(app, id).await; }); }
}
fn snapshot(s: &State, now: u64) -> Snapshot {
    Snapshot { supported: elapsed_ms().is_ok(), record: s.record.clone(), remaining_seconds: s.deadline.map_or(0, |d| d.saturating_sub(now).div_ceil(1000) as u32), storage_error: s.storage_error }
}
// All state transitions and HUD publication checks run on the UI thread.
async fn ui<T: Send + 'static>(app: tauri::AppHandle, f: impl FnOnce(&tauri::AppHandle) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    let (tx, rx) = tokio::sync::oneshot::channel(); let handle = app.clone();
    app.run_on_main_thread(move || { let _ = tx.send(f(&handle)); }).map_err(|_| "countdown-unavailable")?;
    rx.await.map_err(|_| "countdown-unavailable")?
}
fn authorized(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "launcher" || !window.is_visible().unwrap_or(false) || !window.is_focused().unwrap_or(false) { return Err("countdown-unavailable".into()); }
    Ok(())
}
#[tauri::command]
pub(crate) async fn short_countdown_status(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<Snapshot, String> {
    if window.label() != "launcher" { return Err("countdown-unavailable".into()); }
    ui(app, |app| {
        let mut s = state().lock().map_err(|_| "countdown-unavailable")?; load(&mut s)?;
        let now = elapsed_ms().unwrap_or(0); let id = advance(&mut s, now);
        let result = snapshot(&s, now); drop(s); publish(app, id); Ok(result)
    }).await
}
#[tauri::command]
pub(crate) async fn short_countdown_start(app: tauri::AppHandle, window: tauri::WebviewWindow, id: String, seconds: u32) -> Result<Snapshot, String> {
    ui(app, move |app| {
        authorized(&window)?;
        if !valid_id(&id) || !(1..=3600).contains(&seconds) { return Err("countdown-unavailable".into()); }
        let now = elapsed_ms()?; let mut s = state().lock().map_err(|_| "countdown-unavailable")?; load(&mut s)?;
        let expired = advance(&mut s, now);
        let started = begin(&mut s, id, seconds, now, save)?;
        let result = snapshot(&s, now); drop(s);
        if started { wake().notify_one(); super::toast_hud::invalidate_owner(app, "short-countdown"); }
        else { publish(app, expired); }
        Ok(result)
    }).await
}
#[tauri::command]
pub(crate) async fn short_countdown_cancel(app: tauri::AppHandle, window: tauri::WebviewWindow, id: String) -> Result<Snapshot, String> {
    ui(app, move |app| {
        authorized(&window)?;
        let now = elapsed_ms()?; let mut s = state().lock().map_err(|_| "countdown-unavailable")?; load(&mut s)?;
        let expired = advance(&mut s, now);
        let cancelled = cancel(&mut s, &id, save)?;
        let result = snapshot(&s, now); drop(s);
        if cancelled { super::toast_hud::invalidate_owner(app, "short-countdown"); }
        publish(app, expired); Ok(result)
    }).await
}
#[tauri::command]
pub(crate) fn short_countdown_context(window: tauri::WebviewWindow, locale: Locale, theme: Theme) {
    if window.label() == "launcher" { if let Ok(mut s) = state().lock() { s.locale = locale; s.theme = theme; } }
}
pub(crate) fn presentation(id: &str) -> Option<(Locale, Theme)> {
    let s = state().lock().ok()?;
    presentable(&s, id).then(|| (s.locale.clone(), s.theme.clone()))
}
pub(crate) fn interrupt() {
    if let Ok(mut s) = state().lock() {
        if let Some(record) = s.record.as_ref().filter(|r| r.phase == Phase::Running) {
            let next = recover(record.clone());
            // A failed exit write still leaves running on disk, recovered as interrupted next launch.
            let _ = save(&next); s.record = Some(next); s.deadline = None;
        }
    }
}
pub(crate) fn start(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let notified = wake().notified();
            let pending = ui(app.clone(), |_| {
                let mut s = state().lock().map_err(|_| "countdown-unavailable")?;
                load(&mut s)?;
                let now = elapsed_ms()?;
                let id = advance(&mut s, now);
                Ok((id, s.record.as_ref().is_some_and(|r| r.phase == Phase::Running)))
            }).await;
            let (id, running) = pending.unwrap_or((None, false));
            if let Some(id) = id { let _ = super::toast_hud::short_countdown_due(app.clone(), id).await; }
            // Idle/terminal countdowns do not keep waking the app's UI thread.
            if running { tokio::time::sleep(std::time::Duration::from_millis(200)).await; }
            else { notified.await; }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    fn running() -> Record { Record { version: 1, id: "00000000-0000-4000-8000-000000000001".into(), seconds: 10, phase: Phase::Running } }
    #[test] fn elapsed_deadline_survives_sleep_jump_and_ignores_wall_clock() {
        let r = running(); assert!(!due(Some(&r), Some(10_000), 9999)); assert!(due(Some(&r), Some(10_000), 600_000));
        // Only elapsed samples enter the decision; no UTC/wall-clock input exists.
        assert!(due(Some(&r), Some(10_000), 10_000));
    }
    #[test] fn failed_persist_never_commits_or_discards_running_timer() {
        let mut s = State::default();
        assert!(commit(&mut s, running(), Some(10_000), |_| Err("disk-full".into())).is_err());
        assert!(s.record.is_none());
        commit(&mut s, running(), Some(10_000), |_| Ok(())).unwrap();
        let mut cancelled = running(); cancelled.phase = Phase::Cancelled;
        assert!(commit(&mut s, cancelled, None, |_| Err("disk-full".into())).is_err());
        assert_eq!(s.record.unwrap().phase, Phase::Running); assert_eq!(s.deadline, Some(10_000));
    }
    #[test] fn duplicate_start_and_late_cancel_preserve_the_current_identity() {
        let mut s = State::default();
        assert!(begin(&mut s, "first".into(), 10, 100, |_| Ok(())).unwrap());
        assert!(!begin(&mut s, "second".into(), 20, 500, |_| panic!("must not persist duplicate")).unwrap());
        assert_eq!(s.deadline, Some(10_100));
        assert!(!cancel(&mut s, "old", |_| panic!("must not persist stale cancel")).unwrap());
        assert!(cancel(&mut s, "first", |_| Ok(())).unwrap());
        assert!(!due(s.record.as_ref(), s.deadline, 99_000));
        assert!(begin(&mut s, "second".into(), 20, 500, |_| Ok(())).unwrap());
        assert!(!cancel(&mut s, "first", |_| panic!("must not cancel new timer")).unwrap());
        assert_eq!(s.record.as_ref().unwrap().id, "second");
    }
    #[test] fn late_publication_cannot_revive_an_old_completion() {
        let mut s = State::default(); let mut r = running(); r.phase = Phase::Expired;
        let old = r.id.clone(); commit(&mut s, r, None, |_| Ok(())).unwrap();
        assert!(presentable(&s, &old));
        begin(&mut s, "new".into(), 10, 0, |_| Ok(())).unwrap();
        assert!(!presentable(&s, &old));
    }
    #[test] fn terminal_states_never_expire_again() { for phase in [Phase::Cancelled, Phase::Expired, Phase::Interrupted] { let mut r = running(); r.phase = phase; assert!(!due(Some(&r), Some(1), 9000)); } }
    #[test] fn restart_interrupts_only_running() { assert_eq!(recover(running()).phase, Phase::Interrupted); let mut r = running(); r.phase = Phase::Expired; assert_eq!(recover(r).phase, Phase::Expired); }
}
