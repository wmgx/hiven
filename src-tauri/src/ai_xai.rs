use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{ipc::Channel, AppHandle, Manager};

#[path = "ai_xai_stream.rs"]
mod stream;
use stream::{forward_response_stream, RunRegistry};

const CLIENT_ID: &str = "b1a00492-073a-47ea-816f-4c329264a828";
const SCOPE: &str = "openid profile email offline_access grok-cli:access api:access";
const DEVICE_URL: &str = "https://auth.x.ai/oauth2/device/code";
const TOKEN_URL: &str = "https://auth.x.ai/oauth2/token";
const API_URL: &str = "https://cli-chat-proxy.grok.com/v1";

#[derive(Clone, Deserialize, Serialize, PartialEq)]
struct XaiAuth {
    access_token: String,
    refresh_token: String,
    expires_at: u64,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
}

#[derive(Deserialize)]
struct DeviceResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    verification_uri_complete: Option<String>,
    expires_in: Option<u64>,
    interval: Option<u64>,
}

static LOGIN_ACTIVE: OnceLock<Mutex<bool>> = OnceLock::new();
static AUTH_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
static AUTH_FILE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static ACTIVE_RUNS: OnceLock<RunRegistry> = OnceLock::new();

fn proxy_headers(builder: reqwest::RequestBuilder, model: Option<&str>) -> reqwest::RequestBuilder {
    let version =
        std::env::var("HIVEN_XAI_CLIENT_VERSION").unwrap_or_else(|_| "0.2.101".to_string());
    let mut builder = builder
        .header("user-agent", format!("grok-shell/{}", version))
        .header("x-grok-client-identifier", "grok-shell")
        .header("x-grok-client-version", version)
        .header("x-grok-client-mode", "interactive")
        .header("x-xai-token-auth", "xai-grok-cli")
        .header("x-authenticateresponse", "authenticate-response");
    if let Some(model) = model {
        builder = builder.header("x-grok-model-override", model);
    }
    builder
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn auth_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?
        .join("ai")
        .join("xai-auth.json"))
}

fn read_auth(app: &AppHandle) -> Result<Option<XaiAuth>, String> {
    read_auth_file(&auth_path(app)?)
}

fn read_auth_file(path: &Path) -> Result<Option<XaiAuth>, String> {
    match fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text)
            .map(Some)
            .map_err(|error| error.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn write_auth(app: &AppHandle, auth: &XaiAuth) -> Result<(), String> {
    let _guard = AUTH_FILE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|error| error.to_string())?;
    write_auth_unlocked(app, auth)
}

fn write_auth_unlocked(app: &AppHandle, auth: &XaiAuth) -> Result<(), String> {
    write_auth_file(&auth_path(app)?, auth)
}

fn write_auth_file(path: &Path, auth: &XaiAuth) -> Result<(), String> {
    let parent = path.parent().ok_or("xAI auth path has no parent")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec(auth).map_err(|error| error.to_string())?;
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temp).map_err(|error| error.to_string())?;
    file.write_all(&bytes).map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    fs::rename(temp, path).map_err(|error| error.to_string())
}

async fn decode_response(response: reqwest::Response, action: &str) -> Result<Value, String> {
    let status = response.status();
    let text = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(format!("{} failed ({}): {}", action, status.as_u16(), text));
    }
    serde_json::from_str(&text)
        .map_err(|error| format!("{} returned invalid JSON: {}", action, error))
}

fn auth_from_tokens(tokens: TokenResponse, old_refresh: Option<&str>) -> Result<XaiAuth, String> {
    let refresh_token = tokens
        .refresh_token
        .or_else(|| old_refresh.map(str::to_owned))
        .ok_or("xAI did not return a refresh token")?;
    Ok(XaiAuth {
        access_token: tokens.access_token,
        refresh_token,
        expires_at: now_seconds() + tokens.expires_in.unwrap_or(3600),
    })
}

async fn refresh_auth(app: &AppHandle) -> Result<Option<XaiAuth>, String> {
    let guard = AUTH_LOCK
        .get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await;
    let Some(auth) = read_auth(app)? else {
        return Ok(None);
    };
    if auth.expires_at > now_seconds() + 120 {
        return Ok(Some(auth));
    }
    // Only a refresh that owns the lock needs to survive a cancelled waiter.
    // Cancelled runs waiting for the lock never start extra refresh requests.
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _guard = guard;
        finish_auth_refresh(&app, auth).await
    })
    .await
    .map_err(|error| error.to_string())?
}

async fn finish_auth_refresh(app: &AppHandle, auth: XaiAuth) -> Result<Option<XaiAuth>, String> {
    let response = reqwest::Client::new()
        .post(TOKEN_URL)
        .timeout(Duration::from_secs(30))
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", auth.refresh_token.as_str()),
            ("client_id", CLIENT_ID),
        ])
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let value = decode_response(response, "xAI token refresh").await?;
    let tokens: TokenResponse = serde_json::from_value(value).map_err(|error| error.to_string())?;
    let refreshed = auth_from_tokens(tokens, Some(&auth.refresh_token))?;
    commit_refreshed_auth(&auth_path(app)?, &auth, &refreshed)?;
    Ok(Some(refreshed))
}

fn commit_refreshed_auth(path: &Path, previous: &XaiAuth, refreshed: &XaiAuth) -> Result<(), String> {
    // A run may stop waiting while this refresh finishes rotating its token.
    // Serialize the compare/write with login/logout so it cannot revive an old session.
    let _file_guard = AUTH_FILE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|error| error.to_string())?;
    if read_auth_file(path)?.as_ref() != Some(previous) {
        return Err("xAI sign-in changed during token refresh".to_string());
    }
    write_auth_file(path, refreshed)
}

async fn poll_login(app: AppHandle, device: DeviceResponse) {
    let client = reqwest::Client::new();
    let deadline = now_seconds() + device.expires_in.unwrap_or(300);
    let mut interval = device.interval.unwrap_or(5).max(1);
    while now_seconds() < deadline {
        tokio::time::sleep(Duration::from_secs(interval)).await;
        let response = client
            .post(TOKEN_URL)
            .form(&[
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
                ("client_id", CLIENT_ID),
                ("device_code", device.device_code.as_str()),
            ])
            .send()
            .await;
        let Ok(response) = response else { continue };
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        if status.is_success() {
            if let Ok(tokens) = serde_json::from_str::<TokenResponse>(&text) {
                if let Ok(auth) = auth_from_tokens(tokens, None) {
                    let _ = write_auth(&app, &auth);
                }
            }
            break;
        }
        let error = serde_json::from_str::<Value>(&text).ok().and_then(|value| {
            value
                .get("error")
                .and_then(Value::as_str)
                .map(str::to_owned)
        });
        match error.as_deref() {
            Some("authorization_pending") => continue,
            Some("slow_down") => interval += 5,
            _ => break,
        }
    }
    if let Ok(mut active) = LOGIN_ACTIVE.get_or_init(|| Mutex::new(false)).lock() {
        *active = false;
    }
}

#[tauri::command]
pub async fn ai_xai_login_start(app: AppHandle) -> Result<Value, String> {
    {
        let mut active = LOGIN_ACTIVE
            .get_or_init(|| Mutex::new(false))
            .lock()
            .map_err(|error| error.to_string())?;
        if *active {
            return Err("xAI sign-in is already in progress".to_string());
        }
        *active = true;
    }
    let result = async {
        let response = reqwest::Client::new()
            .post(DEVICE_URL)
            .form(&[
                ("client_id", CLIENT_ID),
                ("scope", SCOPE),
                ("referrer", "hiven"),
            ])
            .send()
            .await
            .map_err(|error| error.to_string())?;
        let value = decode_response(response, "xAI device authorization").await?;
        serde_json::from_value::<DeviceResponse>(value).map_err(|error| error.to_string())
    }
    .await;
    let device = match result {
        Ok(device) => device,
        Err(error) => {
            if let Ok(mut active) = LOGIN_ACTIVE.get_or_init(|| Mutex::new(false)).lock() {
                *active = false;
            }
            return Err(error);
        }
    };
    let url = device
        .verification_uri_complete
        .clone()
        .unwrap_or_else(|| device.verification_uri.clone());
    let code = device.user_code.clone();
    tauri::async_runtime::spawn(poll_login(app, device));
    Ok(json!({ "url": url, "verificationCode": code }))
}

#[tauri::command]
pub async fn ai_xai_describe(app: AppHandle) -> Result<Value, String> {
    let Some(auth) = refresh_auth(&app).await? else {
        return Ok(json!({ "status": "login_required", "models": [] }));
    };
    let client = reqwest::Client::new();
    let response = proxy_headers(client.get(format!("{}/models", API_URL)), None)
        .bearer_auth(&auth.access_token)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let models = decode_response(response, "xAI model discovery").await?;
    let user = match proxy_headers(client.get(format!("{}/user", API_URL)), None)
        .bearer_auth(&auth.access_token)
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => response
            .text()
            .await
            .ok()
            .and_then(|text| serde_json::from_str::<Value>(&text).ok()),
        _ => None,
    };
    let user_id = user
        .as_ref()
        .and_then(|value| value.get("userId"))
        .and_then(Value::as_str);
    let billing = if let Some(user_id) = user_id {
        match proxy_headers(
            client.get(format!("{}/billing?format=credits", API_URL)),
            None,
        )
        .bearer_auth(&auth.access_token)
        .header("x-userid", user_id)
        .send()
        .await
        {
            Ok(response) if response.status().is_success() => response
                .text()
                .await
                .ok()
                .and_then(|text| serde_json::from_str::<Value>(&text).ok()),
            _ => None,
        }
    } else {
        None
    };
    Ok(json!({
        "status": "ready",
        "models": models.get("data").cloned().unwrap_or_else(|| json!([])),
        "user": user,
        "billing": billing,
    }))
}

fn image_data_url(path: &str) -> Result<String, String> {
    let mime = match std::path::Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        _ => "image/png",
    };
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    Ok(format!("data:{};base64,{}", mime, BASE64.encode(bytes)))
}

fn response_input(input: Value) -> Result<Value, String> {
    let items = input.as_array().ok_or("xAI input must be an array")?;
    let mut content = Vec::new();
    for item in items {
        match item.get("type").and_then(Value::as_str) {
            Some("text") => content.push(json!({
                "type": "input_text",
                "text": item.get("text").and_then(Value::as_str).unwrap_or_default(),
            })),
            Some("localImage") => content.push(json!({
                "type": "input_image",
                "image_url": image_data_url(item.get("path").and_then(Value::as_str).ok_or("xAI image path is missing")?)?,
            })),
            _ => return Err("The Grok subscription provider supports text and image inputs".to_string()),
        }
    }
    Ok(json!([{ "role": "user", "content": content }]))
}

async fn run_response_stream(
    app: &AppHandle,
    model: &str,
    input: Value,
    effort: Option<String>,
    web_search: bool,
    on_event: &Channel<Value>,
) -> Result<(), String> {
    let auth = refresh_auth(app)
        .await?
        .ok_or("Connect a Grok subscription first")?;
    let mut body = json!({
        "model": model,
        "input": response_input(input)?,
        "store": false,
        "stream": true,
    });
    if let Some(effort) = effort {
        body["reasoning"] = json!({ "effort": effort });
    }
    if web_search {
        body["tools"] = json!([{ "type": "web_search" }]);
    }
    let body = serde_json::to_string(&body).map_err(|error| error.to_string())?;
    let response = proxy_headers(
        reqwest::Client::new()
            .post(format!("{}/responses", API_URL))
            .bearer_auth(&auth.access_token),
        Some(model),
    )
    .header("content-type", "application/json")
    .body(body)
    .send()
    .await
    .map_err(|error| error.to_string())?;
    forward_response_stream(response, |event| {
        on_event.send(event).map_err(|error| error.to_string())
    }).await
}

#[tauri::command]
pub async fn ai_xai_response_stream(
    app: AppHandle,
    run_id: String,
    model: String,
    input: Value,
    effort: Option<String>,
    web_search: bool,
    on_event: Channel<Value>,
) -> Result<(), String> {
    // Register before auth, input conversion or the first await. The guard cleans
    // up success, errors, cancellation, and a dropped command future alike.
    let run = ACTIVE_RUNS.get_or_init(RunRegistry::default).register(&run_id)?;
    match run.until_cancelled(run_response_stream(
        &app, &model, input, effort, web_search, &on_event,
    )).await {
        Some(result) => result,
        None => on_event.send(json!({ "type": "hiven.cancelled" }))
            .map_err(|error| error.to_string()),
    }
}

#[tauri::command]
pub fn ai_xai_cancel(run_id: String) {
    ACTIVE_RUNS.get_or_init(RunRegistry::default).cancel(&run_id);
}

#[tauri::command]
pub fn ai_xai_logout(app: AppHandle) -> Result<(), String> {
    let _guard = AUTH_FILE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|error| error.to_string())?;
    let path = auth_path(&app)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refresh_commit_preserves_rotation_but_cannot_restore_logout_or_replace_login() {
        let directory = std::env::temp_dir().join(format!(
            "hiven-xai-auth-fixture-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos(),
        ));
        let path = directory.join("auth.json");
        let previous = XaiAuth {
            access_token: "fixture-access-not-a-real-token".into(),
            refresh_token: "fixture-refresh-not-a-real-token".into(),
            expires_at: 1,
        };
        let refreshed = XaiAuth {
            access_token: "fixture-rotated-access".into(),
            refresh_token: "fixture-rotated-refresh".into(),
            expires_at: 2,
        };
        write_auth_file(&path, &previous).unwrap();
        commit_refreshed_auth(&path, &previous, &refreshed).unwrap();
        assert!(read_auth_file(&path).unwrap().as_ref() == Some(&refreshed));

        // Logging out while a detached refresh is in flight must stay logged out.
        fs::remove_file(&path).unwrap();
        assert!(commit_refreshed_auth(&path, &previous, &refreshed).is_err());
        assert!(!path.exists());

        // A different login must not be overwritten by the old refresh result.
        write_auth_file(&path, &refreshed).unwrap();
        assert!(commit_refreshed_auth(&path, &previous, &previous).is_err());
        assert!(read_auth_file(&path).unwrap().as_ref() == Some(&refreshed));
        fs::remove_dir_all(directory).unwrap();
    }
}
