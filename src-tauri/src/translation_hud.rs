//! Dedicated two-stage translation HUD. The passive stage cannot receive input;
//! activation captures a short-lived focus lease before making the HUD keyable.
//! Source text never crosses this module's native boundary. Completed output is
//! held only for the matching active session and sent only to the HUD window.

use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};

const LABEL: &str = "translation-hud";
const UPDATE_EVENT: &str = "hiven://translation-hud-update";
const ACTION_EVENT: &str = "hiven://translation-hud-action";
const MAX_PASSIVE_LIFETIME_MS: u64 = 30_000;
const ACTIVE_READING_LIFETIME_MS: u64 = 120_000;
const MAX_PREVIEW_CHARS: usize = 512;
const MAX_FULL_TEXT_CHARS: usize = 1_000_000;
const MAX_SESSION_ID_BYTES: usize = 128;
const PASSIVE_WIDTH: f64 = 420.0;
const PASSIVE_HEIGHT: f64 = 168.0;
const ACTIVE_HEIGHT: f64 = 480.0;
const WORK_AREA_MARGIN: f64 = 32.0;
static CREATION: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Phase {
    Translating,
    Ready,
    Active,
    Cancelled,
    Error,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Locale {
    Zh,
    En,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Theme {
    Light,
    Dark,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Snapshot {
    session_id: String,
    revision: u64,
    phase: Phase,
    preview: String,
    truncated: bool,
    copy_failed: bool,
    complete: bool,
    expires_at: u64,
    locale: Locale,
    theme: Theme,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Update {
    revision: u64,
    snapshot: Option<Snapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    full_text: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Action {
    Copy,
    Close,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActionRequest {
    session_id: String,
    revision: u64,
    action: Action,
}

#[cfg(target_os = "linux")]
struct FocusLease(super::linux_x11_paste::HudFocusLease);
#[cfg(target_os = "macos")]
struct FocusLease {
    pid: u32,
}
#[cfg(target_os = "windows")]
struct FocusLease {
    hwnd: isize,
}
#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
struct FocusLease;

impl FocusLease {
    fn capture() -> Result<Self, String> {
        #[cfg(target_os = "linux")]
        {
            super::linux_x11_paste::HudFocusLease::capture().map(Self)
        }
        #[cfg(target_os = "macos")]
        {
            let pid = super::current_foreground_process_id()
                .filter(|pid| *pid != 0 && *pid != std::process::id())
                .ok_or_else(|| "translation-hud-focus-unavailable".to_string())?;
            Ok(Self { pid })
        }
        #[cfg(target_os = "windows")]
        unsafe {
            use windows::Win32::UI::WindowsAndMessaging::{
                GetForegroundWindow, GetWindowThreadProcessId,
            };
            let hwnd = GetForegroundWindow();
            if hwnd.0.is_null() {
                return Err("translation-hud-focus-unavailable".into());
            }
            let mut pid = 0;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid == 0 || pid == std::process::id() {
                return Err("translation-hud-focus-unavailable".into());
            }
            Ok(Self {
                hwnd: hwnd.0 as isize,
            })
        }
        #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
        {
            Err("translation-hud-focus-unavailable".into())
        }
    }

    fn restore(self) {
        #[cfg(target_os = "linux")]
        {
            tauri::async_runtime::spawn_blocking(move || {
                let _ = self.0.restore();
            });
        }
        #[cfg(target_os = "macos")]
        super::activate_process(self.pid);
        #[cfg(target_os = "windows")]
        unsafe {
            use windows::Win32::Foundation::HWND;
            use windows::Win32::UI::WindowsAndMessaging::{IsWindow, SetForegroundWindow};
            let hwnd = HWND(self.hwnd as *mut std::ffi::c_void);
            if IsWindow(Some(hwnd)).as_bool() {
                let _ = SetForegroundWindow(hwnd);
            }
        }
    }
}

#[derive(Default)]
struct State {
    current: Option<Snapshot>,
    full_text: Option<(String, u64, String)>,
    generation: u64,
    ready: bool,
    active: bool,
    active_focused: bool,
    restore_allowed: bool,
    action_sent: bool,
    activation_previous_expiry: Option<u64>,
    lease: Option<FocusLease>,
}

impl State {
    fn present(
        &mut self,
        snapshot: Snapshot,
        full_text: Option<String>,
        now: u64,
    ) -> Result<bool, &'static str> {
        validate_snapshot(&snapshot, now)?;
        if let Some(current) = self.current.as_ref() {
            if current.session_id == snapshot.session_id && snapshot.revision <= current.revision {
                return Ok(false);
            }
        }
        let same_session = self
            .current
            .as_ref()
            .is_some_and(|current| current.session_id == snapshot.session_id);
        // Activation owns the phase and deadline atomically. A provider update can
        // already be queued while the launcher is awaiting that activation; do
        // not let its older passive snapshot demote the native reading session.
        if same_session && self.active && snapshot.phase != Phase::Active {
            return Ok(false);
        }
        if !same_session {
            self.active = false;
            self.active_focused = false;
            self.restore_allowed = false;
            self.full_text = None;
            self.activation_previous_expiry = None;
            self.lease = None;
        }
        if snapshot.phase == Phase::Active && !self.active {
            return Err("translation-hud-not-active");
        }
        if full_text.is_some()
            && (!self.active || snapshot.phase != Phase::Active || !snapshot.complete)
        {
            return Err("translation-hud-invalid");
        }
        if snapshot.phase == Phase::Active && snapshot.complete && full_text.is_none() {
            return Err("translation-hud-invalid");
        }
        if let Some(text) = full_text.as_ref() {
            if text.is_empty() || text.contains('\0') || text.chars().count() > MAX_FULL_TEXT_CHARS
            {
                return Err("translation-hud-invalid");
            }
        }
        self.action_sent = false;
        if snapshot.phase == Phase::Active {
            self.activation_previous_expiry = None;
        }
        self.full_text =
            full_text.map(|text| (snapshot.session_id.clone(), snapshot.revision, text));
        self.current = Some(snapshot);
        self.generation = self.generation.saturating_add(1);
        Ok(true)
    }

    fn activate(
        &mut self,
        session_id: &str,
        revision: u64,
        now: u64,
        lease: FocusLease,
    ) -> Option<u64> {
        let valid = self.current.as_ref().is_some_and(|snapshot| {
            snapshot.session_id == session_id
                && revision <= snapshot.revision
                && snapshot.expires_at > now
                && !matches!(snapshot.phase, Phase::Cancelled | Phase::Error)
        });
        if !valid || self.active {
            return None;
        }
        let expires_at = now.saturating_add(ACTIVE_READING_LIFETIME_MS);
        if let Some(snapshot) = self.current.as_mut() {
            self.activation_previous_expiry = Some(snapshot.expires_at);
            snapshot.expires_at = expires_at;
        }
        self.active = true;
        self.active_focused = false;
        self.restore_allowed = true;
        self.action_sent = false;
        self.lease = Some(lease);
        Some(expires_at)
    }

    fn focus_changed(&mut self, focused: bool) {
        if !self.active {
            return;
        }
        if focused {
            self.active_focused = true;
        } else if self.active_focused {
            self.restore_allowed = false;
            self.lease = None;
        }
    }

    fn activation_failed(&mut self) -> Option<FocusLease> {
        let lease = self.lease.take();
        self.active = false;
        self.active_focused = false;
        self.restore_allowed = false;
        self.action_sent = false;
        self.full_text = None;
        if let (Some(snapshot), Some(previous)) = (
            self.current.as_mut(),
            self.activation_previous_expiry.take(),
        ) {
            snapshot.expires_at = previous;
        }
        lease
    }

    fn action(
        &mut self,
        session_id: &str,
        revision: u64,
        action: Action,
        now: u64,
    ) -> Option<ActionRequest> {
        let current = self.current.as_ref()?;
        let revision_matches = match action {
            Action::Copy => current.revision == revision,
            Action::Close => revision <= current.revision,
        };
        if !self.active
            || current.phase != Phase::Active
            || self.action_sent
            || current.session_id != session_id
            || !revision_matches
            || current.expires_at <= now
        {
            return None;
        }
        self.action_sent = true;
        Some(ActionRequest {
            session_id: session_id.to_owned(),
            revision,
            action,
        })
    }

    fn take_for_dismiss(
        &mut self,
        session_id: &str,
        revision: u64,
        focused: bool,
    ) -> Option<FocusLease> {
        let current = self.current.as_ref()?;
        if current.session_id != session_id || revision < current.revision {
            return None;
        }
        let lease = (focused && self.active && self.restore_allowed)
            .then(|| self.lease.take())
            .flatten();
        self.current = None;
        self.generation = self.generation.saturating_add(1);
        self.active = false;
        self.active_focused = false;
        self.restore_allowed = false;
        self.action_sent = false;
        self.full_text = None;
        self.activation_previous_expiry = None;
        self.lease = None;
        lease
    }
}

fn state() -> &'static Mutex<State> {
    static STATE: OnceLock<Mutex<State>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(State::default()))
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn valid_session_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_SESSION_ID_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn validate_snapshot(snapshot: &Snapshot, current_time: u64) -> Result<(), &'static str> {
    let max_lifetime = if snapshot.phase == Phase::Active {
        ACTIVE_READING_LIFETIME_MS
    } else {
        MAX_PASSIVE_LIFETIME_MS
    };
    if !valid_session_id(&snapshot.session_id)
        || snapshot.revision > 9_007_199_254_740_991
        || snapshot.preview.chars().count() > MAX_PREVIEW_CHARS
        || snapshot.preview.contains('\0')
        || snapshot.expires_at <= current_time
        || snapshot.expires_at > current_time.saturating_add(max_lifetime)
    {
        return Err("translation-hud-invalid");
    }
    Ok(())
}

fn current_update(include_full_text: bool) -> Result<Update, String> {
    let state = state().lock().map_err(|_| "translation-hud-unavailable")?;
    let full_text = include_full_text
        .then(|| {
            let current = state.current.as_ref()?;
            let (session_id, revision, text) = state.full_text.as_ref()?;
            (current.phase == Phase::Active
                && current.session_id == *session_id
                && current.revision == *revision)
                .then(|| text.clone())
        })
        .flatten();
    Ok(Update {
        revision: state.generation,
        snapshot: state.current.clone(),
        full_text,
    })
}

fn ensure_window(app: &tauri::AppHandle) -> Result<(), String> {
    if app.get_webview_window(LABEL).is_some() {
        return Ok(());
    }
    state()
        .lock()
        .map_err(|_| "translation-hud-unavailable")?
        .ready = false;
    let window = tauri::WebviewWindowBuilder::new(
        app,
        LABEL,
        tauri::WebviewUrl::App("index.html?window=translation-hud".into()),
    )
    .title("Hiven")
    .inner_size(PASSIVE_WIDTH, PASSIVE_HEIGHT)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .resizable(false)
    .visible(false)
    .focused(false)
    .focusable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .build()
    .map_err(|_| "translation-hud-unavailable")?;
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    window
        .remove_menu()
        .map_err(|_| "translation-hud-unavailable")?;
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::Focused(focused) => {
            if let Ok(mut state) = state().lock() {
                state.focus_changed(*focused);
            }
        }
        tauri::WindowEvent::Destroyed => {
            if let Ok(mut state) = state().lock() {
                *state = State::default();
            }
        }
        _ => {}
    });
    Ok(())
}

fn position(window: &tauri::WebviewWindow, active: bool) -> Result<(), String> {
    if let Some(monitor) =
        super::monitor_under_cursor(window).or_else(|| window.primary_monitor().ok().flatten())
    {
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        let width = (PASSIVE_WIDTH * scale).min(area.size.width as f64).max(1.0);
        let preferred_height = if active {
            ACTIVE_HEIGHT
        } else {
            PASSIVE_HEIGHT
        } * scale;
        let available_height = (area.size.height as f64 - WORK_AREA_MARGIN * scale).max(1.0);
        let height = preferred_height.min(available_height);
        let x = area.position.x as f64 + (area.size.width as f64 - width) / 2.0;
        let y = area.position.y as f64 + (area.size.height as f64 - height - 32.0 * scale).max(0.0);
        #[cfg(target_os = "linux")]
        {
            use gtk::prelude::WidgetExt;
            window
                .gtk_window()
                .map_err(|_| "translation-hud-unavailable")?
                .set_size_request((width / scale) as i32, (height / scale) as i32);
        }
        window
            .set_size(tauri::PhysicalSize::new(width as u32, height as u32))
            .map_err(|_| "translation-hud-unavailable")?;
        window
            .set_position(tauri::PhysicalPosition::new(x as i32, y as i32))
            .map_err(|_| "translation-hud-unavailable")?;
    }
    Ok(())
}

fn show_passive(app: &tauri::AppHandle) -> Result<(), String> {
    let (ready, active) = {
        let state = state().lock().map_err(|_| "translation-hud-unavailable")?;
        (state.ready, state.active)
    };
    if !ready {
        return Ok(());
    }
    let update = current_update(active)?;
    let Some(snapshot) = update.snapshot.as_ref() else {
        return Ok(());
    };
    if snapshot.expires_at <= now() {
        return Ok(());
    }
    let window = app
        .get_webview_window(LABEL)
        .ok_or("translation-hud-unavailable")?;
    position(&window, active)?;
    window
        .emit(UPDATE_EVENT, &update)
        .map_err(|_| "translation-hud-unavailable")?;
    if active {
        return Ok(());
    }
    window
        .set_focusable(false)
        .map_err(|_| "translation-hud-unavailable")?;
    window.show().map_err(|_| "translation-hud-unavailable")?;
    window
        .set_ignore_cursor_events(true)
        .map_err(|_| "translation-hud-unavailable")?;
    Ok(())
}

fn hide_window(app: &tauri::AppHandle) {
    let update = current_update(false).unwrap_or(Update {
        revision: 0,
        snapshot: None,
        full_text: None,
    });
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.hide();
        let _ = window.set_focusable(false);
        let _ = window.set_ignore_cursor_events(true);
        let _ = window.emit(UPDATE_EVENT, update);
    }
}

fn dismiss_on_main(
    app: &tauri::AppHandle,
    session_id: &str,
    revision: u64,
) -> Result<bool, String> {
    let focused = app
        .get_webview_window(LABEL)
        .and_then(|window| window.is_focused().ok())
        .unwrap_or(false);
    let (matched, lease) = {
        let mut state = state().lock().map_err(|_| "translation-hud-unavailable")?;
        let matched = state.current.as_ref().is_some_and(|snapshot| {
            snapshot.session_id == session_id && revision >= snapshot.revision
        });
        let lease = state.take_for_dismiss(session_id, revision, focused);
        (matched, lease)
    };
    if !matched {
        return Ok(false);
    }
    hide_window(app);
    if let Some(lease) = lease {
        lease.restore();
    }
    Ok(true)
}

fn schedule_expiry(app: tauri::AppHandle, session_id: String, revision: u64, expires_at: u64) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(expires_at.saturating_sub(now()))).await;
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let expired = state()
                .lock()
                .ok()
                .and_then(|state| state.current.clone())
                .is_some_and(|snapshot| {
                    snapshot.session_id == session_id
                        && snapshot.revision >= revision
                        && snapshot.expires_at <= now()
                });
            if expired {
                let _ = dismiss_on_main(&handle, &session_id, u64::MAX);
            }
        });
    });
}

#[tauri::command]
pub(crate) async fn translation_hud_present(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    snapshot: Snapshot,
    full_text: Option<String>,
) -> Result<(), String> {
    if window.label() != "launcher" {
        return Err("translation-hud-unavailable".into());
    }
    let _creation = CREATION.lock().await;
    ensure_window(&app)?;
    let session_id = snapshot.session_id.clone();
    let revision = snapshot.revision;
    let expires_at = snapshot.expires_at;
    let accepted = state()
        .lock()
        .map_err(|_| "translation-hud-unavailable")?
        .present(snapshot, full_text, now())
        .map_err(str::to_owned)?;
    if !accepted {
        return Ok(());
    }
    show_passive(&app)?;
    schedule_expiry(app, session_id, revision, expires_at);
    Ok(())
}

#[tauri::command]
pub(crate) async fn translation_hud_activate(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    session_id: String,
    revision: u64,
) -> Result<Option<u64>, String> {
    if window.label() != "launcher" || !valid_session_id(&session_id) {
        return Err("translation-hud-unavailable".into());
    }
    let handle = app.clone();
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let result = (|| {
            let lease = FocusLease::capture()?;
            let hud = handle
                .get_webview_window(LABEL)
                .ok_or("translation-hud-unavailable")?;
            let expires_at;
            {
                let mut state = state().lock().map_err(|_| "translation-hud-unavailable")?;
                let Some(deadline) = state.activate(&session_id, revision, now(), lease) else {
                    return Ok(None);
                };
                expires_at = deadline;
            }
            let activation: Result<(), String> = (|| {
                position(&hud, true)?;
                hud.set_ignore_cursor_events(false)
                    .map_err(|_| "translation-hud-unavailable".to_owned())?;
                hud.set_focusable(true)
                    .map_err(|_| "translation-hud-unavailable".to_owned())?;
                hud.show()
                    .map_err(|_| "translation-hud-unavailable".to_owned())?;
                hud.set_focus()
                    .map_err(|_| "translation-hud-unavailable".to_owned())
            })();
            if activation.is_err() {
                let focused = hud.is_focused().unwrap_or(false);
                let lease = state()
                    .lock()
                    .ok()
                    .and_then(|mut state| state.activation_failed());
                let _ = hud.hide();
                let _ = hud.set_focusable(false);
                let _ = hud.set_ignore_cursor_events(true);
                if focused {
                    if let Some(lease) = lease {
                        lease.restore();
                    }
                }
                return Ok(None);
            }
            schedule_expiry(handle.clone(), session_id.clone(), revision, expires_at);
            Ok(Some(expires_at))
        })();
        let _ = tx.send(result);
    })
    .map_err(|_| "translation-hud-unavailable")?;
    rx.await.map_err(|_| "translation-hud-unavailable")?
}

#[tauri::command]
pub(crate) async fn translation_hud_dismiss(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    session_id: String,
    revision: u64,
) -> Result<(), String> {
    if window.label() != "launcher" || !valid_session_id(&session_id) {
        return Err("translation-hud-unavailable".into());
    }
    let handle = app.clone();
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(dismiss_on_main(&handle, &session_id, revision).map(|_| ()));
    })
    .map_err(|_| "translation-hud-unavailable")?;
    rx.await.map_err(|_| "translation-hud-unavailable")?
}

#[tauri::command]
pub(crate) async fn translation_hud_ready(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Update, String> {
    if window.label() != LABEL {
        return Err("translation-hud-unavailable".into());
    }
    state()
        .lock()
        .map_err(|_| "translation-hud-unavailable")?
        .ready = true;
    show_passive(&app)?;
    current_update(true)
}

#[tauri::command]
pub(crate) async fn translation_hud_action(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    session_id: String,
    revision: u64,
    action: Action,
) -> Result<bool, String> {
    if window.label() != LABEL || !valid_session_id(&session_id) {
        return Err("translation-hud-unavailable".into());
    }
    let request = state()
        .lock()
        .map_err(|_| "translation-hud-unavailable")?
        .action(&session_id, revision, action, now());
    let Some(request) = request else {
        return Ok(false);
    };
    app.emit_to("launcher", ACTION_EVENT, request)
        .map_err(|_| "translation-hud-unavailable")?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(session: &str, revision: u64, expires_at: u64) -> Snapshot {
        Snapshot {
            session_id: session.into(),
            revision,
            phase: Phase::Ready,
            preview: "result".into(),
            truncated: false,
            copy_failed: false,
            complete: true,
            expires_at,
            locale: Locale::En,
            theme: Theme::Dark,
        }
    }

    #[test]
    fn rejects_stale_unbounded_and_oversized_snapshots() {
        let mut state = State::default();
        assert!(state.present(snapshot("one", 2, 200), None, 100).unwrap());
        assert!(!state.present(snapshot("one", 1, 200), None, 100).unwrap());
        assert!(state
            .present(snapshot("two", 1, 30_101), None, 100)
            .is_err());
        let mut oversized = snapshot("two", 1, 200);
        oversized.preview = "x".repeat(MAX_PREVIEW_CHARS + 1);
        assert!(state.present(oversized, None, 100).is_err());
    }

    #[test]
    fn full_text_requires_active_matching_revision_and_is_cleared_by_replacement() {
        let mut state = State::default();
        assert!(state.present(snapshot("one", 1, 200), None, 100).unwrap());
        let mut active = snapshot("one", 2, 120_100);
        active.phase = Phase::Active;
        active.truncated = true;
        state.active = true;
        assert!(state
            .present(active, Some("complete result".into()), 100)
            .unwrap());
        assert_eq!(state.full_text.as_ref().map(|owned| owned.1), Some(2));

        let mut stale = snapshot("one", 1, 120_100);
        stale.phase = Phase::Active;
        assert!(!state
            .present(stale, Some("stale secret".into()), 100)
            .unwrap());
        assert_eq!(
            state.full_text.as_ref().map(|owned| owned.2.as_str()),
            Some("complete result")
        );

        assert!(state.present(snapshot("two", 1, 200), None, 100).unwrap());
        assert!(state.full_text.is_none());
    }

    #[test]
    fn passive_update_cannot_demote_an_activated_session() {
        let mut state = State::default();
        assert!(state.present(snapshot("one", 1, 115), None, 100).unwrap());

        // Model the atomic portion of activate() without fabricating a platform
        // focus lease: native state owns the extended deadline before IPC returns.
        state.active = true;
        state.activation_previous_expiry = Some(115);
        state.current.as_mut().unwrap().expires_at = 120_100;

        let passive = snapshot("one", 2, 115);
        assert!(!state.present(passive, None, 101).unwrap());
        let current = state.current.as_ref().unwrap();
        assert_eq!(current.phase, Phase::Ready);
        assert_eq!(current.revision, 1);
        assert_eq!(current.expires_at, 120_100);
        assert!(state.active);

        let mut active = snapshot("one", 3, 120_100);
        active.phase = Phase::Active;
        assert!(state
            .present(active, Some("complete result".into()), 102)
            .unwrap());
        let current = state.current.as_ref().unwrap();
        assert_eq!(current.phase, Phase::Active);
        assert_eq!(current.revision, 3);
        assert_eq!(current.expires_at, 120_100);
    }

    #[test]
    fn focus_loss_revokes_restore_and_actions_are_one_shot() {
        // The platform lease is deliberately not fabricated in this pure state
        // test; focus-loss behavior is observable independently of its payload.
        let mut state = State::default();
        let mut current = snapshot("one", 3, 200);
        current.phase = Phase::Active;
        state.current = Some(current);
        state.active = true;
        state.active_focused = true;
        state.restore_allowed = true;
        assert!(state.action("one", 3, Action::Copy, 100).is_some());
        assert!(state.action("one", 3, Action::Copy, 100).is_none());
        state.focus_changed(false);
        assert!(!state.restore_allowed);
        assert!(state.take_for_dismiss("one", 3, true).is_none());
        assert!(state.current.is_none());
    }

    #[test]
    fn expired_and_wrong_revision_actions_cannot_escape() {
        let mut state = State::default();
        let mut current = snapshot("one", 4, 150);
        current.phase = Phase::Active;
        state.current = Some(current);
        state.active = true;
        assert!(state.action("one", 3, Action::Copy, 100).is_none());
        assert!(state.action("one", 3, Action::Close, 100).is_some());
        assert!(state.action("one", 4, Action::Close, 150).is_none());
        assert!(state.take_for_dismiss("one", 3, true).is_none());
        assert!(state.current.is_some());
        assert!(state.take_for_dismiss("one", 4, false).is_none());
        assert!(state.current.is_none());
    }
}
