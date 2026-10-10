//! Explicit, launcher-scoped X11 window switching. Enumeration owns one passive
//! connection; no background watcher, input injection, or window-management fallback.

use super::{DesktopWindow, DesktopWindowSearchRequest, DesktopWindowSearchSession};
use std::collections::{HashMap, HashSet};
use std::io::{self, IoSlice, Read};
use std::os::fd::AsRawFd;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use x11rb::connection::Connection;
use x11rb::protocol::xproto::{
    Atom, AtomEnum, ChangeWindowAttributesAux, ClientMessageEvent, ConnectionExt as _,
    EventMask, GetPropertyReply, MapState, Window,
};
use x11rb::protocol::Event;
use x11rb::rust_connection::{DefaultStream, PollMode, RustConnection, Stream};
use x11rb::utils::RawFdContainer;
use x11rb::{CURRENT_TIME, NONE};

const UNSUPPORTED: &str = "x11-window-unsupported";
const EXPIRED: &str = "x11-window-expired";
const UNAVAILABLE: &str = "x11-window-unavailable";
const FOCUS_FAILED: &str = "x11-window-focus-failed";
const MAX_CLIENTS: u32 = 256;
const MAX_TITLE_BYTES: u32 = 4096;
const MAX_CLASS_BYTES: u32 = 512;
const SNAPSHOT_TTL: Duration = Duration::from_secs(30);
const ACTIVATION_TIMEOUT: Duration = Duration::from_millis(400);

// x11rb's default poll waits indefinitely. Bound every socket wait (including
// replies and event draining), so an unresponsive WM/server cannot strand a
// focus lease or hold the session lock indefinitely. No timer thread is needed.
struct DeadlineStream {
    inner: DefaultStream,
    deadline: Mutex<Instant>,
}
type XConnection = RustConnection<DeadlineStream>;

impl DeadlineStream {
    fn remaining(&self) -> io::Result<Duration> {
        let deadline = *self.deadline.lock().map_err(|_| io::Error::other("deadline lock"))?;
        deadline.checked_duration_since(Instant::now())
            .ok_or_else(|| io::Error::new(io::ErrorKind::TimedOut, "X11 request deadline"))
    }
    fn budget(&self, duration: Duration) -> Result<(), String> {
        *self.deadline.lock().map_err(failure)? = Instant::now() + duration;
        Ok(())
    }
}
impl Stream for DeadlineStream {
    fn poll(&self, mode: PollMode) -> io::Result<()> {
        loop {
            let remaining = self.remaining()?;
            let mut fd = libc::pollfd { fd: self.inner.as_raw_fd(), events: 0, revents: 0 };
            if mode.readable() { fd.events |= libc::POLLIN; }
            if mode.writable() { fd.events |= libc::POLLOUT; }
            let timeout = remaining.as_millis().max(1).min(i32::MAX as u128) as i32;
            // The descriptor is borrowed from the live stream; poll only waits
            // for readiness and never changes the X server or window state.
            let result = unsafe { libc::poll(&mut fd, 1, timeout) };
            if result > 0 { return Ok(()); }
            if result == 0 { return Err(io::Error::new(io::ErrorKind::TimedOut, "X11 request deadline")); }
            let error = io::Error::last_os_error();
            if error.kind() != io::ErrorKind::Interrupted { return Err(error); }
        }
    }
    fn read(&self, buf: &mut [u8], fds: &mut Vec<RawFdContainer>) -> io::Result<usize> {
        self.remaining()?;
        self.inner.read(buf, fds)
    }
    fn write(&self, buf: &[u8], fds: &mut Vec<RawFdContainer>) -> io::Result<usize> {
        self.remaining()?;
        self.inner.write(buf, fds)
    }
    fn write_vectored(&self, bufs: &[IoSlice<'_>], fds: &mut Vec<RawFdContainer>) -> io::Result<usize> {
        self.remaining()?;
        self.inner.write_vectored(bufs, fds)
    }
}

fn connect() -> Result<(XConnection, usize), String> {
    use x11rb::reexports::x11rb_protocol::{parse_display, xauth};
    let display = parse_display::parse_display(None).map_err(|_| UNSUPPORTED.to_string())?;
    let screen = display.screen as usize;
    for address in display.connect_instruction() {
        let Ok((inner, (family, address))) = DefaultStream::connect(&address) else { continue; };
        let (auth_name, auth_data) = xauth::get_auth(family, &address, display.display)
            .unwrap_or(None).unwrap_or_default();
        let stream = DeadlineStream { inner, deadline: Mutex::new(Instant::now() + Duration::from_secs(2)) };
        let connection = RustConnection::connect_to_stream_with_auth_info(stream, screen, auth_name, auth_data)
            .map_err(|_| UNSUPPORTED.to_string())?;
        return Ok((connection, screen));
    }
    Err(UNSUPPORTED.into())
}

#[derive(Default)]
struct Registry {
    instance: u64,
    session: u64,
    open_epoch: u64,
    revision: u64,
    active: bool,
    resume_on_focus: bool,
    snapshot: Option<Arc<Mutex<Snapshot>>>,
}

impl Registry {
    fn advance(&mut self, active: bool) {
        self.session = self.session.wrapping_add(1).max(1);
        self.revision = self.revision.wrapping_add(1);
        self.active = active;
        self.resume_on_focus = false;
        self.snapshot = None;
    }

    fn blur(&mut self, instance: u64) {
        if self.instance == instance && (self.active || self.resume_on_focus) {
            self.advance(false);
            // A visible launcher may remain open behind a companion surface.
            // Only this kind of revocation can be resumed by a real focus gain.
            self.resume_on_focus = true;
        }
    }

    fn regain_focus(&mut self, instance: u64, visible: bool, focused: bool) {
        if self.instance == instance && self.resume_on_focus && visible && focused {
            self.open_epoch = self.open_epoch.wrapping_add(1);
            self.advance(true);
        }
    }

    fn can_publish(&self, request: &DesktopWindowSearchRequest, revision: u64) -> bool {
        self.accepts(request) && self.revision == revision
    }

    fn accepts(&self, request: &DesktopWindowSearchRequest) -> bool {
        request.explicit && self.active && request.session == self.session
            && request.instance == self.instance
    }
}

static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();
fn registry() -> &'static Mutex<Registry> {
    REGISTRY.get_or_init(|| Mutex::new(Registry::default()))
}
fn failure(_: impl std::fmt::Display) -> String { UNAVAILABLE.into() }

pub(crate) fn register_launcher() -> u64 {
    let mut state = registry().lock().unwrap_or_else(|error| error.into_inner());
    state.instance = state.instance.wrapping_add(1).max(1);
    state.advance(false);
    state.instance
}

pub(crate) fn opening() {
    let mut state = registry().lock().unwrap_or_else(|error| error.into_inner());
    state.open_epoch = state.open_epoch.wrapping_add(1);
    state.advance(false);
}

pub(crate) fn opened() {
    let mut state = registry().lock().unwrap_or_else(|error| error.into_inner());
    state.open_epoch = state.open_epoch.wrapping_add(1);
    state.advance(true);
}

pub(crate) fn closed(instance: Option<u64>) {
    let mut state = registry().lock().unwrap_or_else(|error| error.into_inner());
    if instance.is_none() || instance == Some(state.instance) {
        state.advance(false);
    }
}

pub(crate) fn blurred(instance: u64) {
    if let Ok(mut state) = registry().lock() { state.blur(instance); }
}

pub(crate) fn regained_focus(instance: u64, visible: bool, focused: bool) {
    if let Ok(mut state) = registry().lock() { state.regain_focus(instance, visible, focused); }
}

pub(crate) fn session() -> Result<DesktopWindowSearchSession, String> {
    let state = registry().lock().map_err(failure)?;
    if !state.active || state.instance == 0 { return Err(EXPIRED.into()); }
    Ok(DesktopWindowSearchSession { session: state.session, instance: state.instance })
}

pub(crate) fn release(request: &DesktopWindowSearchRequest) -> Result<(), String> {
    let mut state = registry().lock().map_err(failure)?;
    if state.accepts(request) { state.advance(true); }
    Ok(())
}

fn is_x11_session(session_type: Option<&str>, wayland: Option<&str>) -> bool {
    session_type.is_some_and(|value| value.eq_ignore_ascii_case("x11"))
        && !wayland.is_some_and(|value| !value.is_empty())
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Identity { xid: Window, pid: u32, class: Vec<u8> }

struct Candidate {
    identity: Identity,
    title: String,
    app_name: String,
    width: u16,
    height: u16,
}

struct Atoms {
    client_list: Atom,
    active: Atom,
    supported: Atom,
    wm_check: Atom,
    pid: Atom,
    name: Atom,
    utf8: Atom,
    window_type: Atom,
    normal: Atom,
    state: Atom,
    hidden: Atom,
    skip_taskbar: Atom,
    skip_pager: Atom,
    desktop: Atom,
    current_desktop: Atom,
    wm_state: Atom,
}

struct Snapshot {
    connection: XConnection,
    root: Window,
    wm: Window,
    atoms: Atoms,
    destroyed: HashSet<Window>,
    targets: HashMap<String, Identity>,
    created: Instant,
}

impl Snapshot {
    fn connect() -> Result<Self, String> {
        if !is_x11_session(
            std::env::var("XDG_SESSION_TYPE").ok().as_deref(),
            std::env::var("WAYLAND_DISPLAY").ok().as_deref(),
        ) { return Err(UNSUPPORTED.into()); }
        let (connection, screen) = connect()?;
        let root = connection.setup().roots[screen].root;
        let atom = |name: &[u8]| -> Result<Atom, String> {
            Ok(connection.intern_atom(true, name).map_err(failure)?.reply().map_err(failure)?.atom)
        };
        let atoms = Atoms {
            client_list: atom(b"_NET_CLIENT_LIST")?, active: atom(b"_NET_ACTIVE_WINDOW")?,
            supported: atom(b"_NET_SUPPORTED")?, wm_check: atom(b"_NET_SUPPORTING_WM_CHECK")?,
            pid: atom(b"_NET_WM_PID")?, name: atom(b"_NET_WM_NAME")?, utf8: atom(b"UTF8_STRING")?,
            window_type: atom(b"_NET_WM_WINDOW_TYPE")?, normal: atom(b"_NET_WM_WINDOW_TYPE_NORMAL")?,
            state: atom(b"_NET_WM_STATE")?, hidden: atom(b"_NET_WM_STATE_HIDDEN")?,
            skip_taskbar: atom(b"_NET_WM_STATE_SKIP_TASKBAR")?, skip_pager: atom(b"_NET_WM_STATE_SKIP_PAGER")?,
            desktop: atom(b"_NET_WM_DESKTOP")?, current_desktop: atom(b"_NET_CURRENT_DESKTOP")?,
            wm_state: atom(b"WM_STATE")?,
        };
        if [atoms.client_list, atoms.active, atoms.supported, atoms.wm_check, atoms.pid,
            atoms.window_type, atoms.normal, atoms.state, atoms.desktop, atoms.current_desktop]
            .contains(&NONE) { return Err(UNSUPPORTED.into()); }
        let wm = property_scalar(&connection, root, atoms.wm_check, AtomEnum::WINDOW)?
            .filter(|value| *value != NONE).ok_or_else(|| UNSUPPORTED.to_string())?;
        let mut snapshot = Self {
            connection, root, wm, atoms, destroyed: HashSet::new(), targets: HashMap::new(),
            created: Instant::now(),
        };
        snapshot.observe(wm)?;
        snapshot.ensure_wm()?;
        snapshot.drain_destroyed()?;
        if snapshot.destroyed.contains(&wm) { return Err(UNSUPPORTED.into()); }
        Ok(snapshot)
    }

    fn observe(&self, xid: Window) -> Result<(), String> {
        self.connection.change_window_attributes(xid,
            &ChangeWindowAttributesAux::new().event_mask(EventMask::STRUCTURE_NOTIFY))
            .map_err(failure)?.check().map_err(failure)
    }

    fn ensure_wm(&self) -> Result<(), String> {
        if self.destroyed.contains(&self.wm)
            || property_scalar(&self.connection, self.root, self.atoms.wm_check, AtomEnum::WINDOW)? != Some(self.wm)
            || property_scalar(&self.connection, self.wm, self.atoms.wm_check, AtomEnum::WINDOW)? != Some(self.wm)
        { return Err(UNSUPPORTED.into()); }
        let supported = property_u32(&self.connection, self.root, self.atoms.supported, AtomEnum::ATOM, 1024)?;
        if ![self.atoms.client_list, self.atoms.active, self.atoms.desktop, self.atoms.current_desktop]
            .iter().all(|atom| supported.contains(atom)) { return Err(UNSUPPORTED.into()); }
        Ok(())
    }

    fn drain_destroyed(&mut self) -> Result<(), String> {
        // Consume the whole queue, not only the selected target's first event.
        // A destroyed XID stays tombstoned for this connection's entire lifetime.
        drain_events(|| self.connection.poll_for_event().map_err(failure),
            &mut self.destroyed, &mut self.targets)
    }

    fn desktop(&self) -> Result<u32, String> {
        property_scalar(&self.connection, self.root, self.atoms.current_desktop, AtomEnum::CARDINAL)?
            .ok_or_else(|| UNSUPPORTED.to_string())
    }

    fn candidate(&self, xid: Window, desktop: u32) -> Result<Candidate, String> {
        if xid == NONE || xid == self.root || xid == self.wm || self.destroyed.contains(&xid) {
            return Err(UNAVAILABLE.into());
        }
        let attrs = self.connection.get_window_attributes(xid).map_err(failure)?.reply().map_err(failure)?;
        let geometry = self.connection.get_geometry(xid).map_err(failure)?.reply().map_err(failure)?;
        let pid = property_scalar(&self.connection, xid, self.atoms.pid, AtomEnum::CARDINAL)?
            .ok_or_else(|| UNAVAILABLE.to_string())?;
        let types = property_u32(&self.connection, xid, self.atoms.window_type, AtomEnum::ATOM, 16)?;
        let states = property_u32(&self.connection, xid, self.atoms.state, AtomEnum::ATOM, 64)?;
        let window_desktop = property_scalar(&self.connection, xid, self.atoms.desktop, AtomEnum::CARDINAL)?;
        let wm_state = if self.atoms.wm_state == NONE { None } else {
            property_u32(&self.connection, xid, self.atoms.wm_state, self.atoms.wm_state, 2)?.first().copied()
        };
        if !eligible_window(pid, std::process::id(), attrs.override_redirect,
            attrs.map_state == MapState::VIEWABLE, geometry.width, geometry.height,
            &types, self.atoms.normal, &states,
            &[self.atoms.hidden, self.atoms.skip_taskbar, self.atoms.skip_pager],
            wm_state, window_desktop, desktop) { return Err(UNAVAILABLE.into()); }
        let class = property_bytes(&self.connection, xid, AtomEnum::WM_CLASS.into(), AtomEnum::STRING.into(), MAX_CLASS_BYTES)?;
        let app_name = class_name(&class).ok_or_else(|| UNAVAILABLE.to_string())?;
        if system_class(&class) { return Err(UNAVAILABLE.into()); }
        let title = self.title(xid).filter(|title| !title.is_empty()).unwrap_or_else(|| app_name.clone());
        Ok(Candidate { identity: Identity { xid, pid, class }, title, app_name,
            width: geometry.width, height: geometry.height })
    }

    fn title(&self, xid: Window) -> Option<String> {
        if self.atoms.name != NONE && self.atoms.utf8 != NONE {
            if let Ok(bytes) = property_bytes(&self.connection, xid, self.atoms.name, self.atoms.utf8, MAX_TITLE_BYTES) {
                let title = clean_text(&String::from_utf8_lossy(&bytes));
                if !title.is_empty() { return Some(title); }
            }
        }
        // ICCCM WM_NAME's STRING is Latin-1; never treat its bytes as a shell command.
        let bytes = property_bytes(&self.connection, xid, AtomEnum::WM_NAME.into(), AtomEnum::STRING.into(), MAX_TITLE_BYTES).ok()?;
        Some(clean_text(&bytes.iter().map(|byte| char::from(*byte)).collect::<String>()))
    }

    fn enumerate(&mut self) -> Result<Vec<DesktopWindow>, String> {
        let desktop = self.desktop()?;
        let clients = property_u32(&self.connection, self.root, self.atoms.client_list, AtomEnum::WINDOW, MAX_CLIENTS)?;
        let mut seen = HashSet::new();
        let mut windows = Vec::new();
        for xid in clients {
            if !seen.insert(xid) { continue; }
            // Observe before reading any identity, then round-trip and drain again.
            // This closes the enumerate/subscribe gap when a numeric XID is reused.
            if self.observe(xid).is_err() { continue; }
            let candidate = self.candidate(xid, desktop);
            self.drain_destroyed()?;
            let Ok(candidate) = candidate else { continue; };
            if self.destroyed.contains(&xid) { continue; }
            let token = opaque_token()?;
            windows.push(DesktopWindow { id: token.clone(), app_name: candidate.app_name,
                title: candidate.title, pid: candidate.identity.pid, app_id: None,
                x: None, y: None, width: Some(f64::from(candidate.width)), height: Some(f64::from(candidate.height)) });
            self.targets.insert(token, candidate.identity);
        }
        // Do not publish results collected while the WM or workspace changed.
        self.ensure_wm()?;
        if self.desktop()? != desktop { return Err(UNAVAILABLE.into()); }
        self.drain_destroyed()?;
        if self.destroyed.contains(&self.wm) { return Err(UNSUPPORTED.into()); }
        windows.retain(|window| self.targets.contains_key(&window.id));
        Ok(windows)
    }

    fn validate(&mut self, identity: &Identity) -> Result<(), String> {
        self.ensure_wm()?;
        let candidate = self.candidate(identity.xid, self.desktop()?);
        // The preceding replies order all earlier server DestroyNotify events.
        self.drain_destroyed()?;
        if self.destroyed.contains(&self.wm) { return Err(UNSUPPORTED.into()); }
        if self.destroyed.contains(&identity.xid) || candidate?.identity != *identity {
            return Err(UNAVAILABLE.into());
        }
        // Require current EWMH membership as well as the captured identity.
        let clients = property_u32(&self.connection, self.root, self.atoms.client_list, AtomEnum::WINDOW, MAX_CLIENTS)?;
        self.drain_destroyed()?;
        if !clients.contains(&identity.xid) || self.destroyed.contains(&identity.xid)
            || self.destroyed.contains(&self.wm) { return Err(UNAVAILABLE.into()); }
        Ok(())
    }

    fn active(&self) -> Result<Option<Window>, String> {
        let reply = property(&self.connection, self.root, self.atoms.active, AtomEnum::WINDOW.into(), 2)?;
        active_window_from_reply(&reply)
    }

    fn focused(&self, target: Window) -> Result<bool, String> {
        if self.active()? != Some(target) { return Ok(false); }
        let focus = self.connection.get_input_focus().map_err(failure)?.reply().map_err(failure)?.focus;
        input_focus_matches(target, self.root, focus, |window| {
            Ok(self.connection.query_tree(window).map_err(failure)?.reply().map_err(failure)?.parent)
        })
    }
}

fn input_focus_matches(target: Window, root: Window, mut focus: Window,
    mut parent: impl FnMut(Window) -> Result<Window, String>) -> Result<bool, String> {
    for _ in 0..64 {
        if focus == target { return Ok(true); }
        if focus == NONE || focus == 1 || focus == root { return Ok(false); }
        focus = parent(focus)?;
    }
    Ok(false)
}

fn drain_events(mut next: impl FnMut() -> Result<Option<Event>, String>,
    destroyed: &mut HashSet<Window>, targets: &mut HashMap<String, Identity>) -> Result<(), String> {
    while let Some(event) = next()? {
        if let Event::DestroyNotify(event) = event { destroyed.insert(event.window); }
    }
    targets.retain(|_, identity| !destroyed.contains(&identity.xid));
    Ok(())
}

fn property(connection: &XConnection, window: Window, name: Atom, type_: Atom, limit: u32) -> Result<GetPropertyReply, String> {
    if name == NONE || type_ == NONE { return Err(UNAVAILABLE.into()); }
    connection.get_property(false, window, name, type_, 0, limit).map_err(failure)?.reply().map_err(failure)
}
fn property_u32(connection: &XConnection, window: Window, name: Atom, type_: impl Into<Atom>, limit: u32) -> Result<Vec<u32>, String> {
    let type_ = type_.into();
    let reply = property(connection, window, name, type_, limit)?;
    if reply.type_ == NONE { return Ok(Vec::new()); }
    if reply.type_ != type_ || reply.format != 32 { return Err(UNAVAILABLE.into()); }
    let values = reply.value32().ok_or_else(|| UNAVAILABLE.to_string())?.take(limit as usize).collect();
    Ok(values)
}
// EWMH defines one WINDOW/32 active value. Some desktops additionally publish
// a trailing None word, observed in the X11 fixture. Accept only that exact,
// unambiguous compatibility shape; ordinary scalar identity properties stay strict.
fn active_window_from_reply(reply: &GetPropertyReply) -> Result<Option<Window>, String> {
    if reply.type_ == NONE && reply.format == 0 && reply.bytes_after == 0 && reply.value.is_empty() {
        return Ok(None);
    }
    if reply.type_ != u32::from(AtomEnum::WINDOW) || reply.format != 32 || reply.bytes_after != 0
        || !matches!(reply.value.len(), 4 | 8) {
        return Err(UNAVAILABLE.into());
    }
    let values = reply.value32().ok_or_else(|| UNAVAILABLE.to_string())?.collect::<Vec<_>>();
    match values.as_slice() {
        [window] | [window, 0] => Ok((*window != NONE).then_some(*window)),
        _ => Err(UNAVAILABLE.into()),
    }
}

fn property_scalar(connection: &XConnection, window: Window, name: Atom, type_: impl Into<Atom>) -> Result<Option<u32>, String> {
    let type_ = type_.into();
    let reply = property(connection, window, name, type_, 1)?;
    if reply.type_ == NONE { return Ok(None); }
    if reply.type_ != type_ || reply.format != 32 || reply.bytes_after != 0 || reply.value.len() != 4 {
        return Err(UNAVAILABLE.into());
    }
    Ok(reply.value32().and_then(|mut values| values.next()))
}
fn property_bytes(connection: &XConnection, window: Window, name: Atom, type_: Atom, max_bytes: u32) -> Result<Vec<u8>, String> {
    let reply = property(connection, window, name, type_, max_bytes.div_ceil(4))?;
    if reply.type_ != type_ || reply.format != 8 || reply.bytes_after != 0 || reply.value.len() > max_bytes as usize {
        return Err(UNAVAILABLE.into());
    }
    Ok(reply.value)
}

fn clean_text(value: &str) -> String {
    value.chars().map(|ch| if ch.is_control() { ' ' } else { ch }).collect::<String>().trim().to_string()
}
fn class_name(class: &[u8]) -> Option<String> {
    let mut parts = class.split(|byte| *byte == 0);
    let instance = parts.next()?;
    let name = parts.next().filter(|name| !name.is_empty()).unwrap_or(instance);
    let name = clean_text(&String::from_utf8_lossy(name));
    (!name.is_empty()).then_some(name)
}
fn system_class(class: &[u8]) -> bool {
    class.split(|byte| *byte == 0).any(|part| {
        let value = String::from_utf8_lossy(part).to_ascii_lowercase();
        matches!(value.as_str(), "hiven" | "gnome-shell" | "plasmashell" | "kwin" | "kwin_x11"
            | "xfdesktop" | "xfce4-panel" | "lxpanel" | "mate-panel" | "cinnamon" | "desktop_window")
    })
}
#[allow(clippy::too_many_arguments)]
fn eligible_window(pid: u32, own_pid: u32, override_redirect: bool, viewable: bool,
    width: u16, height: u16, types: &[Atom], normal: Atom, states: &[Atom], blocked: &[Atom],
    wm_state: Option<u32>, desktop: Option<u32>, current_desktop: u32) -> bool {
    pid > 0 && pid <= i32::MAX as u32 && pid != own_pid && !override_redirect && viewable
        && width > 0 && height > 0 && !types.is_empty() && types.iter().all(|atom| *atom == normal)
        && !states.iter().any(|atom| blocked.contains(atom)) && wm_state != Some(3)
        // A workspace switch is never part of focusing a search result.
        && desktop == Some(current_desktop)
}
fn opaque_token() -> Result<String, String> {
    let mut random = [0u8; 16];
    std::fs::File::open("/dev/urandom").map_err(failure)?.read_exact(&mut random).map_err(failure)?;
    Ok(format!("x11:{}", random.iter().map(|byte| format!("{byte:02x}")).collect::<String>()))
}

pub(crate) fn list(request: DesktopWindowSearchRequest) -> Result<Vec<DesktopWindow>, String> {
    let revision = {
        let mut state = registry().lock().map_err(failure)?;
        if !state.accepts(&request) { return Err(EXPIRED.into()); }
        state.revision = state.revision.wrapping_add(1);
        state.snapshot = None;
        state.revision
    };
    let mut snapshot = Snapshot::connect()?;
    let windows = snapshot.enumerate()?;
    let mut state = registry().lock().map_err(failure)?;
    if !state.can_publish(&request, revision) { return Err(EXPIRED.into()); }
    state.snapshot = Some(Arc::new(Mutex::new(snapshot)));
    Ok(windows)
}

pub(crate) fn focus(id: &str, request: DesktopWindowSearchRequest, clear_previous: impl FnOnce()) -> Result<(), String> {
    let (lease, open_epoch) = {
        let state = registry().lock().map_err(failure)?;
        if !state.accepts(&request) { return Err(EXPIRED.into()); }
        (state.snapshot.clone().ok_or_else(|| EXPIRED.to_string())?, state.open_epoch)
    };
    let mut snapshot = lease.lock().map_err(failure)?;
    if snapshot.created.elapsed() > SNAPSHOT_TTL {
        release(&request)?;
        return Err(EXPIRED.into());
    }
    snapshot.connection.stream().budget(Duration::from_millis(500))?;
    let identity = snapshot.targets.get(id).cloned().ok_or_else(|| EXPIRED.to_string())?;
    snapshot.validate(&identity)?;
    let previous = snapshot.active()?.unwrap_or(NONE);
    snapshot.drain_destroyed()?;
    if snapshot.destroyed.contains(&identity.xid) || snapshot.destroyed.contains(&snapshot.wm) {
        return Err(UNAVAILABLE.into());
    }
    {
        let mut state = registry().lock().map_err(failure)?;
        if !state.accepts(&request) || !state.snapshot.as_ref().is_some_and(|current| Arc::ptr_eq(current, &lease)) {
            return Err(EXPIRED.into());
        }
        // Send exactly once, serialized with close/reopen invalidation. The WM
        // decides activation. Never use SetInputFocus, raise, move, or switch desktop.
        snapshot.connection.stream().budget(ACTIVATION_TIMEOUT)?;
        let event = ClientMessageEvent::new(32, identity.xid, snapshot.atoms.active,
            [2, CURRENT_TIME, previous, 0, 0]);
        snapshot.connection.send_event(false, snapshot.root,
            EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY, event)
            .map_err(failure)?.check().map_err(failure)?;
        snapshot.connection.flush().map_err(failure)?;
        // The in-flight lease can finish confirming activation after normal blur
        // closes the launcher; no later invocation can use this snapshot again.
        state.snapshot = None;
    }
    let deadline = Instant::now() + ACTIVATION_TIMEOUT;
    loop {
        snapshot.validate(&identity)?;
        let focused = snapshot.focused(identity.xid)?;
        snapshot.drain_destroyed()?;
        if snapshot.destroyed.contains(&identity.xid) || snapshot.destroyed.contains(&snapshot.wm) {
            return Err(UNAVAILABLE.into());
        }
        if focused {
            let state = registry().lock().map_err(failure)?;
            // An old successful focus must never clear a new launcher's paste target.
            if state.instance == request.instance && state.open_epoch == open_epoch { clear_previous(); }
            return Ok(());
        }
        if Instant::now() >= deadline { return Err(FOCUS_FAILED.into()); }
        std::thread::sleep(Duration::from_millis(15));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(state: &Registry) -> DesktopWindowSearchRequest {
        DesktopWindowSearchRequest { explicit: true, session: state.session, instance: state.instance }
    }

    #[test]
    fn requires_confirmed_x11_and_rejects_xwayland() {
        assert!(is_x11_session(Some("x11"), None));
        assert!(is_x11_session(Some("X11"), Some("")));
        assert!(!is_x11_session(None, None));
        assert!(!is_x11_session(Some("wayland"), None));
        assert!(!is_x11_session(Some("x11"), Some("wayland-0")));
    }

    #[test]
    fn old_session_and_instance_cannot_publish_or_focus_after_close_reopen() {
        let mut state = Registry { instance: 8, ..Registry::default() };
        state.advance(true);
        let old = request(&state);
        assert!(state.accepts(&old));
        assert!(!state.accepts(&DesktopWindowSearchRequest { explicit: false, ..old }));
        state.advance(false);
        assert!(!state.accepts(&old));
        state.advance(true);
        assert!(!state.accepts(&old));
        let current = request(&state);
        // Releasing the old scope cannot invalidate the current one.
        if state.accepts(&old) { state.advance(true); }
        assert!(state.accepts(&current));
        state.instance += 1;
        assert!(!state.accepts(&current));
    }

    #[test]
    fn filters_unsafe_window_states_and_other_workspaces() {
        let eligible = |pid, override_redirect, visible, width, types: &[u32], states: &[u32], wm_state, desktop| {
            eligible_window(pid, 100, override_redirect, visible, width, 200, types, 10,
                states, &[11, 12, 13], wm_state, desktop, 2)
        };
        assert!(eligible(101, false, true, 300, &[10], &[], Some(1), Some(2)));
        for pid in [0, 100, u32::MAX] { assert!(!eligible(pid, false, true, 300, &[10], &[], None, Some(2))); }
        assert!(!eligible(101, true, true, 300, &[10], &[], None, Some(2)));
        assert!(!eligible(101, false, false, 300, &[10], &[], None, Some(2)));
        assert!(!eligible(101, false, true, 0, &[10], &[], None, Some(2)));
        for types in [&[][..], &[20][..], &[10, 20][..]] { assert!(!eligible(101, false, true, 300, types, &[], None, Some(2))); }
        for atom in [11, 12, 13] { assert!(!eligible(101, false, true, 300, &[10], &[atom], None, Some(2))); }
        assert!(!eligible(101, false, true, 300, &[10], &[], Some(3), Some(2)));
        for desktop in [None, Some(1), Some(u32::MAX)] { assert!(!eligible(101, false, true, 300, &[10], &[], None, desktop)); }
    }

    #[test]
    fn identity_is_window_pid_and_raw_class_never_title() {
        let first = Identity { xid: 20, pid: 55, class: b"editor\0Editor\0".to_vec() };
        assert_ne!(first, Identity { xid: 21, ..first.clone() });
        assert_ne!(first, Identity { pid: 56, ..first.clone() });
        assert_ne!(first, Identity { class: b"editor\0Replacement\0".to_vec(), ..first.clone() });
        assert_eq!(class_name(&first.class).as_deref(), Some("Editor"));
        assert!(system_class(b"panel\0Gnome-shell\0"));
        assert!(system_class(b"hiven\0Other\0"));
        assert!(!system_class(&first.class));
        assert_eq!(clean_text("  文档\nTitle\0 "), "文档 Title");
    }


    #[test]
    fn visible_refocus_renews_blurred_scope_but_never_revives_hidden_or_old_instance() {
        let mut state = Registry { instance: 3, ..Registry::default() };
        state.advance(true);
        let old = request(&state);
        state.blur(3);
        assert!(!state.accepts(&old));
        assert!(state.resume_on_focus);
        state.regain_focus(2, true, true);
        state.regain_focus(3, false, true);
        state.regain_focus(3, true, false);
        assert!(!state.active);
        state.regain_focus(3, true, true);
        assert!(state.active);
        assert!(!state.accepts(&old));
        assert!(state.accepts(&request(&state)));
        state.blur(3);
        state.advance(false); // An actual hide/close cancels refocus permission.
        state.regain_focus(3, true, true);
        assert!(!state.active);
        state.blur(3); // A late blur cannot re-arm a closed window either.
        state.regain_focus(3, true, true);
        assert!(!state.active);
        state.advance(true);
        state.blur(2); // Old window callbacks cannot revoke the new instance.
        assert!(state.active);
    }

    #[test]
    fn late_list_cannot_replace_newer_snapshot_or_reopen_closed_session() {
        let mut state = Registry { instance: 1, ..Registry::default() };
        state.advance(true);
        let old = request(&state);
        let revision = state.revision;
        assert!(state.can_publish(&old, revision));
        state.revision += 1;
        assert!(!state.can_publish(&old, revision));
        state.advance(false);
        assert!(!state.can_publish(&old, state.revision));
        state.advance(true);
        assert!(!state.can_publish(&old, state.revision));
    }

    #[test]
    fn consumes_all_destroy_events_and_tombstones_same_identity_xid_reuse() {
        use std::collections::VecDeque;
        use x11rb::protocol::xproto::{DestroyNotifyEvent, DESTROY_NOTIFY_EVENT};
        let identity = Identity { xid: 9001, pid: 55, class: b"same\0Same\0".to_vec() };
        let mut targets = HashMap::from([("x11:token".to_string(), identity.clone())]);
        let mut destroyed = HashSet::new();
        let mut events = (1..=5000).chain([9001, 9999]).map(|window| {
            Event::DestroyNotify(DestroyNotifyEvent { response_type: DESTROY_NOTIFY_EVENT,
                sequence: 0, event: window, window })
        }).collect::<VecDeque<_>>();
        drain_events(|| Ok(events.pop_front()), &mut destroyed, &mut targets).unwrap();
        assert!(events.is_empty());
        assert!(targets.is_empty());
        assert!(destroyed.contains(&9001));
        assert!(destroyed.contains(&9999)); // WM destruction is retained too.
        // A replacement with the same PID and WM_CLASS still has a dead XID.
        targets.insert("x11:new-token".into(), identity);
        drain_events(|| Ok(None), &mut destroyed, &mut targets).unwrap();
        assert!(targets.is_empty());
    }

    #[test]
    fn socket_deadline_fails_without_waiting_for_server() {
        use std::os::unix::net::UnixStream;
        let (socket, _peer) = UnixStream::pair().unwrap();
        let (inner, _) = DefaultStream::from_unix_stream(socket).unwrap();
        let stream = DeadlineStream { inner, deadline: Mutex::new(Instant::now() + Duration::from_millis(10)) };
        let started = Instant::now();
        assert_eq!(stream.poll(PollMode::Readable).unwrap_err().kind(), io::ErrorKind::TimedOut);
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn focus_confirmation_accepts_only_target_or_its_bounded_descendants() {
        assert!(input_focus_matches(20, 5, 20, |_| panic!("direct target")).unwrap());
        assert!(input_focus_matches(20, 5, 30, |_| Ok(20)).unwrap());
        assert!(!input_focus_matches(20, 5, 30, |_| Ok(5)).unwrap());
        for focus in [NONE, 1, 5] {
            assert!(!input_focus_matches(20, 5, focus, |_| panic!("sentinel focus")).unwrap());
        }
        let mut calls = 0;
        assert!(!input_focus_matches(20, 5, 30, |window| { calls += 1; Ok(window) }).unwrap());
        assert_eq!(calls, 64);
    }

    #[test]
    fn active_window_accepts_only_single_value_or_one_trailing_none_word() {
        let reply = |values: &[u32]| GetPropertyReply {
            format: 32, sequence: 0, length: values.len() as u32,
            type_: AtomEnum::WINDOW.into(), bytes_after: 0, value_len: values.len() as u32,
            value: values.iter().flat_map(|value| value.to_ne_bytes()).collect(),
        };
        assert_eq!(active_window_from_reply(&reply(&[42])).unwrap(), Some(42));
        assert_eq!(active_window_from_reply(&reply(&[0])).unwrap(), None);
        // Actual desktop regression: WINDOW/32 [active, None], eight bytes.
        assert_eq!(active_window_from_reply(&reply(&[42, 0])).unwrap(), Some(42));
        assert_eq!(active_window_from_reply(&reply(&[0, 0])).unwrap(), None);
        for values in [&[][..], &[42, 43][..], &[42, 42][..], &[42, 0, 0][..]] {
            assert!(active_window_from_reply(&reply(values)).is_err());
        }
        let mut invalid = reply(&[42]);
        invalid.bytes_after = 4; // A limit-one read must not silently ignore trailing data.
        assert!(active_window_from_reply(&invalid).is_err());
        invalid.bytes_after = 0;
        invalid.type_ = AtomEnum::CARDINAL.into();
        assert!(active_window_from_reply(&invalid).is_err());
        invalid.type_ = AtomEnum::WINDOW.into();
        invalid.format = 8;
        assert!(active_window_from_reply(&invalid).is_err());
        let absent = GetPropertyReply { format: 0, type_: NONE, value: Vec::new(), value_len: 0, ..reply(&[]) };
        assert_eq!(active_window_from_reply(&absent).unwrap(), None);
    }

    #[test]
    fn tokens_do_not_embed_identity_and_are_distinct() {
        let first = opaque_token().unwrap();
        let second = opaque_token().unwrap();
        assert!(first.starts_with("x11:"));
        assert_eq!(first.len(), 36);
        assert_ne!(first, second);
    }
}
