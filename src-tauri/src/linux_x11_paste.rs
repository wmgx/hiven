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

pub(crate) struct PasteTarget {
    surface: String,
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
            if !is_confirmed_external_pid(pid, std::process::id()) {
                return Err(error(
                    "the global launcher target is not confirmed as an external process",
                ));
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
        Ok(Arc::new(PasteTarget {
            surface: surface.to_string(),
            session: Mutex::new(session),
            window,
        }))
    })();
    if let Ok(mut targets) = targets().lock() {
        targets.remove(surface);
        match captured {
            Ok(target) => {
                targets.insert(surface.to_string(), target);
            }
            Err(error) => log::debug!("Cannot remember Linux paste target: {error}"),
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

pub(crate) fn clear_targets() {
    if let Ok(mut targets) = targets().lock() {
        targets.clear();
    }
}

fn ensure_current(target: &Arc<PasteTarget>) -> PasteResult<()> {
    if targets()
        .lock()
        .map_err(error)?
        .get(&target.surface)
        .is_some_and(|current| Arc::ptr_eq(current, target))
    {
        Ok(())
    } else {
        Err(error("the surface was reopened or its target changed"))
    }
}

pub(crate) fn restore_and_paste(target: Arc<PasteTarget>) -> PasteResult<()> {
    let _paste_lock = PASTE_LOCK.lock().map_err(error)?;
    ensure_current(&target)?;
    let session = target.session.lock().map_err(error)?;
    session.ensure_alive(target.window)?;
    if !session.focused(target.window)? {
        session.request_activation(target.window)?;
    }
    let deadline = Instant::now() + Duration::from_millis(1200);
    let mut focused_since = None;
    loop {
        ensure_current(&target)?;
        session.ensure_alive(target.window)?;
        if session.focused(target.window)? && session.keyboard_idle()? {
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
    if !registry
        .get(&target.surface)
        .is_some_and(|current| Arc::ptr_eq(current, &target))
    {
        return Err(error("the surface was reopened or its target changed"));
    }
    // Keep the final verification and four events together. Other clients (the
    // WM included) cannot switch input focus between the check and the chord.
    // The server is ungrabbed before the target handles clipboard requests.
    let _server = ServerGrab::new(&session.connection)?;
    session.ensure_alive(target.window)?;
    if !session.focused(target.window)? || !session.keyboard_idle()? {
        return Err(error("the target or keyboard state changed before paste"));
    }
    let (control, v) = session.paste_keycodes()?;
    let mut keys = SyntheticKeys {
        connection: &session.connection,
        held: Vec::new(),
    };
    keys.press(control)?;
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
