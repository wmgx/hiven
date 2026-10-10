//! X11 paste targets are captured before a hiven surface takes focus. A paste
//! never substitutes the window that happens to be focused at execution time.

use std::cell::Cell;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use x11rb::connection::Connection;
use x11rb::protocol::xproto::{
    Atom, AtomEnum, ChangeWindowAttributesAux, ClientMessageEvent, ConnectionExt as _, EventMask,
    MapState, Window, KEY_PRESS_EVENT, KEY_RELEASE_EVENT,
};
use x11rb::protocol::xtest::ConnectionExt as _;
use x11rb::protocol::Event;
use x11rb::rust_connection::RustConnection;
use x11rb::{CURRENT_TIME, NONE};

type PasteResult<T> = Result<T, String>;
static TARGETS: OnceLock<Mutex<HashMap<String, Arc<PasteTarget>>>> = OnceLock::new();
// Serialize the short synthetic chords, including calls from different surfaces.
static PASTE_LOCK: Mutex<()> = Mutex::new(());

// A surface opening has its own identity. Several openings can share one
// captured window and its original DestroyNotify observer without retargeting
// each other when another surface opens again.
pub(crate) struct SurfaceTarget<T> {
    surface: String,
    captured: Arc<T>,
}

type SurfaceTargets<T> = HashMap<String, Arc<SurfaceTarget<T>>>;
pub(crate) type PasteTarget = SurfaceTarget<CapturedWindow>;

pub(crate) struct CapturedWindow {
    session: Mutex<Session>,
    window: Window,
}

struct Session {
    connection: RustConnection,
    root: Window,
    active_window: Atom,
    wm_pid: Atom,
    destroyed: Cell<bool>,
}

fn error(error: impl std::fmt::Display) -> String {
    format!("X11 paste: {error}")
}

fn targets() -> &'static Mutex<HashMap<String, Arc<PasteTarget>>> {
    TARGETS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn is_x11_session(session_type: Option<&str>, wayland_display: Option<&str>) -> bool {
    // An XWayland DISPLAY does not make a Wayland session a supported desktop.
    session_type.is_some_and(|value| value.eq_ignore_ascii_case("x11"))
        && !wayland_display.is_some_and(|value| !value.is_empty())
}

impl Session {
    fn connect() -> PasteResult<Self> {
        if !is_x11_session(
            std::env::var("XDG_SESSION_TYPE").ok().as_deref(),
            std::env::var("WAYLAND_DISPLAY").ok().as_deref(),
        ) {
            return Err(error("a confirmed X11 desktop session is required"));
        }
        let (connection, screen) = x11rb::connect(None).map_err(error)?;
        let root = connection.setup().roots[screen].root;
        // These are server queries only: preflight cannot inject input or focus.
        let extension = connection
            .query_extension(b"XTEST")
            .map_err(error)?
            .reply()
            .map_err(error)?;
        if !extension.present {
            return Err(error("the XTEST extension is unavailable"));
        }
        connection
            .xtest_get_version(2, 2)
            .map_err(error)?
            .reply()
            .map_err(error)?;
        let atom = |name: &[u8]| -> PasteResult<Atom> {
            Ok(connection
                .intern_atom(true, name)
                .map_err(error)?
                .reply()
                .map_err(error)?
                .atom)
        };
        let active_window = atom(b"_NET_ACTIVE_WINDOW")?;
        let supported = atom(b"_NET_SUPPORTED")?;
        let wm_check = atom(b"_NET_SUPPORTING_WM_CHECK")?;
        if [active_window, supported, wm_check].contains(&NONE) {
            return Err(error("the window manager does not support EWMH activation"));
        }
        let wm = property_window(&connection, root, wm_check)?
            .ok_or_else(|| error("no EWMH window manager is running"))?;
        if property_window(&connection, wm, wm_check)? != Some(wm) {
            return Err(error("the EWMH window manager is no longer available"));
        }
        let supported = connection
            .get_property(false, root, supported, AtomEnum::ATOM, 0, 4096)
            .map_err(error)?
            .reply()
            .map_err(error)?;
        if !supported
            .value32()
            .is_some_and(|mut atoms| atoms.any(|atom| atom == active_window))
        {
            return Err(error("the window manager cannot restore the target window"));
        }
        let wm_pid = atom(b"_NET_WM_PID")?;
        Ok(Self {
            connection,
            root,
            active_window,
            wm_pid,
            destroyed: Cell::new(false),
        })
    }

    fn active(&self) -> PasteResult<Option<Window>> {
        property_window(&self.connection, self.root, self.active_window)
    }

    fn ensure_alive(&self, window: Window) -> PasteResult<()> {
        // The round trip also makes preceding DestroyNotify events observable.
        let attributes = self
            .connection
            .get_window_attributes(window)
            .map_err(error)?
            .reply()
            .map_err(error)?;
        while let Some(event) = self.connection.poll_for_event().map_err(error)? {
            if matches!(event, Event::DestroyNotify(event) if event.window == window) {
                self.destroyed.set(true);
            }
        }
        if self.destroyed.get() {
            return Err(error("the remembered target was destroyed"));
        }
        if attributes.map_state != MapState::VIEWABLE {
            return Err(error("the remembered target is not viewable"));
        }
        Ok(())
    }

    fn focused(&self, target: Window) -> PasteResult<bool> {
        if self.active()? != Some(target) {
            return Ok(false);
        }
        let mut focus = self
            .connection
            .get_input_focus()
            .map_err(error)?
            .reply()
            .map_err(error)?
            .focus;
        // A toolkit can focus a descendant of the EWMH client window.
        for _ in 0..64 {
            if focus == target {
                return Ok(true);
            }
            if focus == NONE || focus == 1 || focus == self.root {
                return Ok(false);
            }
            focus = self
                .connection
                .query_tree(focus)
                .map_err(error)?
                .reply()
                .map_err(error)?
                .parent;
        }
        Ok(false)
    }

    fn request_activation(&self, target: Window) -> PasteResult<()> {
        let event = ClientMessageEvent::new(
            32,
            target,
            self.active_window,
            // EWMH source 2 identifies a window-switching utility. The WM keeps
            // control over activation; never force focus via SetInputFocus.
            [2, CURRENT_TIME, self.active()?.unwrap_or(NONE), 0, 0],
        );
        self.connection
            .send_event(
                false,
                self.root,
                EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY,
                event,
            )
            .map_err(error)?
            .check()
            .map_err(error)?;
        self.connection.flush().map_err(error)
    }

    fn keyboard_idle(&self) -> PasteResult<bool> {
        let keys = self
            .connection
            .query_keymap()
            .map_err(error)?
            .reply()
            .map_err(error)?;
        let pointer = self
            .connection
            .query_pointer(self.root)
            .map_err(error)?
            .reply()
            .map_err(error)?;
        // Ignore CapsLock/NumLock; refuse held or latched Shift/Ctrl/Alt/Super
        // and other modifiers instead of releasing keys pressed by the user.
        let modifiers = u16::from(pointer.mask) & (1 | 4 | 8 | 32 | 64 | 128);
        Ok(keys.keys.iter().all(|byte| *byte == 0) && modifiers == 0)
    }

    fn paste_keycodes(&self) -> PasteResult<(u8, u8)> {
        let setup = self.connection.setup();
        let count = setup.max_keycode - setup.min_keycode + 1;
        let mapping = self
            .connection
            .get_keyboard_mapping(setup.min_keycode, count)
            .map_err(error)?
            .reply()
            .map_err(error)?;
        let modifiers = self
            .connection
            .get_modifier_mapping()
            .map_err(error)?
            .reply()
            .map_err(error)?;
        let per_modifier = modifiers.keycodes.len() / 8;
        let controls = &modifiers.keycodes[per_modifier * 2..per_modifier * 3];
        select_paste_keycodes(
            setup.min_keycode,
            mapping.keysyms_per_keycode,
            &mapping.keysyms,
            controls,
        )
        .ok_or_else(|| error("the keyboard mapping has no unshifted Ctrl+V shortcut"))
    }
}

fn property_window(
    connection: &RustConnection,
    window: Window,
    atom: Atom,
) -> PasteResult<Option<Window>> {
    let property = connection
        .get_property(false, window, atom, AtomEnum::WINDOW, 0, 1)
        .map_err(error)?
        .reply()
        .map_err(error)?;
    Ok(property
        .value32()
        .and_then(|mut values| values.next())
        .filter(|window| *window != NONE))
}

fn select_paste_keycodes(
    first: u8,
    width: u8,
    symbols: &[u32],
    controls: &[u8],
) -> Option<(u8, u8)> {
    if width == 0 {
        return None;
    }
    let mut control = None;
    let mut v = None;
    for (offset, row) in symbols.chunks(usize::from(width)).enumerate() {
        let code = u8::try_from(usize::from(first) + offset).ok()?;
        if controls.contains(&code) && row.iter().any(|symbol| matches!(symbol, 0xffe3 | 0xffe4)) {
            control.get_or_insert(code);
        }
        if matches!(row.first(), Some(0x76 | 0x56)) {
            v.get_or_insert(code);
        }
    }
    let (control, v) = (control?, v?);
    (control != v).then_some((control, v))
}

pub(crate) fn can_attempt() -> bool {
    Session::connect().is_ok()
}

fn is_confirmed_external_pid(pid: Option<u32>, own_pid: u32) -> bool {
    pid.is_some_and(|pid| pid != 0 && pid != own_pid)
}

/// Replace even on capture failure, so an earlier session cannot leak through.
pub(crate) fn remember_target(surface: &str, allow_hiven: bool) {
    capture_target(surface, allow_hiven, false);
}

/// A visible Launcher can be summoned again from a new external app. Keep its
/// existing target only when the active window is confirmed to be hiven (for
/// example when returning from a companion). An unknown PID is not evidence.
pub(crate) fn refresh_launcher_target() {
    capture_target("launcher", false, true);
}

#[derive(Debug, PartialEq)]
enum CaptureAction {
    Capture,
    Preserve,
    Reject,
}

fn capture_action(
    allow_hiven: bool,
    preserve_hiven: bool,
    pid: Option<u32>,
    own_pid: u32,
) -> CaptureAction {
    if allow_hiven || is_confirmed_external_pid(pid, own_pid) {
        CaptureAction::Capture
    } else if preserve_hiven && pid == Some(own_pid) {
        CaptureAction::Preserve
    } else {
        CaptureAction::Reject
    }
}

fn capture_target(surface: &str, allow_hiven: bool, preserve_hiven: bool) {
    let captured = (|| {
        let session = Session::connect()?;
        let window = session
            .active()?
            .ok_or_else(|| error("no active target window"))?;
        if !allow_hiven {
            let pid = if session.wm_pid == NONE {
                None
            } else {
                session
                    .connection
                    .get_property(false, window, session.wm_pid, AtomEnum::CARDINAL, 0, 1)
                    .map_err(error)?
                    .reply()
                    .map_err(error)?
                    .value32()
                    .and_then(|mut values| values.next())
            };
            match capture_action(allow_hiven, preserve_hiven, pid, std::process::id()) {
                CaptureAction::Preserve => return Ok(None),
                CaptureAction::Reject => {
                    return Err(error(
                        "the global launcher target is not confirmed as an external process",
                    ));
                }
                CaptureAction::Capture => {}
            }
        }
        session
            .connection
            .change_window_attributes(
                window,
                &ChangeWindowAttributesAux::new().event_mask(EventMask::STRUCTURE_NOTIFY),
            )
            .map_err(error)?
            .check()
            .map_err(error)?;
        session.ensure_alive(window)?;
        if !session.focused(window)? {
            return Err(error("the active target does not hold keyboard focus"));
        }
        Ok(Some(Arc::new(PasteTarget {
            surface: surface.to_string(),
            captured: Arc::new(CapturedWindow {
                session: Mutex::new(session),
                window,
            }),
        })))
    })();
    if let Ok(mut targets) = targets().lock() {
        if let Err(error) = store_capture(&mut targets, surface, captured) {
            log::debug!("Cannot remember Linux paste target: {error}");
        }
    }
}

fn store_capture<T>(
    targets: &mut SurfaceTargets<T>,
    surface: &str,
    captured: PasteResult<Option<Arc<SurfaceTarget<T>>>>,
) -> PasteResult<()> {
    match captured {
        Ok(Some(target)) => {
            targets.insert(surface.to_string(), target);
            Ok(())
        }
        Ok(None) => Ok(()),
        Err(error) => {
            targets.remove(surface);
            Err(error)
        }
    }
}

fn inherit_launcher_target_in<T>(
    targets: &mut SurfaceTargets<T>,
    surface: &str,
    caller: &str,
    caller_focused: bool,
) -> PasteResult<()> {
    let captured = if caller != "launcher" || !caller_focused || surface == caller {
        Err(error("only the focused Launcher can pass its paste target"))
    } else {
        targets
            .get(caller)
            .map(|source| {
                Some(Arc::new(SurfaceTarget {
                    surface: surface.to_string(),
                    captured: Arc::clone(&source.captured),
                }))
            })
            .ok_or_else(|| error("Launcher has no captured paste target"))
    };
    // Only registry state is accessed here. Never lock a shared X11 session
    // while holding the registry: paste takes those locks in the other order.
    store_capture(targets, surface, captured)
}

pub(crate) fn inherit_launcher_target(surface: &str, caller: &str, caller_focused: bool) {
    if let Ok(mut targets) = targets().lock() {
        if let Err(error) = inherit_launcher_target_in(&mut targets, surface, caller, caller_focused) {
            log::debug!("Cannot inherit Linux paste target: {error}");
        }
    }
}

pub(crate) fn snapshot(surface: &str) -> PasteResult<Arc<PasteTarget>> {
    targets()
        .lock()
        .map_err(error)?
        .get(surface)
        .cloned()
        .ok_or_else(|| error("no target was captured before this surface opened"))
}

// A completed window switch only consumes the launcher target it started
// with. Other surfaces and targets captured by a later open remain intact.
pub(crate) fn clear_target_if_current(target: &Arc<PasteTarget>) {
    if let Ok(mut targets) = targets().lock() {
        remove_if_current(&mut targets, target);
    }
}

fn remove_if_current<T>(targets: &mut SurfaceTargets<T>, target: &Arc<SurfaceTarget<T>>) {
    if is_current(targets, target) { targets.remove(&target.surface); }
}

pub(crate) fn clear_targets() {
    if let Ok(mut targets) = targets().lock() {
        targets.clear();
    }
}

fn is_current<T>(targets: &SurfaceTargets<T>, target: &Arc<SurfaceTarget<T>>) -> bool {
    targets
        .get(&target.surface)
        .is_some_and(|current| Arc::ptr_eq(current, target))
}

fn ensure_current(target: &Arc<PasteTarget>) -> PasteResult<()> {
    let registry = targets().lock().map_err(error)?;
    if is_current(&registry, target) {
        Ok(())
    } else {
        Err(error("the surface was reopened or its target changed"))
    }
}

pub(crate) fn restore_and_paste(target: Arc<PasteTarget>) -> PasteResult<()> {
    restore_and_paste_checked(target, || Ok(()))
}

pub(crate) fn restore_and_paste_owned(
    target: Arc<PasteTarget>,
    attempt: &crate::paste_recovery::Attempt,
) -> PasteResult<()> {
    restore_and_paste_checked(target, || attempt.ensure_active())
}

fn restore_and_paste_checked(
    target: Arc<PasteTarget>,
    check_owner: impl Fn() -> PasteResult<()>,
) -> PasteResult<()> {
    let _paste_lock = PASTE_LOCK.lock().map_err(error)?;
    check_owner()?;
    ensure_current(&target)?;
    let captured = &target.captured;
    let session = captured.session.lock().map_err(error)?;
    session.ensure_alive(captured.window)?;
    if !session.focused(captured.window)? {
        check_owner()?;
        session.request_activation(captured.window)?;
    }
    let deadline = Instant::now() + Duration::from_millis(1200);
    let mut focused_since = None;
    loop {
        check_owner()?;
        ensure_current(&target)?;
        session.ensure_alive(captured.window)?;
        if session.focused(captured.window)? && session.keyboard_idle()? {
            let since = focused_since.get_or_insert_with(Instant::now);
            if since.elapsed() >= Duration::from_millis(100) {
                break;
            }
        } else {
            focused_since = None;
        }
        if Instant::now() >= deadline {
            return Err(error(
                "the target did not regain stable keyboard focus, or keys remain held",
            ));
        }
        thread::sleep(Duration::from_millis(20));
    }
    let registry = targets().lock().map_err(error)?;
    if !is_current(&registry, &target) {
        return Err(error("the surface was reopened or its target changed"));
    }
    // Keep the final verification and four events together. Other clients (the
    // WM included) cannot switch input focus between the check and the chord.
    // The server is ungrabbed before the target handles clipboard requests.
    let _server = ServerGrab::new(&session.connection)?;
    session.ensure_alive(captured.window)?;
    if !session.focused(captured.window)? || !session.keyboard_idle()? {
        return Err(error("the target or keyboard state changed before paste"));
    }
    let (control, v) = session.paste_keycodes()?;
    check_owner()?;
    let mut keys = SyntheticKeys {
        connection: &session.connection,
        held: Vec::new(),
    };
    keys.press(control)?;
    // Cancellation still releases any modifier already pressed through the
    // existing key guard; never inject V after an observed cancellation.
    check_owner()?;
    keys.press(v)?;
    keys.release(v)?;
    keys.release(control)?;
    Ok(())
}

struct ServerGrab<'a>(&'a RustConnection);

impl<'a> ServerGrab<'a> {
    fn new(connection: &'a RustConnection) -> PasteResult<Self> {
        let request = connection.grab_server().map_err(error)?;
        let guard = Self(connection);
        request.check().map_err(error)?;
        Ok(guard)
    }
}

impl Drop for ServerGrab<'_> {
    fn drop(&mut self) {
        let _ = self.0.ungrab_server();
        let _ = self.0.flush();
    }
}

struct SyntheticKeys<'a> {
    connection: &'a RustConnection,
    held: Vec<u8>,
}

impl SyntheticKeys<'_> {
    fn press(&mut self, code: u8) -> PasteResult<()> {
        self.held.push(code);
        self.connection
            .xtest_fake_input(KEY_PRESS_EVENT, code, CURRENT_TIME, NONE, 0, 0, 0)
            .map_err(error)?
            .check()
            .map_err(error)
    }

    fn release(&mut self, code: u8) -> PasteResult<()> {
        self.connection
            .xtest_fake_input(KEY_RELEASE_EVENT, code, CURRENT_TIME, NONE, 0, 0, 0)
            .map_err(error)?
            .check()
            .map_err(error)?;
        self.held.retain(|held| *held != code);
        Ok(())
    }
}

impl Drop for SyntheticKeys<'_> {
    fn drop(&mut self) {
        for code in self.held.iter().rev() {
            let _ = self.connection.xtest_fake_input(
                KEY_RELEASE_EVENT,
                *code,
                CURRENT_TIME,
                NONE,
                0,
                0,
                0,
            );
        }
        let _ = self.connection.flush();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn global_target_requires_a_known_external_process() {
        assert!(!is_confirmed_external_pid(None, 42));
        assert!(!is_confirmed_external_pid(Some(0), 42));
        assert!(!is_confirmed_external_pid(Some(42), 42));
        assert!(is_confirmed_external_pid(Some(43), 42));
    }

    #[test]
    fn visible_launcher_refreshes_only_from_a_confirmed_external_process() {
        assert_eq!(
            capture_action(false, true, Some(43), 42),
            CaptureAction::Capture
        );
        assert_eq!(
            capture_action(false, true, Some(42), 42),
            CaptureAction::Preserve
        );
        for pid in [None, Some(0)] {
            assert_eq!(capture_action(false, true, pid, 42), CaptureAction::Reject);
        }
        assert_eq!(
            capture_action(false, false, Some(42), 42),
            CaptureAction::Reject
        );
        assert_eq!(
            capture_action(true, false, Some(42), 42),
            CaptureAction::Capture
        );
    }

    fn target(surface: &str, window: u32) -> Arc<SurfaceTarget<u32>> {
        Arc::new(SurfaceTarget {
            surface: surface.to_string(),
            captured: Arc::new(window),
        })
    }

    #[test]
    fn inherited_window_is_a_snapshot_with_a_separate_surface_generation() {
        let source = target("launcher", 10);
        let mut registry = HashMap::from([("launcher".to_string(), source.clone())]);
        inherit_launcher_target_in(&mut registry, "history", "launcher", true).unwrap();
        let first_open = registry["history"].clone();
        assert_eq!(first_open.surface, "history");
        assert!(Arc::ptr_eq(&first_open.captured, &source.captured));
        assert!(is_current(&registry, &first_open));

        // Reopening the source must not redirect an already-open child.
        let next_source = target("launcher", 20);
        store_capture(&mut registry, "launcher", Ok(Some(next_source.clone()))).unwrap();
        assert!(!is_current(&registry, &source));
        assert!(is_current(&registry, &first_open));
        assert_eq!(*first_open.captured, 10);

        // Selecting an already-visible companion again is a new opening.
        inherit_launcher_target_in(&mut registry, "history", "launcher", true).unwrap();
        let second_open = registry["history"].clone();
        assert!(!is_current(&registry, &first_open));
        assert!(is_current(&registry, &second_open));
        assert!(Arc::ptr_eq(&second_open.captured, &next_source.captured));

        // Even repeated opens with the same source invalidate an in-flight paste.
        inherit_launcher_target_in(&mut registry, "history", "launcher", true).unwrap();
        assert!(!is_current(&registry, &second_open));
        let third_open = registry["history"].clone();
        registry.clear();
        assert!(!is_current(&registry, &third_open));
    }

    #[test]
    fn invalid_inheritance_removes_the_previous_destination_without_fallback() {
        for (caller, focused, has_source) in [
            ("launcher", true, false),
            ("launcher", false, true),
            ("main", true, true),
            ("quick-editor", true, true),
        ] {
            let old = target("history", 99);
            let mut registry = HashMap::from([("history".to_string(), old.clone())]);
            if has_source {
                registry.insert("launcher".to_string(), target("launcher", 10));
            }
            assert!(inherit_launcher_target_in(&mut registry, "history", caller, focused).is_err());
            assert!(!registry.contains_key("history"));
            assert!(!is_current(&registry, &old));
        }
        let mut registry = HashMap::from([("launcher".to_string(), target("launcher", 10))]);
        assert!(inherit_launcher_target_in(&mut registry, "launcher", "launcher", true).is_err());
        assert!(!registry.contains_key("launcher"));
    }

    #[test]
    fn failed_capture_clears_stale_target_but_hiven_return_keeps_its_identity() {
        let source = target("launcher", 10);
        let mut registry = HashMap::from([("launcher".to_string(), source.clone())]);
        store_capture(&mut registry, "launcher", Ok(None)).unwrap();
        assert!(is_current(&registry, &source));
        assert!(store_capture(&mut registry, "launcher", Err(error("unknown target"))).is_err());
        assert!(!registry.contains_key("launcher"));
        assert!(!is_current(&registry, &source));
    }

    #[test]
    fn inheritance_keeps_the_original_window_lifecycle_observer() {
        let source = Arc::new(SurfaceTarget {
            surface: "launcher".to_string(),
            captured: Arc::new(Cell::new(false)),
        });
        let mut registry = HashMap::from([("launcher".to_string(), source.clone())]);
        inherit_launcher_target_in(&mut registry, "history", "launcher", true).unwrap();
        source.captured.set(true);
        assert!(registry["history"].captured.get());
        // A later capture (including a reused native window ID) cannot replace
        // the old observer whose destruction flag has already been set.
        registry.insert(
            "launcher".to_string(),
            Arc::new(SurfaceTarget {
                surface: "launcher".to_string(),
                captured: Arc::new(Cell::new(false)),
            }),
        );
        assert!(registry["history"].captured.get());
    }

    #[test]
    fn completed_switch_only_releases_the_matching_surface_capture() {
        let old = target("launcher", 10);
        let other = target("history", 20);
        let newer = target("launcher", 30);
        let mut registry = HashMap::from([
            ("launcher".to_string(), old.clone()),
            ("history".to_string(), other.clone()),
        ]);
        remove_if_current(&mut registry, &old);
        assert!(!registry.contains_key("launcher"));
        assert!(is_current(&registry, &other));
        registry.insert("launcher".to_string(), newer.clone());
        remove_if_current(&mut registry, &old);
        assert!(is_current(&registry, &newer));
        assert!(is_current(&registry, &other));
    }

    #[test]
    fn only_explicit_x11_sessions_are_supported() {
        assert!(is_x11_session(Some("x11"), None));
        assert!(!is_x11_session(Some("wayland"), None));
        assert!(!is_x11_session(Some("x11"), Some("wayland-0")));
        assert!(!is_x11_session(None, None));
        assert!(!is_x11_session(Some("tty"), None));
    }

    #[test]
    fn maps_actual_control_modifier_and_unshifted_v() {
        assert_eq!(
            select_paste_keycodes(8, 2, &[0xffe3, 0, 0x76, 0x56], &[8]),
            Some((8, 9))
        );
        assert_eq!(
            select_paste_keycodes(8, 2, &[0xffe3, 0, 0x76, 0x56], &[12]),
            None
        );
        assert_eq!(
            select_paste_keycodes(8, 2, &[0xffe3, 0, 0x62, 0x76], &[8]),
            None
        );
        assert_eq!(select_paste_keycodes(8, 0, &[], &[8]), None);
    }
}
