//! Export a private PNG through a native-owned destination and a one-shot lease.
//!
//! Preparing never writes to the chosen path. The host must recheck its current
//! plugin/surface lifetime and permissions after the dialog, then commit. Once
//! commit is accepted its external write cannot be revoked or rolled back.

use std::fs::File;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Manager, Resource, ResourceId, ResourceTable};
use tauri_plugin_dialog::DialogExt;

const MAX_PNG_BYTES: usize = 10 * 1024 * 1024;
const MAX_METADATA_BYTES: usize = 16 * 1024;
const MAX_PNG_SIDE: u32 = 8192;
const MAX_PNG_PIXELS: u64 = 16 * 1024 * 1024;
const MAX_DECODED_BYTES: usize = 64 * 1024 * 1024;
const MAX_PENDING_EXPORTS: usize = 4;
const PREPARED_TTL: Duration = Duration::from_secs(5 * 60);
const INVALID_PNG: &str = "PNG_EXPORT_INVALID_IMAGE";
const UNAVAILABLE: &str = "PNG_EXPORT_UNAVAILABLE";
const INVALID_LEASE: &str = "PNG_EXPORT_INVALID_LEASE";
const WRITE_FAILED: &str = "PNG_EXPORT_WRITE_FAILED";

#[derive(serde::Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum PreparePngExportResult {
    Cancelled,
    Prepared {
        #[serde(rename = "exportId")]
        export_id: ResourceId,
    },
}

#[derive(serde::Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum CommitPngExportResult {
    Saved,
}

struct PreparedPngExport {
    destination: PathBuf,
    bytes: Vec<u8>,
    prepared_at: Instant,
}

struct PngExportLease {
    source: String,
    plugin_id: String,
    // None while the native dialog is open. It still occupies a bounded slot,
    // but a user taking time in the dialog does not expire a prepared ticket.
    prepared: Mutex<Option<PreparedPngExport>>,
}

impl Resource for PngExportLease {}

impl PngExportLease {
    fn expired(&self, now: Instant) -> bool {
        self.prepared.lock().map_or(true, |prepared| {
            prepared.as_ref().is_some_and(|ready| {
                now.saturating_duration_since(ready.prepared_at) >= PREPARED_TTL
            })
        })
    }
}

fn reserve_export(
    table: &mut ResourceTable,
    source: String,
    plugin_id: String,
    now: Instant,
) -> Result<(ResourceId, Arc<PngExportLease>), String> {
    let leases: Vec<_> = table
        .names()
        .filter_map(|(id, _)| table.get::<PngExportLease>(id).ok().map(|lease| (id, lease)))
        .collect();
    let mut live = 0;
    for (id, lease) in leases {
        if lease.expired(now) {
            let _ = table.take::<PngExportLease>(id);
        } else {
            live += 1;
        }
    }
    if live >= MAX_PENDING_EXPORTS {
        return Err("PNG_EXPORT_BUSY".into());
    }
    let lease = Arc::new(PngExportLease {
        source,
        plugin_id,
        prepared: Mutex::new(None),
    });
    Ok((table.add_arc(lease.clone()), lease))
}

// Labels can be reused after closing a window. Compare the resource itself in
// the CURRENT webview's table, rather than Webview equality (which uses labels).
fn source_is_current(
    webview: &tauri::Webview,
    export_id: ResourceId,
    expected: &Arc<PngExportLease>,
) -> bool {
    webview
        .app_handle()
        .get_webview_window(webview.label())
        .is_some_and(|current| table_has_export(&current.resources_table(), export_id, expected))
}

fn table_has_export(
    table: &ResourceTable,
    export_id: ResourceId,
    expected: &Arc<PngExportLease>,
) -> bool {
    table
        .get::<PngExportLease>(export_id)
        .is_ok_and(|lease| Arc::ptr_eq(&lease, expected))
}

struct ExportReservation {
    webview: tauri::Webview,
    export_id: ResourceId,
    keep: bool,
}

impl Drop for ExportReservation {
    fn drop(&mut self) {
        if !self.keep {
            let _ = self
                .webview
                .resources_table()
                .take::<PngExportLease>(self.export_id);
        }
    }
}

fn suggested_png_filename(suggested: Option<&str>) -> String {
    let name = suggested.unwrap_or("image.png").trim();
    if name.is_empty()
        || name.chars().count() > 120
        || name
            .chars()
            .any(|ch| ch.is_control() || "<>:\"/\\|?*".contains(ch))
        || name.starts_with('.')
        || name.ends_with('.')
    {
        return "image.png".into();
    }
    if name.to_ascii_lowercase().ends_with(".png") {
        name.to_string()
    } else {
        format!("{name}.png")
    }
}

fn read_bounded_png(mut reader: impl Read, content_type: &str) -> Result<Vec<u8>, String> {
    if content_type != "image/png" {
        return Err(INVALID_PNG.into());
    }
    let mut bytes = Vec::new();
    reader
        .by_ref()
        .take((MAX_PNG_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| UNAVAILABLE.to_string())?;
    validate_png(&bytes)?;
    Ok(bytes)
}

fn validate_png(bytes: &[u8]) -> Result<(), String> {
    // Check the actual bytes and dimensions before allocating decoder buffers.
    if bytes.len() > MAX_PNG_BYTES
        || bytes.len() < 33
        || &bytes[..8] != b"\x89PNG\r\n\x1a\n"
        || bytes[8..12] != 13u32.to_be_bytes()
        || &bytes[12..16] != b"IHDR"
    {
        return Err(INVALID_PNG.into());
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    if width == 0
        || height == 0
        || width > MAX_PNG_SIDE
        || height > MAX_PNG_SIDE
        || u64::from(width) * u64::from(height) > MAX_PNG_PIXELS
    {
        return Err(INVALID_PNG.into());
    }
    let mut options = png::DecodeOptions::default();
    options.set_ignore_checksums(false);
    options.set_skip_ancillary_crc_failures(false);
    let mut decoder = png::Decoder::new_with_options(Cursor::new(bytes), options);
    decoder.set_limits(png::Limits {
        bytes: MAX_DECODED_BYTES,
    });
    decoder.set_ignore_text_chunk(true);
    decoder.set_ignore_iccp_chunk(true);
    let mut reader = decoder.read_info().map_err(|_| INVALID_PNG.to_string())?;
    // The API exports a single still image, not unvalidated animation frames.
    if reader.info().animation_control.is_some() {
        return Err(INVALID_PNG.into());
    }
    let size = reader
        .output_buffer_size()
        .filter(|size| *size <= MAX_DECODED_BYTES)
        .ok_or_else(|| INVALID_PNG.to_string())?;
    reader
        .next_frame(&mut vec![0; size])
        .map_err(|_| INVALID_PNG.to_string())?;
    reader.finish().map_err(|_| INVALID_PNG.to_string())
}

fn load_png_blob(source: &str, plugin_id: &str, blob_id: &str) -> Result<Vec<u8>, String> {
    let (path, metadata) = super::plugin_blob_paths_with_metadata_limit(
        source,
        plugin_id,
        blob_id,
        Some(MAX_METADATA_BYTES),
    )
    .map_err(|_| UNAVAILABLE.to_string())?;
    let file = File::open(path).map_err(|_| UNAVAILABLE.to_string())?;
    let actual = file.metadata().map_err(|_| UNAVAILABLE.to_string())?;
    if !actual.is_file() || actual.len() > MAX_PNG_BYTES as u64 {
        return Err(INVALID_PNG.into());
    }
    // Metadata byte_size is not trusted; a concurrently growing file is bounded
    // again by the reader. These bytes are frozen before the save dialog opens.
    read_bounded_png(file, &metadata.content_type)
}

#[tauri::command]
pub async fn plugin_blob_prepare_png_export(
    webview: tauri::Webview,
    source: String,
    plugin_id: String,
    blob_id: String,
    suggested_filename: Option<String>,
) -> Result<PreparePngExportResult, String> {
    super::validate_plugin_kv_namespace(&source, &plugin_id).map_err(|_| UNAVAILABLE.to_string())?;
    let (export_id, lease) = reserve_export(
        &mut webview.resources_table(),
        source.clone(),
        plugin_id.clone(),
        Instant::now(),
    )?;
    let mut reservation = ExportReservation {
        webview: webview.clone(),
        export_id,
        keep: false,
    };
    let bytes =
        tauri::async_runtime::spawn_blocking(move || load_png_blob(&source, &plugin_id, &blob_id))
            .await
            .map_err(|_| UNAVAILABLE.to_string())??;
    if !source_is_current(&webview, export_id, &lease) {
        return Err(INVALID_LEASE.into());
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    let dialog = webview
        .app_handle()
        .dialog()
        .file()
        .add_filter("PNG", &["png"])
        .set_file_name(suggested_png_filename(suggested_filename.as_deref()));
    #[cfg(desktop)]
    let dialog = {
        let paths = webview.app_handle().path();
        let directory = [paths.picture_dir(), paths.download_dir(), paths.home_dir()]
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
    let selection = rx.await.map_err(|_| UNAVAILABLE.to_string())?;
    let Some(selection) = selection else {
        return Ok(PreparePngExportResult::Cancelled);
    };
    if !source_is_current(&webview, export_id, &lease) {
        return Err(INVALID_LEASE.into());
    }
    let destination = selection.into_path().map_err(|_| UNAVAILABLE.to_string())?;
    // Preserve the EXACT dialog-selected path. Appending an extension here could
    // otherwise overwrite a different file without the OS overwrite prompt.
    *lease
        .prepared
        .lock()
        .map_err(|_| INVALID_LEASE.to_string())? = Some(PreparedPngExport {
        destination,
        bytes,
        prepared_at: Instant::now(),
    });
    reservation.keep = true;
    Ok(PreparePngExportResult::Prepared { export_id })
}

fn consume_export(
    table: &mut ResourceTable,
    export_id: ResourceId,
    source: &str,
    plugin_id: &str,
    now: Instant,
) -> Result<PreparedPngExport, String> {
    let lease = table
        .get::<PngExportLease>(export_id)
        .map_err(|_| INVALID_LEASE.to_string())?;
    if lease.source != source || lease.plugin_id != plugin_id {
        return Err(INVALID_LEASE.into());
    }
    // Taking the resource under the table lock makes commit/discard/replay race
    // for a single lease. Failed/expired commits cannot later be retried to write.
    let lease = table
        .take::<PngExportLease>(export_id)
        .map_err(|_| INVALID_LEASE.to_string())?;
    let ready = lease
        .prepared
        .lock()
        .map_err(|_| INVALID_LEASE.to_string())?
        .take()
        .ok_or_else(|| INVALID_LEASE.to_string())?;
    if now.saturating_duration_since(ready.prepared_at) >= PREPARED_TTL {
        return Err(INVALID_LEASE.into());
    }
    Ok(ready)
}

fn write_png_atomic_with(
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
    // Same-directory persistence atomically replaces an existing destination;
    // write failure leaves it intact and the temporary file is removed on drop.
    temporary
        .persist(destination)
        .map_err(|_| WRITE_FAILED.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn plugin_blob_commit_png_export(
    webview: tauri::Webview,
    source: String,
    plugin_id: String,
    export_id: ResourceId,
) -> Result<CommitPngExportResult, String> {
    let lease = webview
        .resources_table()
        .get::<PngExportLease>(export_id)
        .map_err(|_| INVALID_LEASE.to_string())?;
    if !source_is_current(&webview, export_id, &lease) {
        return Err(INVALID_LEASE.into());
    }
    let ready = consume_export(
        &mut webview.resources_table(),
        export_id,
        &source,
        &plugin_id,
        Instant::now(),
    )?;
    tauri::async_runtime::spawn_blocking(move || {
        write_png_atomic_with(&ready.destination, &ready.bytes, |file, bytes| {
            file.write_all(bytes)
        })
    })
    .await
    .map_err(|_| WRITE_FAILED.to_string())??;
    Ok(CommitPngExportResult::Saved)
}

#[tauri::command]
pub fn plugin_blob_discard_png_export(webview: tauri::Webview, export_id: ResourceId) {
    // Idempotent and type-specific: cannot discard images or another webview's
    // resources, and safely handles a host finally block after successful commit.
    let _ = webview.resources_table().take::<PngExportLease>(export_id);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_png() -> Vec<u8> {
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, 1, 1);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder
                .add_text_chunk("test".into(), "PNG export".into())
                .unwrap();
            encoder
                .write_header()
                .unwrap()
                .write_image_data(&[0, 0, 0, 255])
                .unwrap();
        }
        bytes
    }

    fn prepared(table: &mut ResourceTable, now: Instant) -> ResourceId {
        let (id, lease) = reserve_export(table, "installed".into(), "qr-code".into(), now).unwrap();
        *lease.prepared.lock().unwrap() = Some(PreparedPngExport {
            destination: PathBuf::from("only-native-dialog-knows-this.png"),
            bytes: fixture_png(),
            prepared_at: now,
        });
        id
    }

    #[test]
    fn png_requires_valid_bytes_crc_dimensions_and_mime() {
        let png = fixture_png();
        assert!(validate_png(&png).is_ok());
        assert!(read_bounded_png(png.as_slice(), "image/jpeg").is_err());
        assert!(validate_png(b"not a png").is_err());
        assert!(validate_png(&png[..png.len() - 4]).is_err());
        let mut bad_crc = png.clone();
        bad_crc[29] ^= 1;
        assert!(validate_png(&bad_crc).is_err());
        let mut bad_ancillary_crc = png.clone();
        let chunk = png
            .windows(4)
            .position(|kind| kind == b"tEXt")
            .unwrap();
        let length = u32::from_be_bytes(png[chunk - 4..chunk].try_into().unwrap()) as usize;
        bad_ancillary_crc[chunk + 4 + length] ^= 1;
        assert!(validate_png(&bad_ancillary_crc).is_err());
        let mut too_wide = png.clone();
        too_wide[16..20].copy_from_slice(&(MAX_PNG_SIDE + 1).to_be_bytes());
        assert!(validate_png(&too_wide).is_err());
        let mut too_many_pixels = png.clone();
        too_many_pixels[16..20].copy_from_slice(&8192u32.to_be_bytes());
        too_many_pixels[20..24].copy_from_slice(&8192u32.to_be_bytes());
        assert!(validate_png(&too_many_pixels).is_err());
        assert!(read_bounded_png(std::io::repeat(0), "image/png").is_err());
    }

    #[test]
    fn filename_is_only_a_safe_suggestion() {
        assert_eq!(suggested_png_filename(Some(" QR 图像 ")), "QR 图像.png");
        assert_eq!(suggested_png_filename(Some("QR.PNG")), "QR.PNG");
        for bad in ["/tmp/secret", "../secret", "C:\\secret", "a\nb.png", ""] {
            assert_eq!(suggested_png_filename(Some(bad)), "image.png");
        }
    }

    #[test]
    fn leases_are_owner_scoped_webview_local_and_single_use() {
        let mut table = ResourceTable::default();
        let now = Instant::now();
        let id = prepared(&mut table, now);
        assert!(consume_export(&mut table, id, "installed", "other", now).is_err());
        assert!(consume_export(&mut table, id, "builtin", "qr-code", now).is_err());
        assert!(consume_export(
            &mut ResourceTable::default(),
            id,
            "installed",
            "qr-code",
            now,
        )
        .is_err());
        let ready = consume_export(&mut table, id, "installed", "qr-code", now).unwrap();
        assert_eq!(ready.bytes, fixture_png());
        assert!(consume_export(&mut table, id, "installed", "qr-code", now).is_err());
        let cancelled = prepared(&mut table, now);
        table.take::<PngExportLease>(cancelled).unwrap();
        assert!(consume_export(&mut table, cancelled, "installed", "qr-code", now).is_err());
    }

    #[test]
    fn pending_slots_are_bounded_and_expired_tickets_are_removed() {
        let now = Instant::now();
        let mut table = ResourceTable::default();
        let expired = prepared(&mut table, now);
        for _ in 1..MAX_PENDING_EXPORTS {
            reserve_export(&mut table, "installed".into(), "qr-code".into(), now).unwrap();
        }
        assert!(reserve_export(&mut table, "installed".into(), "qr-code".into(), now).is_err());
        assert!(reserve_export(
            &mut table,
            "installed".into(),
            "qr-code".into(),
            now + PREPARED_TTL,
        )
        .is_ok());
        assert!(!table.has(expired));
        assert!(reserve_export(
            &mut table,
            "installed".into(),
            "qr-code".into(),
            now + PREPARED_TTL * 3,
        )
        .is_err());
        let mut table = ResourceTable::default();
        let expired = prepared(&mut table, now);
        assert!(consume_export(
            &mut table,
            expired,
            "installed",
            "qr-code",
            now + PREPARED_TTL,
        )
        .is_err());
        assert!(!table.has(expired));
    }

    #[test]
    fn replaced_resource_identity_and_competing_commits_cannot_reuse_a_lease() {
        let now = Instant::now();
        let mut table = ResourceTable::default();
        let id = prepared(&mut table, now);
        let original = table.get::<PngExportLease>(id).unwrap();
        assert!(table_has_export(&table, id, &original));
        assert!(!table_has_export(&ResourceTable::default(), id, &original));
        table.replace(
            id,
            PngExportLease {
                source: "installed".into(),
                plugin_id: "qr-code".into(),
                prepared: Mutex::new(None),
            },
        );
        assert!(!table_has_export(&table, id, &original));

        let id = prepared(&mut table, now);
        let table = Mutex::new(table);
        std::thread::scope(|scope| {
            let run = || {
                consume_export(&mut table.lock().unwrap(), id, "installed", "qr-code", now).is_ok()
            };
            let first = scope.spawn(run);
            let second = scope.spawn(run);
            assert_ne!(first.join().unwrap(), second.join().unwrap());
        });
    }

    #[test]
    fn failed_write_preserves_previous_file_and_cleans_temporary_file() {
        let dir = tempfile::tempdir().unwrap();
        let destination = dir.path().join("export.png");
        std::fs::write(&destination, b"original").unwrap();
        let result = write_png_atomic_with(&destination, &fixture_png(), |file, _| {
            file.write_all(b"partial")?;
            Err(std::io::Error::other("private filesystem details"))
        });
        assert_eq!(result.unwrap_err(), WRITE_FAILED);
        assert_eq!(std::fs::read(&destination).unwrap(), b"original");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
        let png = fixture_png();
        write_png_atomic_with(&destination, &png, |file, bytes| file.write_all(bytes)).unwrap();
        assert_eq!(std::fs::read(&destination).unwrap(), png);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn blob_namespace_errors_do_not_expose_private_paths() {
        assert_eq!(
            load_png_blob("../outside", "qr-code", "blob").unwrap_err(),
            UNAVAILABLE,
        );
        assert_eq!(
            load_png_blob("installed", "../other", "blob").unwrap_err(),
            UNAVAILABLE,
        );
        assert_eq!(
            load_png_blob("installed", "qr-code", "../other").unwrap_err(),
            UNAVAILABLE,
        );
    }
}
