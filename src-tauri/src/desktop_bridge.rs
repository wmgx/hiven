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
use tauri::Emitter;

const BROWSER_BRIDGE_EVENTS_EVENT: &str = "hiven://browser-bridge-events";
static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

/// Cap retained history items per source (extension already trims before POST).
const HISTORY_CAP: usize = 300;
const HISTORY_IMPORT_CAP: usize = 5_000;
const HISTORY_IMPORT_BATCH_SIZE: usize = 500;
/// Cap retained page events per source (ring buffer, newest last).
const EVENT_CAP: usize = 256;

/// Fixed loopback port so first-party extensions can hardcode discovery.
pub const DESKTOP_BRIDGE_PORT: u16 = 19246;
/// Freshness window: health fails (silent empty list) after this.
const SNAPSHOT_FRESH_MS: u128 = 5_000;
const MAX_HTTP_BODY_BYTES: usize = 2 * 1024 * 1024;
// Validation relays JSON-encoded byte arrays; a permitted 10 MB image can expand to ~40 MB.
const MAX_VALIDATION_RESULT_BODY_BYTES: usize = 64 * 1024 * 1024;

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
struct HistoryImportState {
    batches: VecDeque<Vec<BridgeHistoryItem>>,
    received: usize,
    done: bool,
}

#[derive(Debug, Default)]
struct SourceState {
    targets: Vec<BridgeTarget>,
    history: Vec<BridgeHistoryItem>,
    events: VecDeque<BridgeEvent>,
    last_seen: Option<Instant>,
    pending_focus: Option<BridgeFocusCommand>,
    pending_open: Option<BridgeOpenCommand>,
    pending_history_import: Option<String>,
    history_imports: HashMap<String, HistoryImportState>,
    config: Option<BridgeSourceConfig>,
    app_name: Option<String>,
}

#[derive(Debug, Default)]
struct BridgeState {
    sources: HashMap<String, SourceState>,
    started: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ValidationRequest {
    id: String,
    /// Browser tab that queued the request; its events and native listeners are scoped to it.
    #[serde(default)]
    client_id: String,
    command: String,
    #[serde(default)]
    args: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ValidationResult {
    id: String,
    ok: bool,
    #[serde(default)]
    value: serde_json::Value,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ValidationEvent {
    #[serde(default)]
    client_id: String,
    callback_id: u32,
    payload: serde_json::Value,
}

/// A tab that stopped polling for this long is treated as closed. Chrome throttles hidden
/// tabs to about one timer wake-up per minute, so this must outlast that.
const VALIDATION_CLIENT_TTL: Duration = Duration::from_secs(90);
/// Browser invokes give up after 30s; results nobody collected by then are dropped.
const VALIDATION_RESULT_TTL: Duration = Duration::from_secs(60);
/// Per-tab event backlog, so a stalled tab cannot pin unbounded payloads.
const VALIDATION_EVENT_CAP: usize = 512;

#[derive(Debug)]
struct ValidationClient {
    last_seen: Instant,
    events: VecDeque<ValidationEvent>,
}

#[derive(Debug)]
struct ValidationState {
    token: String,
    requests: VecDeque<ValidationRequest>,
    results: HashMap<String, (Instant, ValidationResult)>,
    clients: HashMap<String, ValidationClient>,
}

impl ValidationState {
    fn new(token: String) -> Self {
        Self {
            token,
            requests: VecDeque::new(),
            results: HashMap::new(),
            clients: HashMap::new(),
        }
    }

    fn touch_client(&mut self, client_id: &str, now: Instant) {
        if client_id.is_empty() {
            return;
        }
        self.clients
            .entry(client_id.to_string())
            .or_insert_with(|| ValidationClient {
                last_seen: now,
                events: VecDeque::new(),
            })
            .last_seen = now;
    }

    /// Events for a tab that is not attached are dropped: nothing would ever drain them.
    fn push_event(&mut self, event: ValidationEvent) {
        let Some(client) = self.clients.get_mut(&event.client_id) else {
            return;
        };
        client.events.push_back(event);
        while client.events.len() > VALIDATION_EVENT_CAP {
            client.events.pop_front();
        }
    }

    fn drain_events(&mut self, client_id: &str, now: Instant) -> Vec<ValidationEvent> {
        self.touch_client(client_id, now);
        self.clients
            .get_mut(client_id)
            .map(|client| client.events.drain(..).collect())
            .unwrap_or_default()
    }

    fn prune(&mut self, now: Instant) {
        self.clients.retain(|_, client| {
            now.saturating_duration_since(client.last_seen) <= VALIDATION_CLIENT_TTL
        });
        self.results.retain(|_, (stored_at, _)| {
            now.saturating_duration_since(*stored_at) <= VALIDATION_RESULT_TTL
        });
        let clients = &self.clients;
        self.requests
            .retain(|request| clients.contains_key(&request.client_id));
    }

    fn client_ids(&self) -> Vec<String> {
        let mut ids: Vec<String> = self.clients.keys().cloned().collect();
        ids.sort();
        ids
    }
}

fn validation_state() -> &'static Mutex<ValidationState> {
    static STATE: OnceLock<Mutex<ValidationState>> = OnceLock::new();
    STATE.get_or_init(|| {
        let seed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        Mutex::new(ValidationState::new(format!(
            "{:x}-{:x}",
            seed,
            std::process::id()
        )))
    })
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
pub fn start_desktop_bridge_server(app_handle: tauri::AppHandle) {
    let _ = APP_HANDLE.set(app_handle);
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
                    eprintln!("[hiven] desktop bridge bind failed on {}: {}", addr, error);
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
    let (method, path, body, origin) = read_http_request(&mut stream)?;
    let (status, body_out) = route_request(&method, &path, body, origin.as_deref())?;
    write_http_response(&mut stream, status, &body_out)
}

/// Read a full HTTP/1.x request (headers + Content-Length body).
/// A single `stream.read` often returns only headers while the body is still
/// in flight — that produced empty-body JSON EOFs in the logs.
fn read_http_request(
    stream: &mut TcpStream,
) -> Result<(String, String, String, Option<String>), String> {
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
    let max_body_bytes = if header
        .lines()
        .next()
        .is_some_and(|line| line.contains(" /v1/validation/result?"))
    {
        MAX_VALIDATION_RESULT_BODY_BYTES
    } else {
        MAX_HTTP_BODY_BYTES
    };

    let content_length = parse_content_length(&header).unwrap_or(0);
    if content_length > max_body_bytes {
        return Err("http body too large".to_string());
    }
    while body.len() < content_length {
        let n = stream
            .read(&mut chunk)
            .map_err(|e| format!("read body: {}", e))?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..n]);
        if body.len() > max_body_bytes {
            return Err("http body too large".to_string());
        }
    }
    if content_length > 0 && body.len() > content_length {
        body.truncate(content_length);
    }

    let origin = header.lines().skip(1).find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.eq_ignore_ascii_case("origin")
            .then(|| value.trim().to_string())
    });
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
    Ok((method, path, body, origin))
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

fn route_request(
    method: &str,
    path: &str,
    body: String,
    origin: Option<&str>,
) -> Result<(u16, String), String> {
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

    if cfg!(debug_assertions) {
        if let Some(response) = route_validation_request(method, path, &body, origin)? {
            return Ok(response);
        }
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

fn route_validation_request(
    method: &str,
    path: &str,
    body: &str,
    origin: Option<&str>,
) -> Result<Option<(u16, String)>, String> {
    let (pathname, query) = path.split_once('?').unwrap_or((path, ""));
    if !pathname.starts_with("/v1/validation/") {
        return Ok(None);
    }

    let allowed_origin = matches!(
        origin,
        Some("http://127.0.0.1:1420")
            | Some("http://localhost:1420")
            | Some("http://tauri.localhost")
            | Some("https://tauri.localhost")
            | Some("tauri://localhost")
    );
    if !allowed_origin {
        return Ok(Some((400, r#"{"error":"origin not allowed"}"#.to_string())));
    }

    let now = Instant::now();
    let mut guard = validation_state()
        .lock()
        .map_err(|_| "validation bridge lock poisoned".to_string())?;
    guard.prune(now);

    if method == "GET" && pathname == "/v1/validation/session" {
        return Ok(Some((
            200,
            serde_json::json!({ "ok": true, "token": guard.token, "clients": guard.clients.len() })
                .to_string(),
        )));
    }

    if query_param(query, "token") != guard.token {
        return Ok(Some((
            400,
            r#"{"error":"invalid validation token"}"#.to_string(),
        )));
    }

    let response = match (method, pathname) {
        ("POST", "/v1/validation/invoke") => {
            let request: ValidationRequest = serde_json::from_str(body)
                .map_err(|error| format!("invalid validation request: {}", error))?;
            if request.id.is_empty() || request.command.is_empty() {
                (
                    400,
                    r#"{"error":"id and command are required"}"#.to_string(),
                )
            } else {
                guard.touch_client(&request.client_id, now);
                guard.requests.push_back(request);
                (200, r#"{"ok":true}"#.to_string())
            }
        }
        ("GET", "/v1/validation/requests") => {
            let requests: Vec<_> = guard.requests.drain(..).collect();
            // The desktop relay drops native listeners of tabs missing from `clients`.
            (
                200,
                serde_json::json!({ "requests": requests, "clients": guard.client_ids() })
                    .to_string(),
            )
        }
        ("POST", "/v1/validation/result") => {
            let result: ValidationResult = serde_json::from_str(body)
                .map_err(|error| format!("invalid validation result: {}", error))?;
            guard.results.insert(result.id.clone(), (now, result));
            (200, r#"{"ok":true}"#.to_string())
        }
        ("GET", "/v1/validation/result") => match guard.results.remove(query_param(query, "id")) {
            Some((_, result)) => (200, serde_json::to_string(&result).unwrap_or_default()),
            None => (204, String::new()),
        },
        ("POST", "/v1/validation/event") => {
            let event: ValidationEvent = serde_json::from_str(body)
                .map_err(|error| format!("invalid validation event: {}", error))?;
            guard.push_event(event);
            (200, r#"{"ok":true}"#.to_string())
        }
        ("GET", "/v1/validation/events") => {
            let events = guard.drain_events(query_param(query, "client"), now);
            (200, serde_json::json!({ "events": events }).to_string())
        }
        _ => (404, r#"{"error":"not found"}"#.to_string()),
    };
    Ok(Some(response))
}

fn query_param<'a>(query: &'a str, name: &str) -> &'a str {
    query
        .split('&')
        .find_map(|part| part.strip_prefix(name)?.strip_prefix('='))
        .unwrap_or("")
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
        return Ok((400, r#"{"ok":false,"error":"empty body"}"#.to_string()));
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
    let mut targets = parsed.targets.or(parsed.tabs).unwrap_or_default();
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
    if let Some(request_id) = entry.pending_history_import.take() {
        commands.push(serde_json::json!({
            "type": "history.import",
            "requestId": request_id,
            "maxResults": HISTORY_IMPORT_CAP,
            "batchSize": HISTORY_IMPORT_BATCH_SIZE,
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
    Ok((200, serde_json::json!({ "commands": commands }).to_string()))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryBody {
    items: Option<Vec<BridgeHistoryItem>>,
    history: Option<Vec<BridgeHistoryItem>>,
    app_name: Option<String>,
    request_id: Option<String>,
    done: Option<bool>,
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
    let cap = if parsed.request_id.is_some() {
        HISTORY_IMPORT_CAP
    } else {
        HISTORY_CAP
    };
    if items.len() > cap {
        items.truncate(cap);
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
    if let Some(request_id) = parsed.request_id {
        let count = items.len();
        let import = entry.history_imports.entry(request_id).or_default();
        import.received += count;
        if count > 0 {
            import.batches.push_back(items);
        }
        import.done = parsed.done.unwrap_or(true);
        return Ok((
            200,
            serde_json::json!({ "ok": true, "count": count, "received": import.received })
                .to_string(),
        ));
    }
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
    let mut accepted = Vec::new();
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
        accepted.push(event.clone());
        entry.events.push_back(event);
        while entry.events.len() > EVENT_CAP {
            entry.events.pop_front();
        }
    }
    if parsed.app_name.is_some() {
        entry.app_name = parsed.app_name;
    }
    let count = entry.events.len();
    drop(guard);
    if !accepted.is_empty() {
        if let Some(app_handle) = APP_HANDLE.get() {
            let _ = app_handle.emit(
                BROWSER_BRIDGE_EVENTS_EVENT,
                serde_json::json!({ "sourceId": source_id, "events": accepted }),
            );
        }
    }
    Ok((
        200,
        serde_json::json!({ "ok": true, "count": count }).to_string(),
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
            let kind = t.kind.clone().unwrap_or_else(|| "tab".to_string());
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBridgeHistoryImportStatus {
    pub items: Vec<DesktopBridgeHistoryDto>,
    pub received: usize,
    pub done: bool,
}

#[tauri::command]
pub fn begin_desktop_bridge_history_import(source_id: String) -> Result<String, String> {
    let request_id = format!("history-import-{}", now_ms());
    let mut guard = bridge_state()
        .lock()
        .map_err(|_| "bridge lock poisoned".to_string())?;
    let entry = guard
        .sources
        .get_mut(&source_id)
        .ok_or_else(|| format!("source not connected: {}", source_id))?;
    entry.pending_history_import = Some(request_id.clone());
    entry
        .history_imports
        .insert(request_id.clone(), HistoryImportState::default());
    Ok(request_id)
}

#[tauri::command]
pub fn desktop_bridge_history_import_status(
    source_id: String,
    request_id: String,
) -> Result<DesktopBridgeHistoryImportStatus, String> {
    let mut guard = bridge_state()
        .lock()
        .map_err(|_| "bridge lock poisoned".to_string())?;
    let entry = guard
        .sources
        .get_mut(&source_id)
        .ok_or_else(|| format!("source not connected: {}", source_id))?;
    let import = entry
        .history_imports
        .get_mut(&request_id)
        .ok_or_else(|| "browser history import not found".to_string())?;
    let batch = import.batches.pop_front().unwrap_or_default();
    let done = import.done && import.batches.is_empty();
    let received = import.received;
    let items = batch
        .into_iter()
        .map(|item| DesktopBridgeHistoryDto {
            id: item.id,
            source_id: source_id.clone(),
            title: if item.title.trim().is_empty() {
                item.url.clone()
            } else {
                item.title
            },
            url: item.url,
            last_visit_time: item.last_visit_time,
            visit_count: item.visit_count,
            typed_count: item.typed_count,
            favicon_url: item.favicon_url,
            app_name: item.app_name,
        })
        .collect();
    if done {
        entry.history_imports.remove(&request_id);
    }
    Ok(DesktopBridgeHistoryImportStatus {
        items,
        received,
        done,
    })
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
    let minutes = idle_timeout_minutes.max(5);
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
        focus_desktop_bridge_target("browser.chromium".into(), "1".into(), Some("w1".into()))
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

        {
            let mut guard = bridge_state().lock().unwrap();
            guard
                .sources
                .get_mut(source)
                .unwrap()
                .pending_history_import = Some("import-1".into());
        }
        let (_, commands) = take_commands(source).unwrap();
        assert!(commands.contains("\"type\":\"history.import\""));
        assert!(commands.contains("\"batchSize\":500"));
        let imported = r#"{"requestId":"import-1","items":[{"id":"h2","title":"Old","url":"https://example.com/old"}]}"#;
        apply_history(source, imported).unwrap();
        let guard = bridge_state().lock().unwrap();
        let state = guard.sources.get(source).unwrap();
        assert_eq!(
            state.history.len(),
            1,
            "full import must not replace the live snapshot"
        );
        assert_eq!(state.history_imports["import-1"].received, 1);
        assert!(state.history_imports["import-1"].done);
        drop(guard);
        let status =
            desktop_bridge_history_import_status(source.into(), "import-1".into()).unwrap();
        assert_eq!(status.items.len(), 1);
        assert!(status.done);

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

        set_desktop_bridge_source_config(source.into(), true, true, 10080).unwrap();
        let (st, json) = take_commands(source).unwrap();
        assert_eq!(st, 200);
        assert!(json.contains("\"idleTimeoutMinutes\":10080"));
    }

    fn validation_request(id: &str, client_id: &str) -> ValidationRequest {
        ValidationRequest {
            id: id.into(),
            client_id: client_id.into(),
            command: "noop".into(),
            args: serde_json::Value::Null,
        }
    }

    fn validation_event(client_id: &str, callback_id: u32) -> ValidationEvent {
        ValidationEvent {
            client_id: client_id.into(),
            callback_id,
            payload: serde_json::Value::Null,
        }
    }

    fn validation_result(id: &str) -> ValidationResult {
        ValidationResult {
            id: id.into(),
            ok: true,
            value: serde_json::Value::Null,
            error: None,
        }
    }

    #[test]
    fn validation_events_are_scoped_to_attached_tabs() {
        let now = Instant::now();
        let mut state = ValidationState::new("token".into());
        state.touch_client("tab-a", now);
        state.touch_client("tab-b", now);
        state.push_event(validation_event("tab-a", 1));
        state.push_event(validation_event("tab-b", 2));
        state.push_event(validation_event("closed-tab", 3));

        let tab_a = state.drain_events("tab-a", now);
        assert_eq!(
            tab_a
                .iter()
                .map(|event| event.callback_id)
                .collect::<Vec<_>>(),
            vec![1]
        );
        assert!(
            state.drain_events("tab-a", now).is_empty(),
            "draining must not replay events"
        );
        assert_eq!(
            state.drain_events("tab-b", now).len(),
            1,
            "a sibling tab keeps its own events"
        );
        assert!(
            !state.clients.contains_key("closed-tab"),
            "events for a detached tab must not create a backlog"
        );
    }

    #[test]
    fn validation_event_backlog_is_capped() {
        let now = Instant::now();
        let mut state = ValidationState::new("token".into());
        state.touch_client("stalled-tab", now);
        for callback_id in 0..(VALIDATION_EVENT_CAP as u32 + 10) {
            state.push_event(validation_event("stalled-tab", callback_id));
        }
        let events = state.drain_events("stalled-tab", now);
        assert_eq!(events.len(), VALIDATION_EVENT_CAP);
        assert_eq!(
            events[0].callback_id, 10,
            "the oldest events are dropped first"
        );
    }

    #[test]
    fn validation_prune_releases_detached_tabs_and_uncollected_results() {
        let start = Instant::now();
        let later = start + VALIDATION_CLIENT_TTL + Duration::from_secs(1);
        let mut state = ValidationState::new("token".into());
        state.touch_client("closed-tab", start);
        state.push_event(validation_event("closed-tab", 1));
        state
            .requests
            .push_back(validation_request("r-closed", "closed-tab"));
        state
            .results
            .insert("r-old".into(), (start, validation_result("r-old")));
        state.touch_client("open-tab", later);
        state
            .requests
            .push_back(validation_request("r-open", "open-tab"));
        state
            .results
            .insert("r-new".into(), (later, validation_result("r-new")));

        state.prune(later);

        assert_eq!(state.client_ids(), vec!["open-tab".to_string()]);
        assert_eq!(
            state
                .requests
                .iter()
                .map(|request| request.id.as_str())
                .collect::<Vec<_>>(),
            vec!["r-open"]
        );
        assert!(
            !state.results.contains_key("r-old"),
            "results nobody collected expire"
        );
        assert!(state.results.contains_key("r-new"));
    }
}
