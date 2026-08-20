//! Localhost bridge for D3 browser tabs.
//!
//! Chromium extensions push tab snapshots, history, and page events, then poll
//! commands (focus / open / config). Launcher and the learning layer read via
//! Tauri commands — no extension process required for list when the bridge has
//! a fresh snapshot.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// Cap retained history items per source (extension already trims before POST).
const HISTORY_CAP: usize = 300;
/// Cap retained page events per source (ring buffer, newest last).
const EVENT_CAP: usize = 256;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeOpenCommand {
    pub url: String,
    pub enqueued_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeSourceConfig {
    pub history_enabled: bool,
    pub auto_close_idle_tabs: bool,
    pub idle_timeout_minutes: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeHistoryItem {
    pub id: String,
    pub title: String,
    pub url: String,
    pub last_visit_time: Option<f64>,
    pub visit_count: Option<u32>,
    pub typed_count: Option<u32>,
    pub favicon_url: Option<String>,
    pub app_name: Option<String>,
    /// Individual visit timestamps (chrome.history.getVisits), newest last.
    ///
    /// `visit_count` + `last_visit_time` cannot distinguish "25 visits over three
    /// frantic days" from "25 visits spread over four months" — the span signal
    /// that separates a habit from a burst. This carries the real distribution
    /// when the extension can supply it.
    ///
    /// `serde(default)`: extensions predating this field omit it entirely, and
    /// their POSTs must keep deserializing rather than failing wholesale.
    #[serde(default)]
    pub visits: Option<Vec<f64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub ts: u64,
    pub tab_id: Option<String>,
    pub window_id: Option<String>,
    pub title: Option<String>,
    pub url: Option<String>,
    pub favicon_url: Option<String>,
    pub app_name: Option<String>,
}

#[derive(Debug, Default)]
struct SourceState {
    targets: Vec<BridgeTarget>,
    history: Vec<BridgeHistoryItem>,
    events: VecDeque<BridgeEvent>,
    last_seen: Option<Instant>,
    pending_focus: Option<BridgeFocusCommand>,
    pending_open: Option<BridgeOpenCommand>,
    config: Option<BridgeSourceConfig>,
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
        if let Some(source_id) = path
            .strip_prefix("/v1/sources/")
            .and_then(|rest| rest.strip_suffix("/history"))
        {
            return apply_history(source_id, &body);
        }
        if let Some(source_id) = path
            .strip_prefix("/v1/sources/")
            .and_then(|rest| rest.strip_suffix("/events"))
        {
            return apply_events(source_id, &body);
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
    if let Some(cmd) = entry.pending_open.take() {
        commands.push(serde_json::json!({
            "type": "open",
            "url": cmd.url,
            "enqueuedAtMs": cmd.enqueued_at_ms,
        }));
    }
    // Config is sticky: re-sent every poll so a sleeping worker still converges.
    if let Some(cfg) = &entry.config {
        commands.push(serde_json::json!({
            "type": "config",
            "historyEnabled": cfg.history_enabled,
            "autoCloseIdleTabs": cfg.auto_close_idle_tabs,
            "idleTimeoutMinutes": cfg.idle_timeout_minutes,
        }));
    }
    Ok((
        200,
        serde_json::json!({ "commands": commands }).to_string(),
    ))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryBody {
    items: Option<Vec<BridgeHistoryItem>>,
    history: Option<Vec<BridgeHistoryItem>>,
    app_name: Option<String>,
}

fn apply_history(source_id: &str, body: &str) -> Result<(u16, String), String> {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return Ok((400, r#"{"ok":false,"error":"empty body"}"#.to_string()));
    }
    let parsed: HistoryBody = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(error) => {
            return Ok((
                400,
                serde_json::json!({ "ok": false, "error": format!("invalid history json: {}", error) })
                    .to_string(),
            ));
        }
    };
    let mut items = parsed.items.or(parsed.history).unwrap_or_default();
    if items.len() > HISTORY_CAP {
        items.truncate(HISTORY_CAP);
    }
    for item in &mut items {
        if item.app_name.is_none() {
            item.app_name = parsed.app_name.clone();
        }
    }
    let mut guard = bridge_state()
        .lock()
        .map_err(|_| "bridge lock poisoned".to_string())?;
    let entry = guard.sources.entry(source_id.to_string()).or_default();
    entry.history = items;
    if parsed.app_name.is_some() {
        entry.app_name = parsed.app_name;
    }
    Ok((
        200,
        serde_json::json!({ "ok": true, "count": entry.history.len() }).to_string(),
    ))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EventsBody {
    events: Option<Vec<BridgeEvent>>,
    app_name: Option<String>,
}

fn apply_events(source_id: &str, body: &str) -> Result<(u16, String), String> {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return Ok((400, r#"{"ok":false,"error":"empty body"}"#.to_string()));
    }
    let parsed: EventsBody = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(error) => {
            return Ok((
                400,
                serde_json::json!({ "ok": false, "error": format!("invalid events json: {}", error) })
                    .to_string(),
            ));
        }
    };
    let incoming = parsed.events.unwrap_or_default();
    let mut guard = bridge_state()
        .lock()
        .map_err(|_| "bridge lock poisoned".to_string())?;
    let entry = guard.sources.entry(source_id.to_string()).or_default();
    for mut event in incoming {
        if event.event_type.trim().is_empty() {
            continue;
        }
        if event.app_name.is_none() {
            event.app_name = parsed.app_name.clone();
        }
        if event.ts == 0 {
            event.ts = now_ms();
        }
        entry.events.push_back(event);
        while entry.events.len() > EVENT_CAP {
            entry.events.pop_front();
        }
    }
    if parsed.app_name.is_some() {
        entry.app_name = parsed.app_name;
    }
    Ok((
        200,
        serde_json::json!({ "ok": true, "count": entry.events.len() }).to_string(),
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
    pub history_count: usize,
    pub event_count: usize,
    pub app_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBridgeHistoryDto {
    pub id: String,
    pub source_id: String,
    pub title: String,
    pub url: String,
    pub last_visit_time: Option<f64>,
    pub visit_count: Option<u32>,
    pub typed_count: Option<u32>,
    pub favicon_url: Option<String>,
    pub app_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBridgeEventDto {
    #[serde(rename = "type")]
    pub event_type: String,
    pub ts: u64,
    pub source_id: String,
    pub tab_id: Option<String>,
    pub window_id: Option<String>,
    pub title: Option<String>,
    pub url: Option<String>,
    pub favicon_url: Option<String>,
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
            history_count: s.history.len(),
            event_count: s.events.len(),
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

#[tauri::command]
pub fn list_desktop_bridge_history(
    source_id: Option<String>,
) -> Result<Vec<DesktopBridgeHistoryDto>, String> {
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
        for item in &state.history {
            out.push(DesktopBridgeHistoryDto {
                id: item.id.clone(),
                source_id: sid.clone(),
                title: if item.title.trim().is_empty() {
                    item.url.clone()
                } else {
                    item.title.clone()
                },
                url: item.url.clone(),
                last_visit_time: item.last_visit_time,
                visit_count: item.visit_count,
                typed_count: item.typed_count,
                favicon_url: item.favicon_url.clone(),
                app_name: item.app_name.clone().or_else(|| state.app_name.clone()),
            });
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn list_desktop_bridge_events(
    source_id: Option<String>,
    since_ts: Option<u64>,
) -> Result<Vec<DesktopBridgeEventDto>, String> {
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
        for event in &state.events {
            if let Some(min_ts) = since_ts {
                if event.ts <= min_ts {
                    continue;
                }
            }
            out.push(DesktopBridgeEventDto {
                event_type: event.event_type.clone(),
                ts: event.ts,
                source_id: sid.clone(),
                tab_id: event.tab_id.clone(),
                window_id: event.window_id.clone(),
                title: event.title.clone(),
                url: event.url.clone(),
                favicon_url: event.favicon_url.clone(),
                app_name: event.app_name.clone().or_else(|| state.app_name.clone()),
            });
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn open_desktop_bridge_url(source_id: String, url: String) -> Result<(), String> {
    let trimmed = url.trim().to_string();
    if trimmed.is_empty() {
        return Err("url required".into());
    }
    let mut guard = bridge_state()
        .lock()
        .map_err(|_| "bridge lock poisoned".to_string())?;
    let entry = guard.sources.entry(source_id).or_default();
    entry.pending_open = Some(BridgeOpenCommand {
        url: trimmed,
        enqueued_at_ms: now_ms(),
    });
    Ok(())
}

#[tauri::command]
pub fn set_desktop_bridge_source_config(
    source_id: String,
    history_enabled: bool,
    auto_close_idle_tabs: bool,
    idle_timeout_minutes: u32,
) -> Result<(), String> {
    let minutes = idle_timeout_minutes.clamp(5, 24 * 60);
    let mut guard = bridge_state()
        .lock()
        .map_err(|_| "bridge lock poisoned".to_string())?;
    let entry = guard.sources.entry(source_id).or_default();
    entry.config = Some(BridgeSourceConfig {
        history_enabled,
        auto_close_idle_tabs,
        idle_timeout_minutes: minutes,
    });
    if !history_enabled {
        entry.history.clear();
    }
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

    #[test]
    fn history_events_and_config_roundtrip() {
        let source = "browser.chromium.test-history";
        let history = r#"{"appName":"Chrome","items":[{"id":"h1","title":"Docs","url":"https://example.com/docs","visitCount":3}]}"#;
        let (status, _) = apply_history(source, history).unwrap();
        assert_eq!(status, 200);
        let listed = list_desktop_bridge_history(Some(source.into())).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].url, "https://example.com/docs");

        let events = r#"{"events":[{"type":"tab.opened","ts":100,"tabId":"2","url":"https://example.com/new","title":"New"},{"type":"tab.activated","ts":101,"tabId":"2","url":"https://example.com/new"}]}"#;
        let (status, _) = apply_events(source, events).unwrap();
        assert_eq!(status, 200);
        let all = list_desktop_bridge_events(Some(source.into()), None).unwrap();
        assert_eq!(all.len(), 2);
        let newer = list_desktop_bridge_events(Some(source.into()), Some(100)).unwrap();
        assert_eq!(newer.len(), 1);
        assert_eq!(newer[0].event_type, "tab.activated");

        set_desktop_bridge_source_config(source.into(), true, true, 45).unwrap();
        open_desktop_bridge_url(source.into(), "https://example.com/open".into()).unwrap();
        let (st, json) = take_commands(source).unwrap();
        assert_eq!(st, 200);
        assert!(json.contains("\"type\":\"open\""));
        assert!(json.contains("\"type\":\"config\""));
        assert!(json.contains("\"autoCloseIdleTabs\":true"));
        assert!(json.contains("\"idleTimeoutMinutes\":45"));
    }
}
