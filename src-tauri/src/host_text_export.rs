//! Save a frozen host text snapshot through a native-owned, one-shot lease.
//! Root snapshots and surface text share the same native lease/write kernel.
//! Only a safe suggested basename crosses the surface API; destinations never do.
//! Launcher lifetime changes revoke pending leases; an accepted commit owns its
//! write until completion and must still report the actual result after close.

use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Manager, Resource, ResourceId, ResourceTable};
use tauri_plugin_dialog::DialogExt;

const MAX_TEXT_BYTES: usize = 1024 * 1024;
const MAX_SURFACE_TEXT_BYTES: usize = 10 * 1024 * 1024;
const MAX_PENDING_EXPORTS: usize = 4;
const MAX_SURFACE_OWNERS: usize = 64;
const PREPARED_TTL: Duration = Duration::from_secs(5 * 60);
const UNAVAILABLE: &str = "TEXT_EXPORT_UNAVAILABLE";
const INVALID_LEASE: &str = "TEXT_EXPORT_INVALID_LEASE";
const WRITE_FAILED: &str = "TEXT_EXPORT_WRITE_FAILED";

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceTextExportOwnerResult {
    owner_token: ResourceId,
}

struct SurfaceTextExportOwner {
    owner_id: String,
    launcher_session: Option<u64>,
    surface_window_token: Option<u64>,
    registered_at: Instant,
}

impl Resource for SurfaceTextExportOwner {}

// One hook per actual webview, including dynamically created editor windows.
struct SurfaceTextExportLifecycle;
impl Resource for SurfaceTextExportLifecycle {}

#[derive(Clone)]
struct SurfaceOwnerBinding {
    token: ResourceId,
    owner: Arc<SurfaceTextExportOwner>,
}

#[derive(Debug, serde::Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum PrepareHostTextExportResult {
    Cancelled,
    Prepared {
        #[serde(rename = "exportId")]
        export_id: ResourceId,
    },
}

#[derive(Debug, serde::Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum CommitHostTextExportResult {
    Saved,
}

#[derive(Debug)]
struct PreparedTextExport {
    destination: PathBuf,
    bytes: Vec<u8>,
    prepared_at: Instant,
}

#[derive(Default)]
struct LeaseState {
    invalidated: bool,
    // None while the OS dialog is open. Invalidated dialogs retain their slot
    // until they settle, so repeated close/open cannot spawn unlimited dialogs.
    prepared: Option<PreparedTextExport>,
}

#[derive(Default)]
struct HostTextExportLease {
    // None is exclusively the original launcher/root-material API.
    owner: Option<SurfaceOwnerBinding>,
    state: Mutex<LeaseState>,
}

impl Resource for HostTextExportLease {}

fn text_bytes(text: String) -> Result<Vec<u8>, String> {
    bounded_text_bytes(text, MAX_TEXT_BYTES)
}

fn bounded_text_bytes(text: String, limit: usize) -> Result<Vec<u8>, String> {
    if text.len() > limit {
        return Err("TEXT_EXPORT_TOO_LARGE".into());
    }
    // Empty and whitespace-only strings are deliberate snapshots, too.
    Ok(text.into_bytes())
}

fn require_surface_window(label: &str) -> Result<(), String> {
    let supported = label == "launcher"
        || label == "editor"
        || label.strip_prefix("editor:").is_some_and(|id| {
            !id.is_empty() && !id.chars().any(|ch| ch.is_control() || ch == ':')
        })
        || label.strip_prefix("plugin-surface:").is_some_and(|identity| {
            let mut parts = identity.split(':');
            matches!(parts.next(), Some("builtin" | "installed" | "dev"))
                && parts.next().is_some_and(|part| !part.is_empty())
                && parts.next().is_some_and(|part| !part.is_empty())
                && parts.next().is_none()
                && !identity.chars().any(char::is_control)
        });
    if supported { Ok(()) } else { Err(UNAVAILABLE.into()) }
}

fn suggested_text_filename(suggested: Option<String>) -> Result<String, String> {
    let name = suggested.unwrap_or_else(|| "result.txt".into());
    let stem = name.split('.').next().unwrap_or_default().to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'));
    if name.trim().is_empty()
        || name.len() > 255
        || name == "."
        || name == ".."
        || name.ends_with(['.', ' '])
        || name.chars().any(|ch| ch.is_control() || "<>:\"/\\|?*".contains(ch))
        || reserved
    {
        return Err("TEXT_EXPORT_INVALID_FILENAME".into());
    }
    Ok(name)
}

fn require_dialog_title(title: &str) -> Result<(), String> {
    if title.trim().is_empty() || title.len() > 256 || title.chars().any(char::is_control) {
        return Err(UNAVAILABLE.into());
    }
    Ok(())
}

fn require_launcher(label: &str) -> Result<(), String> {
    if label != "launcher" {
        return Err(UNAVAILABLE.into());
    }
    Ok(())
}

fn reserve_export(
    table: &mut ResourceTable,
    now: Instant,
) -> Result<(ResourceId, Arc<HostTextExportLease>), String> {
    reserve_export_with_owner(table, None, now)
}

fn reserve_export_with_owner(
    table: &mut ResourceTable,
    owner: Option<SurfaceOwnerBinding>,
    now: Instant,
) -> Result<(ResourceId, Arc<HostTextExportLease>), String> {
    if owner.as_ref().is_some_and(|owner| !table_has_owner(table, owner)) {
        return Err(INVALID_LEASE.into());
    }
    let leases: Vec<_> = table
        .names()
        .filter_map(|(id, _)| {
            table
                .get::<HostTextExportLease>(id)
                .ok()
                .map(|lease| (id, lease))
        })
        .collect();
    let mut live = 0;
    for (id, lease) in leases {
        let expired = lease.state.lock().map_or(true, |state| {
            state.prepared.as_ref().is_some_and(|ready| {
                now.saturating_duration_since(ready.prepared_at) >= PREPARED_TTL
            })
        });
        if expired {
            let _ = table.take::<HostTextExportLease>(id);
        } else {
            live += 1;
        }
    }
    if live >= MAX_PENDING_EXPORTS {
        return Err("TEXT_EXPORT_BUSY".into());
    }
    let lease = Arc::new(HostTextExportLease { owner, state: Mutex::default() });
    Ok((table.add_arc(lease.clone()), lease))
}

fn reserve_for_session(
    table: &mut ResourceTable,
    expected_session: u64,
    current_session: u64,
    now: Instant,
) -> Result<(ResourceId, Arc<HostTextExportLease>), String> {
    if expected_session != current_session {
        return Err(INVALID_LEASE.into());
    }
    reserve_export(table, now)
}

fn table_has_export(
    table: &ResourceTable,
    export_id: ResourceId,
    expected: &Arc<HostTextExportLease>,
) -> bool {
    table
        .get::<HostTextExportLease>(export_id)
        .is_ok_and(|lease| Arc::ptr_eq(&lease, expected))
}

fn source_is_current(
    webview: &tauri::Webview,
    export_id: ResourceId,
    expected: &Arc<HostTextExportLease>,
) -> bool {
    webview
        .app_handle()
        .get_webview_window(webview.label())
        .is_some_and(|current| {
            if !current.is_visible().unwrap_or(false) {
                return false;
            }
            let table = current.resources_table();
            table_has_export(&table, export_id, expected)
                && expected.owner.as_ref().map_or(true, |owner| {
                    table_has_owner(&table, owner)
                })
                && expected.state.lock().is_ok_and(|state| !state.invalidated)
        })
}

fn invalidate_export(table: &mut ResourceTable, export_id: ResourceId) {
    let Ok(lease) = table.get::<HostTextExportLease>(export_id) else {
        return;
    };
    if let Ok(mut state) = lease.state.lock() {
        state.invalidated = true;
        if state.prepared.is_some() {
            let _ = table.take::<HostTextExportLease>(export_id);
        }
    };
}

fn invalidate_exports(table: &mut ResourceTable) {
    let ids: Vec<_> = table
        .names()
        .filter_map(|(id, _)| table.get::<HostTextExportLease>(id).ok().map(|_| id))
        .collect();
    for id in ids {
        invalidate_export(table, id);
    }
}

// Native open/hide/close hooks use the actual window instance, never a label
// lookup from an old event. Resource identity is the native lifetime token;
// TS independently guards material/query/controller ownership before commit.
pub(crate) fn invalidate_window(window: &tauri::WebviewWindow) {
    if require_surface_window(window.label()).is_ok() {
        invalidate_window_resources(&mut window.resources_table());
    }
}

fn invalidate_window_resources(table: &mut ResourceTable) {
    invalidate_exports(table);
    let owners: Vec<_> = table.names().filter_map(|(id, _)| {
        table.get::<SurfaceTextExportOwner>(id).ok().map(|_| id)
    }).collect();
    for id in owners {
        let _ = table.take::<SurfaceTextExportOwner>(id);
    }
}

// A native chooser may blur its parent. Keep close-on-blur surfaces alive only
// while that actual instance still has a dialog reservation, including a revoked
// dialog waiting for its callback. Explicit hide/close is never suppressed.
pub(crate) fn has_open_surface_dialog(window: &tauri::WebviewWindow) -> bool {
    let table = window.resources_table();
    let open = table.names().any(|(id, _)| table.get::<HostTextExportLease>(id).is_ok_and(|lease| {
        lease.owner.is_some() && lease.state.lock().is_ok_and(|state| state.prepared.is_none())
    }));
    open
}

struct ExportReservation {
    webview: tauri::Webview,
    export_id: ResourceId,
    lease: Arc<HostTextExportLease>,
    keep: bool,
}

impl Drop for ExportReservation {
    fn drop(&mut self) {
        if !self.keep {
            let mut table = self.webview.resources_table();
            if table_has_export(&table, self.export_id, &self.lease) {
                let _ = table.take::<HostTextExportLease>(self.export_id);
            }
        }
    }
}

fn finish_preparation(
    table: &ResourceTable,
    export_id: ResourceId,
    expected: &Arc<HostTextExportLease>,
    ready: PreparedTextExport,
) -> Result<(), String> {
    if !table_has_export(table, export_id, expected) {
        return Err(INVALID_LEASE.into());
    }
    if expected.owner.as_ref().is_some_and(|owner| !table_has_owner(table, owner)) {
        return Err(INVALID_LEASE.into());
    }
    let mut state = expected.state.lock().map_err(|_| INVALID_LEASE.to_string())?;
    if state.invalidated || state.prepared.is_some() {
        return Err(INVALID_LEASE.into());
    }
    state.prepared = Some(ready);
    Ok(())
}

fn table_has_owner(table: &ResourceTable, expected: &SurfaceOwnerBinding) -> bool {
    table.get::<SurfaceTextExportOwner>(expected.token)
        .is_ok_and(|owner| Arc::ptr_eq(&owner, &expected.owner))
}

fn get_surface_owner(
    table: &ResourceTable,
    owner_id: &str,
    owner_token: ResourceId,
) -> Result<SurfaceOwnerBinding, String> {
    let owner = table.get::<SurfaceTextExportOwner>(owner_token)
        .map_err(|_| INVALID_LEASE.to_string())?;
    if owner.owner_id != owner_id {
        return Err(INVALID_LEASE.into());
    }
    Ok(SurfaceOwnerBinding { token: owner_token, owner })
}

fn register_surface_owner(
    table: &mut ResourceTable,
    owner_id: String,
    launcher_session: Option<u64>,
    surface_window_token: Option<u64>,
) -> Result<SurfaceOwnerBinding, String> {
    if owner_id.trim().is_empty() || owner_id.len() > 128 || owner_id.chars().any(char::is_control) {
        return Err(INVALID_LEASE.into());
    }
    // Abandoned registrations cannot exhaust this window forever. A chooser or
    // prepared ticket owns its own bounded lifetime and keeps its owner alive.
    let stale: Vec<_> = table
        .names()
        .filter_map(|(id, _)| {
            let owner = table.get::<SurfaceTextExportOwner>(id).ok()?;
            if owner.registered_at.elapsed() < PREPARED_TTL {
                return None;
            }
            let binding = SurfaceOwnerBinding { token: id, owner };
            let has_lease = table.names().any(|(lease_id, _)| {
                table.get::<HostTextExportLease>(lease_id).is_ok_and(|lease| {
                    lease.owner.as_ref().is_some_and(|owner| same_owner(owner, &binding))
                })
            });
            (!has_lease).then_some(binding)
        })
        .collect();
    for owner in stale {
        revoke_surface_owner(table, &owner);
    }
    let mut count = 0;
    for (id, _) in table.names() {
        if let Ok(owner) = table.get::<SurfaceTextExportOwner>(id) {
            if owner.owner_id == owner_id {
                return Err(INVALID_LEASE.into());
            }
            count += 1;
        }
    }
    if count >= MAX_SURFACE_OWNERS {
        return Err("TEXT_EXPORT_BUSY".into());
    }
    let owner = Arc::new(SurfaceTextExportOwner {
        owner_id,
        launcher_session,
        surface_window_token,
        registered_at: Instant::now(),
    });
    let token = table.add_arc(owner.clone());
    Ok(SurfaceOwnerBinding { token, owner })
}

fn revoke_surface_owner(table: &mut ResourceTable, expected: &SurfaceOwnerBinding) {
    if !table_has_owner(table, expected) {
        return;
    }
    let _ = table.take::<SurfaceTextExportOwner>(expected.token);
    let leases: Vec<_> = table
        .names()
        .filter_map(|(id, _)| {
            table.get::<HostTextExportLease>(id).ok().filter(|lease| {
                lease.owner.as_ref().is_some_and(|owner| same_owner(owner, expected))
            }).map(|_| id)
        })
        .collect();
    for id in leases {
        invalidate_export(table, id);
    }
}

fn same_owner(left: &SurfaceOwnerBinding, right: &SurfaceOwnerBinding) -> bool {
    left.token == right.token && Arc::ptr_eq(&left.owner, &right.owner)
}

fn require_surface_session(label: &str, expected: Option<u64>) -> Result<(), String> {
    if label == "launcher" {
        let current = super::launcher_resize_state().lock().map_err(|_| INVALID_LEASE.to_string())?;
        if expected != Some(current.session) {
            return Err(INVALID_LEASE.into());
        }
    } else if expected.is_some() {
        return Err(INVALID_LEASE.into());
    }
    Ok(())
}

fn require_surface_window_token(
    is_surface_window: bool,
    expected: Option<u64>,
    current: Option<u64>,
) -> Result<(), String> {
    if is_surface_window && (expected.is_none() || expected != current) {
        return Err(INVALID_LEASE.into());
    }
    Ok(())
}

fn require_surface_owner_lifetime(label: &str, owner: &SurfaceTextExportOwner) -> Result<(), String> {
    require_surface_session(label, owner.launcher_session)?;
    require_surface_window_token(
        label.starts_with("plugin-surface:"),
        owner.surface_window_token,
        super::current_plugin_surface_window_token(label),
    )
}

fn attach_surface_lifecycle(webview: &tauri::Webview) {
    let mut table = webview.resources_table();
    if table.names().any(|(id, _)| table.get::<SurfaceTextExportLifecycle>(id).is_ok()) {
        return;
    }
    table.add(SurfaceTextExportLifecycle);
    drop(table);
    let source = webview.clone();
    webview.window().on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed) {
            invalidate_window_resources(&mut source.resources_table());
        }
    });
}

#[tauri::command]
pub async fn register_host_surface_text_export_owner(
    webview: tauri::Webview,
    owner_id: String,
    expected_session: Option<u64>,
) -> Result<SurfaceTextExportOwnerResult, String> {
    require_surface_window(webview.label())?;
    // Capture before queueing on the main thread. A same-instance hide/reopen
    // can otherwise pass between receipt and registration before JS learns it.
    let surface_window_token = super::current_plugin_surface_window_token(webview.label());
    let (tx, rx) = tokio::sync::oneshot::channel();
    let source = webview.clone();
    webview.app_handle().run_on_main_thread(move || {
        let result = (|| {
            require_surface_session(source.label(), expected_session)?;
            require_surface_window_token(
                source.label().starts_with("plugin-surface:"),
                surface_window_token,
                super::current_plugin_surface_window_token(source.label()),
            )?;
            attach_surface_lifecycle(&source);
            let owner = register_surface_owner(
                &mut source.resources_table(), owner_id, expected_session, surface_window_token,
            )?;
            let current = source.app_handle().get_webview_window(source.label());
            let valid = current.is_some_and(|current| current.is_visible().unwrap_or(false)
                && table_has_owner(&current.resources_table(), &owner));
            if !valid {
                revoke_surface_owner(&mut source.resources_table(), &owner);
                return Err(INVALID_LEASE.to_string());
            }
            Ok(owner)
        })();
        // A dropped receiver cannot orphan a registered owner.
        if let Err(Ok(owner)) = tx.send(result) {
            revoke_surface_owner(&mut source.resources_table(), &owner);
        }
    }).map_err(|_| UNAVAILABLE.to_string())?;
    let owner = rx.await.map_err(|_| UNAVAILABLE.to_string())??;
    Ok(SurfaceTextExportOwnerResult { owner_token: owner.token })
}

#[tauri::command]
pub fn revoke_host_surface_text_export_owner(
    webview: tauri::Webview,
    owner_id: String,
    owner_token: ResourceId,
) -> Result<(), String> {
    require_surface_window(webview.label())?;
    let mut table = webview.resources_table();
    if let Ok(owner) = get_surface_owner(&table, &owner_id, owner_token) {
        revoke_surface_owner(&mut table, &owner);
    }
    Ok(())
}

#[tauri::command]
pub async fn prepare_host_surface_text_export(
    webview: tauri::Webview,
    owner_id: String,
    owner_token: ResourceId,
    text: String,
    dialog_title: String,
    suggested_filename: Option<String>,
) -> Result<PrepareHostTextExportResult, String> {
    require_surface_window(webview.label())?;
    let bytes = bounded_text_bytes(text, MAX_SURFACE_TEXT_BYTES)?;
    require_dialog_title(&dialog_title)?;
    let filename = suggested_text_filename(suggested_filename)?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let source = webview.clone();
    webview.app_handle().run_on_main_thread(move || {
        let result = (|| {
            let owner = get_surface_owner(&source.resources_table(), &owner_id, owner_token)?;
            require_surface_owner_lifetime(source.label(), &owner.owner)?;
            let (export_id, lease) = reserve_export_with_owner(
                &mut source.resources_table(), Some(owner), Instant::now(),
            )?;
            let reservation = ExportReservation { webview: source.clone(), export_id, lease, keep: false };
            if !source_is_current(&source, export_id, &reservation.lease) {
                return Err(INVALID_LEASE.to_string());
            }
            Ok(reservation)
        })();
        let _ = tx.send(result);
    }).map_err(|_| UNAVAILABLE.to_string())?;
    let reservation = rx.await.map_err(|_| UNAVAILABLE.to_string())??;
    prepare_text_dialog(reservation, bytes, dialog_title, filename).await
}

#[tauri::command]
pub async fn prepare_host_text_export(
    webview: tauri::Webview,
    text: String,
    dialog_title: String,
    expected_session: u64,
) -> Result<PrepareHostTextExportResult, String> {
    require_launcher(webview.label())?;
    let bytes = text_bytes(text)?;
    require_dialog_title(&dialog_title)?;
    let (reserve_tx, reserve_rx) = tokio::sync::oneshot::channel();
    let source = webview.clone();
    webview
        .app_handle()
        .run_on_main_thread(move || {
            let result = (|| {
                // Lifecycle invalidation and this check/reservation all run on
                // the native main thread. Hide cannot scan before reservation
                // and then advance the session after an old ticket slipped in.
                let session = super::launcher_resize_state()
                    .lock()
                    .map_err(|_| INVALID_LEASE.to_string())?;
                let (export_id, lease) = reserve_for_session(
                    &mut source.resources_table(),
                    expected_session,
                    session.session,
                    Instant::now(),
                )?;
                let reservation = ExportReservation {
                    webview: source.clone(),
                    export_id,
                    lease,
                    keep: false,
                };
                if !source_is_current(&source, export_id, &reservation.lease) {
                    return Err(INVALID_LEASE.to_string());
                }
                Ok(reservation)
            })();
            // If the awaiting task vanished, dropping the unsent reservation also
            // releases its native resource. There is no unowned pending ticket.
            let _ = reserve_tx.send(result);
        })
        .map_err(|_| UNAVAILABLE.to_string())?;
    let reservation = reserve_rx.await.map_err(|_| UNAVAILABLE.to_string())??;
    prepare_text_dialog(reservation, bytes, dialog_title, "result.txt".into()).await
}

async fn prepare_text_dialog(
    mut reservation: ExportReservation,
    bytes: Vec<u8>,
    dialog_title: String,
    filename: String,
) -> Result<PrepareHostTextExportResult, String> {
    let webview = reservation.webview.clone();
    let export_id = reservation.export_id;
    let lease = reservation.lease.clone();
    if !source_is_current(&webview, export_id, &lease) {
        return Err(INVALID_LEASE.into());
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    let dialog = webview
        .app_handle()
        .dialog()
        .file()
        .set_title(dialog_title)
        // No extension filter: rfd imposes allowed types on macOS and a
        // default extension on Windows. The user can choose any filename.
        .set_file_name(filename);
    #[cfg(desktop)]
    let dialog = {
        let paths = webview.app_handle().path();
        let directory = [paths.document_dir(), paths.download_dir(), paths.home_dir()]
            .into_iter()
            .filter_map(Result::ok)
            .find(|path| path.is_absolute() && path.is_dir());
        let dialog = match directory {
            Some(directory) => dialog.set_directory(directory),
            None => dialog,
        };
        dialog.set_parent(&webview.window())
    };
    dialog.save_file(move |selection| {
        let _ = tx.send(selection);
    });
    let Some(selection) = rx.await.map_err(|_| UNAVAILABLE.to_string())? else {
        return Ok(PrepareHostTextExportResult::Cancelled);
    };
    let destination = selection.into_path().map_err(|_| UNAVAILABLE.to_string())?;
    if !destination.is_absolute() || destination.file_name().is_none() {
        return Err(UNAVAILABLE.into());
    }
    let current = webview
        .app_handle()
        .get_webview_window(webview.label())
        .ok_or_else(|| INVALID_LEASE.to_string())?;
    if !source_is_current(&webview, export_id, &lease) {
        return Err(INVALID_LEASE.into());
    }
    // Preserve the exact OS-confirmed destination, including its suffix. The
    // native path stays inside this resource and is never serialized to JS.
    finish_preparation(
        &current.resources_table(),
        export_id,
        &lease,
        PreparedTextExport {
            destination,
            bytes,
            prepared_at: Instant::now(),
        },
    )?;
    reservation.keep = true;
    Ok(PrepareHostTextExportResult::Prepared { export_id })
}

fn consume_export(
    table: &mut ResourceTable,
    export_id: ResourceId,
    expected: &Arc<HostTextExportLease>,
    now: Instant,
) -> Result<PreparedTextExport, String> {
    if !table_has_export(table, export_id, expected) {
        return Err(INVALID_LEASE.into());
    }
    if expected.owner.as_ref().is_some_and(|owner| !table_has_owner(table, owner)) {
        return Err(INVALID_LEASE.into());
    }
    let mut state = expected.state.lock().map_err(|_| INVALID_LEASE.to_string())?;
    if state.invalidated || state.prepared.is_none() {
        return Err(INVALID_LEASE.into());
    }
    let ready = state
        .prepared
        .take()
        .ok_or_else(|| INVALID_LEASE.to_string())?;
    // Under the current instance's table lock, commit/discard/lifetime changes
    // compete for one ticket. After this point invalidation cannot revoke write.
    table
        .take::<HostTextExportLease>(export_id)
        .map_err(|_| INVALID_LEASE.to_string())?;
    if now.saturating_duration_since(ready.prepared_at) >= PREPARED_TTL {
        return Err(INVALID_LEASE.into());
    }
    Ok(ready)
}

fn consume_root_export(
    table: &mut ResourceTable,
    export_id: ResourceId,
    lease: &Arc<HostTextExportLease>,
    now: Instant,
) -> Result<PreparedTextExport, String> {
    if lease.owner.is_some() {
        return Err(INVALID_LEASE.into());
    }
    consume_export(table, export_id, lease, now)
}

fn consume_surface_export(
    table: &mut ResourceTable,
    export_id: ResourceId,
    lease: &Arc<HostTextExportLease>,
    owner: &SurfaceOwnerBinding,
    now: Instant,
) -> Result<PreparedTextExport, String> {
    if !lease.owner.as_ref().is_some_and(|bound| same_owner(bound, owner)) {
        return Err(INVALID_LEASE.into());
    }
    consume_export(table, export_id, lease, now)
}

fn write_text_atomic_with(
    destination: &Path,
    bytes: &[u8],
    write: impl FnOnce(&mut File, &[u8]) -> std::io::Result<()>,
) -> Result<(), String> {
    let parent = destination
        .parent()
        .ok_or_else(|| WRITE_FAILED.to_string())?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| WRITE_FAILED.to_string())?;
    write(temporary.as_file_mut(), bytes).map_err(|_| WRITE_FAILED.to_string())?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|_| WRITE_FAILED.to_string())?;
    temporary
        .persist(destination)
        .map_err(|_| WRITE_FAILED.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn commit_host_text_export(
    webview: tauri::Webview,
    export_id: ResourceId,
) -> Result<CommitHostTextExportResult, String> {
    require_launcher(webview.label())?;
    let lease = webview
        .resources_table()
        .get::<HostTextExportLease>(export_id)
        .map_err(|_| INVALID_LEASE.to_string())?;
    let current = webview
        .app_handle()
        .get_webview_window("launcher")
        .ok_or_else(|| INVALID_LEASE.to_string())?;
    let ready = consume_root_export(
        &mut current.resources_table(),
        export_id,
        &lease,
        Instant::now(),
    )?;
    write_prepared_text(ready).await
}

async fn write_prepared_text(ready: PreparedTextExport) -> Result<CommitHostTextExportResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        write_text_atomic_with(&ready.destination, &ready.bytes, |file, bytes| {
            file.write_all(bytes)
        })
    })
    .await
    .map_err(|_| WRITE_FAILED.to_string())??;
    Ok(CommitHostTextExportResult::Saved)
}

#[tauri::command]
pub fn discard_host_text_export(webview: tauri::Webview, export_id: ResourceId) -> Result<(), String> {
    require_launcher(webview.label())?;
    // Type-specific and idempotent; an old caller can touch only its own table.
    let mut table = webview.resources_table();
    if table.get::<HostTextExportLease>(export_id).is_ok_and(|lease| lease.owner.is_none()) {
        invalidate_export(&mut table, export_id);
    }
    Ok(())
}

#[tauri::command]
pub async fn commit_host_surface_text_export(
    webview: tauri::Webview,
    owner_id: String,
    owner_token: ResourceId,
    export_id: ResourceId,
) -> Result<CommitHostTextExportResult, String> {
    require_surface_window(webview.label())?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let source = webview.clone();
    webview.app_handle().run_on_main_thread(move || {
        let result = (|| {
            let owner = get_surface_owner(&source.resources_table(), &owner_id, owner_token)?;
            require_surface_owner_lifetime(source.label(), &owner.owner)?;
            let lease = source.resources_table().get::<HostTextExportLease>(export_id)
                .map_err(|_| INVALID_LEASE.to_string())?;
            if !lease.owner.as_ref().is_some_and(|bound| same_owner(bound, &owner))
                || !source_is_current(&source, export_id, &lease)
            {
                return Err(INVALID_LEASE.to_string());
            }
            let current = source.app_handle().get_webview_window(source.label())
                .ok_or_else(|| INVALID_LEASE.to_string())?;
            let ready = consume_surface_export(&mut current.resources_table(), export_id, &lease, &owner, Instant::now());
            ready
        })();
        match result {
            Ok(ready) => {
                // Consumption accepts the write, even if the invoking task or
                // its receiver vanishes next. Never recheck ownership afterward.
                tauri::async_runtime::spawn_blocking(move || {
                    let result = write_text_atomic_with(&ready.destination, &ready.bytes, |file, bytes| {
                        file.write_all(bytes)
                    }).map(|_| CommitHostTextExportResult::Saved);
                    let _ = tx.send(result);
                });
            }
            Err(error) => { let _ = tx.send(Err(error)); }
        }
    }).map_err(|_| UNAVAILABLE.to_string())?;
    rx.await.map_err(|_| WRITE_FAILED.to_string())?
}

#[tauri::command]
pub fn discard_host_surface_text_export(
    webview: tauri::Webview,
    owner_id: String,
    owner_token: ResourceId,
    export_id: ResourceId,
) -> Result<(), String> {
    require_surface_window(webview.label())?;
    let mut table = webview.resources_table();
    let matches = table.get::<HostTextExportLease>(export_id).is_ok_and(|lease| {
        lease.owner.as_ref().is_some_and(|owner| {
            owner.token == owner_token && owner.owner.owner_id == owner_id
        })
    });
    if matches {
        invalidate_export(&mut table, export_id);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prepared(table: &mut ResourceTable, now: Instant) -> (ResourceId, Arc<HostTextExportLease>) {
        let (id, lease) = reserve_export(table, now).unwrap();
        finish_preparation(
            table,
            id,
            &lease,
            PreparedTextExport {
                destination: PathBuf::from("only-native-dialog-knows-this.any-suffix"),
                bytes: b"original\n\n".to_vec(),
                prepared_at: now,
            },
        )
        .unwrap();
        (id, lease)
    }

    #[test]
    fn accepts_exact_utf8_snapshots_and_enforces_byte_limit() {
        for text in ["", " \t\r\n", "0", "false", "中文\n\n", "\0"] {
            assert_eq!(text_bytes(text.into()).unwrap(), text.as_bytes());
        }
        assert_eq!(
            text_bytes("é".repeat(MAX_TEXT_BYTES / 2)).unwrap().len(),
            MAX_TEXT_BYTES,
        );
        assert_eq!(
            text_bytes("é".repeat(MAX_TEXT_BYTES / 2 + 1)).unwrap_err(),
            "TEXT_EXPORT_TOO_LARGE",
        );
        assert!(text_bytes("a".repeat(MAX_TEXT_BYTES + 1)).is_err());
    }

    #[test]
    fn only_launcher_can_enter_the_host_export_api() {
        assert!(require_launcher("launcher").is_ok());
        for label in [
            "main", "plugin-surface:test", "quick-editor", "editor:1", "launcher:1", "",
        ] {
            assert_eq!(require_launcher(label).unwrap_err(), UNAVAILABLE);
        }
    }

    #[test]
    fn surface_text_limit_is_utf8_and_does_not_expand_root_limit() {
        let text = "é".repeat(MAX_SURFACE_TEXT_BYTES / 2);
        assert!(text_bytes(text.clone()).is_err());
        assert_eq!(bounded_text_bytes(text, MAX_SURFACE_TEXT_BYTES).unwrap().len(), MAX_SURFACE_TEXT_BYTES);
        assert!(bounded_text_bytes("é".repeat(MAX_SURFACE_TEXT_BYTES / 2 + 1), MAX_SURFACE_TEXT_BYTES).is_err());
        for text in ["", " \t\r\n", "中文\n\n", "\0"] {
            assert_eq!(bounded_text_bytes(text.into(), MAX_SURFACE_TEXT_BYTES).unwrap(), text.as_bytes());
        }
    }

    #[test]
    fn only_supported_host_windows_can_own_surface_exports() {
        for label in ["launcher", "editor", "editor:abc", "plugin-surface:builtin:csv:main", "plugin-surface:installed:example:preview", "plugin-surface:dev:test:main"] {
            assert!(require_surface_window(label).is_ok(), "{label}");
        }
        for label in ["", "main", "quick-editor", "editor:", "editor:a:b", "launcher:1", "plugin-surface:csv", "plugin-surface:external:csv:main", "plugin-surface:builtin::main", "plugin-surface:builtin:csv:main:extra"] {
            assert_eq!(require_surface_window(label).unwrap_err(), UNAVAILABLE, "{label}");
        }
    }

    #[test]
    fn delayed_surface_registration_and_commit_cannot_cross_hide_reopen_tokens() {
        assert!(require_surface_window_token(true, Some(7), Some(7)).is_ok());
        assert!(require_surface_window_token(true, Some(7), Some(8)).is_err());
        assert!(require_surface_window_token(true, Some(7), None).is_err());
        assert!(require_surface_window_token(true, None, Some(8)).is_err());
        assert!(require_surface_window_token(false, None, None).is_ok());
    }

    #[test]
    fn suggested_text_names_are_safe_basenames_without_suffix_rewriting() {
        assert_eq!(suggested_text_filename(None).unwrap(), "result.txt");
        for name in ["output.csv", "result", ".hidden", "结果.custom", " spaced name.csv"] {
            assert_eq!(suggested_text_filename(Some(name.into())).unwrap(), name);
        }
        for name in ["", " ", ".", "..", "../output.csv", "/tmp/output.csv", "C:\\output.csv", "folder\\output.csv", "https://example.com/a", "nul.csv", "COM1", "Lpt9.log", "data.", "data ", "bad\n.csv", "bad\u{0085}.csv", "bad?.csv", "bad*.csv", "bad|.csv", "<bad>.csv", "bad\".csv"] {
            assert_eq!(suggested_text_filename(Some(name.into())).unwrap_err(), "TEXT_EXPORT_INVALID_FILENAME", "{name}");
        }
        assert!(suggested_text_filename(Some("é".repeat(128))).is_err());
        assert_eq!(suggested_text_filename(Some("a".repeat(255))).unwrap().len(), 255);
    }

    fn prepared_surface(
        table: &mut ResourceTable,
        owner: &SurfaceOwnerBinding,
        now: Instant,
    ) -> (ResourceId, Arc<HostTextExportLease>) {
        let (id, lease) = reserve_export_with_owner(table, Some(owner.clone()), now).unwrap();
        finish_preparation(table, id, &lease, PreparedTextExport {
            destination: PathBuf::from("private-dialog-choice.csv"),
            bytes: "表格\n\n".as_bytes().to_vec(),
            prepared_at: now,
        }).unwrap();
        (id, lease)
    }

    #[test]
    fn surface_owners_and_root_tickets_cannot_cross_scopes_or_window_instances() {
        let now = Instant::now();
        let mut table = ResourceTable::default();
        let first = register_surface_owner(&mut table, "first".into(), None, None).unwrap();
        let second = register_surface_owner(&mut table, "second".into(), None, None).unwrap();
        assert!(get_surface_owner(&table, "wrong-id", first.token).is_err());
        assert!(register_surface_owner(&mut table, "first".into(), None, None).is_err());
        let (root_id, root) = prepared(&mut table, now);
        let (surface_id, surface) = prepared_surface(&mut table, &first, now);
        assert!(consume_surface_export(&mut table, root_id, &root, &first, now).is_err());
        assert!(consume_root_export(&mut table, surface_id, &surface, now).is_err());
        assert!(consume_surface_export(&mut table, surface_id, &surface, &second, now).is_err());
        let mut replacement = ResourceTable::default();
        let copied_uuid = register_surface_owner(&mut replacement, "first".into(), None, None).unwrap();
        assert!(!same_owner(&first, &copied_uuid));
        assert!(!table_has_owner(&replacement, &first));
        assert!(consume_surface_export(&mut replacement, surface_id, &surface, &first, now).is_err());
        revoke_surface_owner(&mut table, &second);
        assert!(consume_root_export(&mut table, root_id, &root, now).is_ok());
        assert!(consume_surface_export(&mut table, surface_id, &surface, &first, now).is_ok());
        assert!(consume_surface_export(&mut table, surface_id, &surface, &first, now).is_err());
    }

    #[test]
    fn revoked_surface_owner_keeps_open_dialog_bounded_but_cannot_finish_or_commit() {
        let now = Instant::now();
        let mut table = ResourceTable::default();
        let owner = register_surface_owner(&mut table, "old-generation".into(), None, None).unwrap();
        let (ready_id, ready) = prepared_surface(&mut table, &owner, now);
        let (pending_id, pending) = reserve_export_with_owner(&mut table, Some(owner.clone()), now).unwrap();
        revoke_surface_owner(&mut table, &owner);
        assert!(!table_has_owner(&table, &owner));
        assert!(!table.has(ready_id));
        assert!(table.has(pending_id));
        assert!(consume_surface_export(&mut table, ready_id, &ready, &owner, now).is_err());
        assert!(reserve_export_with_owner(&mut table, Some(owner), now).is_err());
        assert!(finish_preparation(&table, pending_id, &pending, PreparedTextExport {
            destination: PathBuf::from("never-write.csv"), bytes: vec![], prepared_at: now,
        }).is_err());
        for _ in 1..MAX_PENDING_EXPORTS {
            reserve_export(&mut table, now).unwrap();
        }
        assert!(reserve_export(&mut table, now + PREPARED_TTL * 2).is_err());
    }

    #[test]
    fn owner_registrations_are_bounded_and_idle_orphans_are_reclaimed() {
        let mut table = ResourceTable::default();
        for index in 0..MAX_SURFACE_OWNERS {
            register_surface_owner(&mut table, format!("owner-{index}"), None, None).unwrap();
        }
        assert!(register_surface_owner(&mut table, "one-too-many".into(), None, None).is_err());
        let ids: Vec<_> = table.names().map(|(id, _)| id).collect();
        for id in ids {
            table.replace(id, SurfaceTextExportOwner {
                owner_id: format!("expired-{id}"), launcher_session: None, surface_window_token: None,
                registered_at: Instant::now() - PREPARED_TTL,
            });
        }
        let current = register_surface_owner(&mut table, "after-ttl".into(), None, None).unwrap();
        assert!(table_has_owner(&table, &current));
        assert_eq!(table.names().count(), 1);
        invalidate_window_resources(&mut table);
        assert_eq!(table.names().count(), 0);
    }

    #[test]
    fn accepted_surface_commit_survives_owner_revocation_and_writes_exact_bytes() {
        let now = Instant::now();
        let dir = tempfile::tempdir().unwrap();
        let destination = dir.path().join("chosen.unusual");
        let mut table = ResourceTable::default();
        let owner = register_surface_owner(&mut table, "before-close".into(), None, None).unwrap();
        let (id, lease) = reserve_export_with_owner(&mut table, Some(owner.clone()), now).unwrap();
        finish_preparation(&table, id, &lease, PreparedTextExport {
            destination: destination.clone(), bytes: "表格\r\n\r\n".as_bytes().to_vec(), prepared_at: now,
        }).unwrap();
        assert!(!destination.exists(), "preparing alone never writes");
        let accepted = consume_surface_export(&mut table, id, &lease, &owner, now).unwrap();
        revoke_surface_owner(&mut table, &owner);
        invalidate_window_resources(&mut table);
        write_text_atomic_with(&accepted.destination, &accepted.bytes, |file, bytes| file.write_all(bytes)).unwrap();
        assert_eq!(std::fs::read(&destination).unwrap(), "表格\r\n\r\n".as_bytes());
        assert!(!destination.with_extension("txt").exists());
        assert!(consume_surface_export(&mut table, id, &lease, &owner, now).is_err());
    }

    #[test]
    fn leases_are_instance_scoped_type_specific_and_single_use() {
        let now = Instant::now();
        let mut original = ResourceTable::default();
        let (id, lease) = prepared(&mut original, now);
        let mut replacement = ResourceTable::default();
        assert!(consume_export(&mut replacement, id, &lease, now).is_err());
        assert!(consume_export(
            &mut original,
            id,
            &Arc::new(HostTextExportLease::default()),
            now,
        )
        .is_err());
        struct OtherResource;
        impl Resource for OtherResource {}
        let other = original.add(OtherResource);
        invalidate_export(&mut original, other);
        assert!(original.has(other));
        assert_eq!(
            consume_export(&mut original, id, &lease, now).unwrap().bytes,
            b"original\n\n",
        );
        assert!(consume_export(&mut original, id, &lease, now).is_err());
        let (id, lease) = prepared(&mut original, now);
        original.replace(id, HostTextExportLease::default());
        assert!(consume_export(&mut original, id, &lease, now).is_err());
    }

    #[test]
    fn old_native_session_cannot_reserve_a_new_dialog() {
        let mut table = ResourceTable::default();
        let now = Instant::now();
        assert!(reserve_for_session(&mut table, 2, 4, now).is_err());
        assert_eq!(table.names().count(), 0);
        assert!(reserve_for_session(&mut table, 4, 4, now).is_ok());
    }

    #[test]
    fn lifetime_changes_revoke_prepared_and_inflight_dialogs() {
        let now = Instant::now();
        let mut table = ResourceTable::default();
        let (ready_id, ready) = prepared(&mut table, now);
        let (pending_id, pending) = reserve_export(&mut table, now).unwrap();
        invalidate_exports(&mut table);
        assert!(!table.has(ready_id));
        assert!(table.has(pending_id), "open dialog keeps its bounded slot");
        assert!(consume_export(&mut table, ready_id, &ready, now).is_err());
        assert!(finish_preparation(
            &table,
            pending_id,
            &pending,
            PreparedTextExport {
                destination: PathBuf::from("stale.txt"),
                bytes: vec![],
                prepared_at: now,
            },
        )
        .is_err());
        let (next_id, next) = prepared(&mut table, now);
        invalidate_export(&mut table, ready_id);
        invalidate_export(&mut table, pending_id);
        assert!(consume_export(&mut table, next_id, &next, now).is_ok());
    }

    #[test]
    fn pending_slots_are_bounded_and_prepared_tickets_expire() {
        let now = Instant::now();
        let mut table = ResourceTable::default();
        let (expired_id, expired) = prepared(&mut table, now);
        for _ in 1..MAX_PENDING_EXPORTS {
            reserve_export(&mut table, now).unwrap();
        }
        assert!(reserve_export(&mut table, now).is_err());
        assert!(reserve_export(&mut table, now + PREPARED_TTL).is_ok());
        assert!(!table.has(expired_id));
        assert!(consume_export(&mut table, expired_id, &expired, now).is_err());
        invalidate_exports(&mut table);
        assert!(reserve_export(&mut table, now + PREPARED_TTL * 3).is_err());
        let mut table = ResourceTable::default();
        let (id, lease) = prepared(&mut table, now);
        assert!(consume_export(&mut table, id, &lease, now + PREPARED_TTL).is_err());
        assert!(!table.has(id));
    }

    #[test]
    fn competing_commits_have_one_winner_and_late_close_cannot_revoke_it() {
        let now = Instant::now();
        let mut table = ResourceTable::default();
        let (id, lease) = prepared(&mut table, now);
        let table = Mutex::new(table);
        std::thread::scope(|scope| {
            let run = || consume_export(&mut table.lock().unwrap(), id, &lease, now).is_ok();
            let first = scope.spawn(run);
            let second = scope.spawn(run);
            assert_ne!(first.join().unwrap(), second.join().unwrap());
        });
        let (id, lease) = prepared(&mut table.lock().unwrap(), now);
        let accepted = consume_export(&mut table.lock().unwrap(), id, &lease, now).unwrap();
        invalidate_exports(&mut table.lock().unwrap());
        assert_eq!(accepted.bytes, b"original\n\n");
    }

    #[test]
    fn atomic_writes_preserve_exact_path_empty_bytes_and_previous_file_on_failure() {
        let dir = tempfile::tempdir().unwrap();
        let destination = dir.path().join("result.custom-suffix");
        std::fs::write(&destination, b"original").unwrap();
        let result = write_text_atomic_with(&destination, b"new", |file, _| {
            file.write_all(b"partial")?;
            Err(std::io::Error::other("private filesystem details"))
        });
        assert_eq!(result.unwrap_err(), WRITE_FAILED);
        assert_eq!(std::fs::read(&destination).unwrap(), b"original");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
        for bytes in ["中文\n\n".as_bytes(), b"".as_slice()] {
            write_text_atomic_with(&destination, bytes, |file, bytes| file.write_all(bytes)).unwrap();
            assert_eq!(std::fs::read(&destination).unwrap(), bytes);
            assert!(!destination.with_extension("txt").exists());
            assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
        }
        let missing = dir.path().join("absent").join("secret.txt");
        assert_eq!(
            write_text_atomic_with(&missing, b"", |file, bytes| file.write_all(bytes)).unwrap_err(),
            WRITE_FAILED,
        );
    }
}
