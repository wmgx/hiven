//! Save a frozen host text snapshot through a native-owned, one-shot lease.
//! No plugin namespace, source path, filename, or destination crosses this API.
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
const MAX_PENDING_EXPORTS: usize = 4;
const PREPARED_TTL: Duration = Duration::from_secs(5 * 60);
const UNAVAILABLE: &str = "TEXT_EXPORT_UNAVAILABLE";
const INVALID_LEASE: &str = "TEXT_EXPORT_INVALID_LEASE";
const WRITE_FAILED: &str = "TEXT_EXPORT_WRITE_FAILED";

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
    state: Mutex<LeaseState>,
}

impl Resource for HostTextExportLease {}

fn text_bytes(text: String) -> Result<Vec<u8>, String> {
    if text.len() > MAX_TEXT_BYTES {
        return Err("TEXT_EXPORT_TOO_LARGE".into());
    }
    // Empty and whitespace-only strings are deliberate snapshots, too.
    Ok(text.into_bytes())
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
    let lease = Arc::new(HostTextExportLease::default());
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
        .get_webview_window("launcher")
        .is_some_and(|current| {
            current.is_visible().unwrap_or(false)
                && table_has_export(&current.resources_table(), export_id, expected)
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
    if window.label() == "launcher" {
        invalidate_exports(&mut window.resources_table());
    }
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
    let mut state = expected.state.lock().map_err(|_| INVALID_LEASE.to_string())?;
    if state.invalidated || state.prepared.is_some() {
        return Err(INVALID_LEASE.into());
    }
    state.prepared = Some(ready);
    Ok(())
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
    if dialog_title.trim().is_empty()
        || dialog_title.len() > 256
        || dialog_title.chars().any(char::is_control)
    {
        return Err(UNAVAILABLE.into());
    }
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
    let mut reservation = reserve_rx.await.map_err(|_| UNAVAILABLE.to_string())??;
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
        .set_file_name("result.txt");
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
        .get_webview_window("launcher")
        .ok_or_else(|| INVALID_LEASE.to_string())?;
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
    let ready = consume_export(
        &mut current.resources_table(),
        export_id,
        &lease,
        Instant::now(),
    )?;
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
    invalidate_export(&mut webview.resources_table(), export_id);
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
