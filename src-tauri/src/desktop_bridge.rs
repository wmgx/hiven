//! Localhost bridge for D3 browser tabs + D4 editor documents.
//!
//! Chromium / VS Code extensions push snapshots and poll focus commands.
//! Launcher reads via Tauri commands — no extension process required for list
//! when the bridge has a fresh snapshot.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// Fixed loopback port so first-party extensions can hardcode discovery.
pub const DESKTOP_BRIDGE_PORT: u16 = 19246;
/// Freshness window: health fails (silent empty list) after this.
const SNAPSHOT_FRESH_MS: u128 = 5_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeTarget {
    pub id: String,
    pub window_id: Option<String>,
    pub title: String,
    pub url: Option<String>,
    pub path: Option<String>,
    pub active: Option<bool>,
    pub app_name: Option<String>,
    pub kind: Option<String>,
    /// Favicon URL from the browser extension (`chrome.tabs.favIconUrl`).
    pub favicon_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeFocusCommand {
    pub id: String,
    pub window_id: Option<String>,
    pub enqueued_at_ms: u64,
}

#[derive(Debug, Default)]
struct SourceState {
    targets: Vec<BridgeTarget>,
    last_seen: Option<Instant>,
    pending_focus: Option<BridgeFocusCommand>,
    app_name: Option<String>,
}

#[derive(Debug, Default)]
struct BridgeState {
    sources: HashMap<String, SourceState>,
    started: bool,
}

fn bridge_state() -> &'static Mutex<BridgeState> {
    static STATE: OnceLock<Mutex<BridgeState>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(BridgeState::default()))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn is_fresh(last: Option<Instant>) -> bool {
    match last {
        Some(t) => t.elapsed().as_millis() <= SNAPSHOT_FRESH_MS,
        None => false,
    }
}

/// Start the loopback HTTP bridge once (idempotent).
pub fn start_desktop_bridge_server() {
    let mut guard = match bridge_state().lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    if guard.started {
        return;
    }
    guard.started = true;
    drop(guard);

    thread::Builder::new()
        .name("hiven-desktop-bridge".into())
        .spawn(|| {
            let addr = format!("127.0.0.1:{}", DESKTOP_BRIDGE_PORT);
            let listener = match TcpListener::bind(&addr) {
                Ok(l) => l,
                Err(error) => {
                    eprintln!(
                        "[hiven] desktop bridge bind failed on {}: {}",
                        addr, error
                    );
                    return;
                }
            };
            let _ = listener.set_nonblocking(false);
            eprintln!("[hiven] desktop bridge listening on {}", addr);
            for stream in listener.incoming() {
                match stream {
                    Ok(stream) => {
                        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                        let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
                        // Soft-fail incomplete/empty clients without spamming EOF parse noise.
                        if let Err(error) = handle_http(stream) {
                            let lower = error.to_lowercase();
                            if lower.contains("empty")
                                || lower.contains("incomplete")
                                || lower.contains("eof")
                            {
                                // common during extension unload / half-closed sockets
                            } else {
                                eprintln!("[hiven] desktop bridge request error: {}", error);
                            }
                        }
                    }
                    Err(error) => {
                        eprintln!("[hiven] desktop bridge accept error: {}", error);
                    }
                }
            }
        })
        .ok();
}

fn handle_http(mut stream: TcpStream) -> Result<(), String> {
    let (method, path, body) = read_http_request(&mut stream)?;
    let (status, body_out) = route_request(&method, &path, body)?;
    write_http_response(&mut stream, status, &body_out)
}

/// Read a full HTTP/1.x request (headers + Content-Length body).
/// A single `stream.read` often returns only headers while the body is still
/// in flight — that produced empty-body JSON EOFs in the logs.
fn read_http_request(stream: &mut TcpStream) -> Result<(String, String, String), String> {
    let mut raw = Vec::with_capacity(8192);
    let mut chunk = [0u8; 8192];
    let header_end = loop {
        let n = stream
            .read(&mut chunk)
            .map_err(|e| format!("read: {}", e))?;
        if n == 0 {
            break None;
        }
        raw.extend_from_slice(&chunk[..n]);
        if let Some(pos) = find_header_end(&raw) {
            break Some(pos);
        }
        if raw.len() > 256 * 1024 {
            return Err("http headers too large".to_string());
        }
    };
    let Some(header_end) = header_end else {
        return Err("empty or incomplete http request".to_string());
    };

    let header = String::from_utf8_lossy(&raw[..header_end]).into_owned();
    let mut body = raw[header_end + 4..].to_vec();

    let content_length = parse_content_length(&header).unwrap_or(0);
    while body.len() < content_length {
        let n = stream
            .read(&mut chunk)
            .map_err(|e| format!("read body: {}", e))?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..n]);
        if body.len() > 2 * 1024 * 1024 {
            return Err("http body too large".to_string());
        }
    }
    if content_length > 0 && body.len() > content_length {
        body.truncate(content_length);
    }

    let mut lines = header.lines();
    let request_line = lines.next().ok_or_else(|| "empty request".to_string())?;
    let mut parts = request_line.split_whitespace();
    let method = parts
        .next()
        .ok_or_else(|| "missing method".to_string())?
        .to_string();
    let path = parts
        .next()
        .ok_or_else(|| "missing path".to_string())?
        .to_string();
    let body = String::from_utf8_lossy(&body).into_owned();
    Ok((method, path, body))
}

fn find_header_end(raw: &[u8]) -> Option<usize> {
    raw.windows(4).position(|w| w == b"\r\n\r\n")
}

fn parse_content_length(header: &str) -> Option<usize> {
    for line in header.lines().skip(1) {
        let (name, value) = line.split_once(':')?;
        if name.eq_ignore_ascii_case("content-length") {
            return value.trim().parse().ok();
        }
    }
    None
}

fn write_http_response(stream: &mut TcpStream, status: u16, body: &str) -> Result<(), String> {
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Error",
    };
    let response = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nConnection: close\r\n\r\n{}",
        status,
        reason,
        body.len(),
        body
    );
    stream
        .write_all(response.as_bytes())
        .map_err(|e| format!("write: {}", e))?;
    Ok(())
}

fn route_request(method: &str, path: &str, body: String) -> Result<(u16, String), String> {
    if method == "OPTIONS" {
        return Ok((204, String::new()));
    }
    if method == "GET" && path == "/health" {
        return Ok((
            200,
            serde_json::json!({
                "ok": true,
                "port": DESKTOP_BRIDGE_PORT,
                "service": "hiven-desktop-bridge",
            })
            .to_string(),
        ));
    }

    // POST /v1/sources/{id}/snapshot
    if method == "POST" {
        if let Some(source_id) = path
            .strip_prefix("/v1/sources/")
            .and_then(|rest| rest.strip_suffix("/snapshot"))
        {
            return apply_snapshot(source_id, &body);
        }
    }

    // GET /v1/sources/{id}/commands
    if method == "GET" {
        if let Some(source_id) = path
            .strip_prefix("/v1/sources/")
            .and_then(|rest| rest.strip_suffix("/commands"))
        {
            return take_commands(source_id);
        }
    }

    // GET /v1/sources/{id}/targets  (debug / extension self-check)
    if method == "GET" {
        if let Some(source_id) = path
            .strip_prefix("/v1/sources/")
            .and_then(|rest| rest.strip_suffix("/targets"))
        {
            return list_source_json(source_id);
        }
    }

    Ok((404, r#"{"error":"not found"}"#.to_string()))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotBody {
    targets: Option<Vec<BridgeTarget>>,
    tabs: Option<Vec<BridgeTarget>>,
    app_name: Option<String>,
}

fn apply_snapshot(source_id: &str, body: &str) -> Result<(u16, String), String> {
    let trimmed = body.trim();
    // Incomplete TCP frames or empty POSTs must not spam the log as hard errors.
    if trimmed.is_empty() {
        return Ok((
            400,
            r#"{"ok":false,"error":"empty body"}"#.to_string(),
        ));
    }
    let parsed: SnapshotBody = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(error) => {
            return Ok((
                400,
                serde_json::json!({ "ok": false, "error": format!("invalid snapshot json: {}", error) })
                    .to_string(),
            ));
        }
    };
    let mut targets = parsed
        .targets
        .or(parsed.tabs)
        .unwrap_or_default();
    // Normalize kinds
    for t in &mut targets {
        if t.kind.as_deref().unwrap_or("").is_empty() {
            t.kind = Some(if source_id.starts_with("editor.") {
                "document".into()
            } else {
                "tab".into()
            });
        }
        if t.app_name.is_none() {
            t.app_name = parsed.app_name.clone();
        }
    }
    let mut guard = bridge_state()
        .lock()
        .map_err(|_| "bridge lock poisoned".to_string())?;
    let entry = guard.sources.entry(source_id.to_string()).or_default();
    entry.targets = targets;
    entry.last_seen = Some(Instant::now());
    if parsed.app_name.is_some() {
        entry.app_name = parsed.app_name;
    }
    Ok((
        200,
        serde_json::json!({ "ok": true, "count": entry.targets.len() }).to_string(),
    ))
}

fn take_commands(source_id: &str) -> Result<(u16, String), String> {
    let mut guard = bridge_state()
        .lock()
        .map_err(|_| "bridge lock poisoned".to_string())?;
    let entry = guard.sources.entry(source_id.to_string()).or_default();
    let mut commands = Vec::new();
    if let Some(cmd) = entry.pending_focus.take() {
        commands.push(serde_json::json!({
            "type": "focus",
            "id": cmd.id,
            "windowId": cmd.window_id,
            "enqueuedAtMs": cmd.enqueued_at_ms,
        }));
    }
    Ok((
        200,
        serde_json::json!({ "commands": commands }).to_string(),
    ))
}

fn list_source_json(source_id: &str) -> Result<(u16, String), String> {
    let guard = bridge_state()
        .lock()
        .map_err(|_| "bridge lock poisoned".to_string())?;
    let Some(entry) = guard.sources.get(source_id) else {
        return Ok((
            200,
            serde_json::json!({ "targets": [], "fresh": false }).to_string(),
        ));
    };
    Ok((
        200,
        serde_json::json!({
            "targets": entry.targets,
            "fresh": is_fresh(entry.last_seen),
            "appName": entry.app_name,
        })
        .to_string(),
    ))
}

// ── Tauri commands ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBridgeTargetDto {
    pub id: String,
    pub source_id: String,
    pub kind: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub url: Option<String>,
    pub path: Option<String>,
    pub window_id: Option<String>,
    pub app_name: Option<String>,
    pub active: Option<bool>,
    pub favicon_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBridgeStatus {
    pub running: bool,
    pub port: u16,
    pub sources: Vec<DesktopBridgeSourceStatus>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBridgeSourceStatus {
    pub source_id: String,
    pub fresh: bool,
    pub target_count: usize,
    pub app_name: Option<String>,
}

#[tauri::command]
pub fn desktop_bridge_status() -> Result<DesktopBridgeStatus, String> {
    let guard = bridge_state()
        .lock()
        .map_err(|_| "bridge lock poisoned".to_string())?;
    let sources = guard
        .sources
        .iter()
        .map(|(id, s)| DesktopBridgeSourceStatus {
            source_id: id.clone(),
            fresh: is_fresh(s.last_seen),
            target_count: s.targets.len(),
            app_name: s.app_name.clone(),
        })
        .collect();
    Ok(DesktopBridgeStatus {
        running: guard.started,
        port: DESKTOP_BRIDGE_PORT,
        sources,
    })
}

#[tauri::command]
pub fn list_desktop_bridge_targets(
    source_id: Option<String>,
) -> Result<Vec<DesktopBridgeTargetDto>, String> {
    let guard = bridge_state()
        .lock()
        .map_err(|_| "bridge lock poisoned".to_string())?;
    let mut out = Vec::new();
    for (sid, state) in &guard.sources {
        if let Some(filter) = source_id.as_deref() {
            if sid != filter {
                continue;
            }
        }
        if !is_fresh(state.last_seen) {
            continue;
        }
        for t in &state.targets {
            let kind = t
                .kind
                .clone()
                .unwrap_or_else(|| "tab".to_string());
            let subtitle = t
                .url
                .clone()
                .or_else(|| t.path.clone())
                .or_else(|| t.app_name.clone())
                .or_else(|| state.app_name.clone());
            out.push(DesktopBridgeTargetDto {
                id: t.id.clone(),
                source_id: sid.clone(),
                kind,
                title: if t.title.trim().is_empty() {
                    t.url
                        .clone()
                        .or_else(|| t.path.clone())
                        .unwrap_or_else(|| "(untitled)".into())
                } else {
                    t.title.clone()
                },
                subtitle,
                favicon_url: t.favicon_url.clone(),
                url: t.url.clone(),
                path: t.path.clone(),
                window_id: t.window_id.clone(),
                app_name: t.app_name.clone().or_else(|| state.app_name.clone()),
                active: t.active,
            });
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn focus_desktop_bridge_target(
    source_id: String,
    id: String,
    window_id: Option<String>,
) -> Result<(), String> {
    let mut guard = bridge_state()
        .lock()
        .map_err(|_| "bridge lock poisoned".to_string())?;
    let entry = guard
        .sources
        .get_mut(&source_id)
        .ok_or_else(|| format!("source not connected: {}", source_id))?;
    if !is_fresh(entry.last_seen) {
        return Err(format!("source snapshot stale: {}", source_id));
    }
    entry.pending_focus = Some(BridgeFocusCommand {
        id,
        window_id,
        enqueued_at_ms: now_ms(),
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_content_length_header() {
        let header = "POST /x HTTP/1.1\r\nContent-Length: 12\r\nHost: 127.0.0.1\r\n";
        assert_eq!(parse_content_length(header), Some(12));
    }

    #[test]
    fn empty_snapshot_body_is_soft_400() {
        let (status, body) = apply_snapshot("browser.chromium", "   ").unwrap();
        assert_eq!(status, 400);
        assert!(body.contains("empty body"));
    }

    #[test]
    fn snapshot_and_list_fresh() {
        let body = r#"{"appName":"Chrome","tabs":[{"id":"1","windowId":"w1","title":"Example","url":"https://example.com","active":true}]}"#;
        let (status, _) = apply_snapshot("browser.chromium", body).unwrap();
        assert_eq!(status, 200);
        let listed = list_desktop_bridge_targets(Some("browser.chromium".into())).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].title, "Example");
        focus_desktop_bridge_target(
            "browser.chromium".into(),
            "1".into(),
            Some("w1".into()),
        )
        .unwrap();
        let (st, json) = take_commands("browser.chromium").unwrap();
        assert_eq!(st, 200);
        assert!(json.contains("\"type\":\"focus\""));
    }
}
