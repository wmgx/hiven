//! Text-only Ollama bridge. The endpoint is fixed; the local service is trusted.
//! Metadata checks reject known cloud/remote models, but cannot attest a server's behavior.

use crate::ai_run_registry::RunRegistry;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::OnceLock;
use std::time::Duration;
use tauri::ipc::Channel;

#[path = "ai_ollama_stream.rs"]
mod stream;
use stream::forward_response_stream;

const BASE_URL: &str = "http://127.0.0.1:11434";
const MAX_METADATA_BYTES: usize = 2 * 1024 * 1024;
const MAX_MODELS: usize = 128;
// Transport/memory bounds, not claims about a model's context or token budget.
const MAX_INPUT_BYTES: usize = 256 * 1024;
const MAX_REQUEST_BYTES: usize = 2 * 1024 * 1024;
const METADATA_TIMEOUT: Duration = Duration::from_secs(2);
const DISCOVERY_TIMEOUT: Duration = Duration::from_secs(8);
const RUN_TIMEOUT: Duration = Duration::from_secs(180);
static ACTIVE_RUNS: OnceLock<RunRegistry> = OnceLock::new();

type Result<T> = std::result::Result<T, &'static str>;

struct OllamaClient {
    client: reqwest::Client,
    base: String,
}

impl OllamaClient {
    fn local() -> Result<Self> {
        Ok(Self {
            client: Self::http_client()?,
            base: BASE_URL.into(),
        })
    }

    fn http_client() -> Result<reqwest::Client> {
        reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(METADATA_TIMEOUT)
            .timeout(RUN_TIMEOUT)
            .build()
            .map_err(|_| "OLLAMA_SERVICE_UNREACHABLE")
    }

    async fn metadata(&self, path: &str, body: Option<Value>) -> Result<Value> {
        let url = format!("{}{}", self.base, path);
        let builder = if let Some(body) = body {
            self.client
                .post(url)
                .header("content-type", "application/json")
                .body(body.to_string())
        } else {
            self.client.get(url)
        };
        let mut response = builder
            .timeout(METADATA_TIMEOUT)
            .send()
            .await
            .map_err(|error| {
                if error.is_timeout() {
                    "OLLAMA_METADATA_TIMEOUT"
                } else {
                    "OLLAMA_SERVICE_UNREACHABLE"
                }
            })?;
        if !response.status().is_success() {
            return Err("OLLAMA_METADATA_INVALID");
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|error| {
            if error.is_timeout() {
                "OLLAMA_METADATA_TIMEOUT"
            } else {
                "OLLAMA_METADATA_INVALID"
            }
        })? {
            if bytes.len().saturating_add(chunk.len()) > MAX_METADATA_BYTES {
                return Err("OLLAMA_METADATA_INVALID");
            }
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&bytes).map_err(|_| "OLLAMA_METADATA_INVALID")
    }

    async fn tags(&self) -> Result<Vec<Value>> {
        let value = self.metadata("/api/tags", None).await?;
        let entries = value
            .get("models")
            .and_then(Value::as_array)
            .ok_or("OLLAMA_METADATA_INVALID")?;
        if entries.len() > MAX_MODELS {
            return Err("OLLAMA_METADATA_INVALID");
        }
        Ok(entries.clone())
    }

    async fn show(&self, model: &str) -> Result<Value> {
        self.metadata("/api/show", Some(json!({ "model": model })))
            .await
    }

    async fn selected_model(&self, id: &str) -> Result<LocalModel> {
        if !valid_model_id(id) {
            return Err("OLLAMA_MODEL_UNAVAILABLE");
        }
        let tags = self.tags().await?;
        let entry = unique_model(&tags, id).ok_or("OLLAMA_MODEL_UNAVAILABLE")?;
        let show = self.show(id).await?;
        let model = confirmed_model(entry, &show).ok_or("OLLAMA_MODEL_UNAVAILABLE")?;
        // Catch an ordinary tag change during show. This is not an atomic server attestation.
        let after = self.tags().await?;
        let current = unique_model(&after, id)
            .and_then(tag_model)
            .ok_or("OLLAMA_MODEL_UNAVAILABLE")?;
        if current != model {
            return Err("OLLAMA_MODEL_UNAVAILABLE");
        }
        Ok(model)
    }

    async fn chat(
        &self,
        model: &str,
        input: Value,
        on_event: &mut impl FnMut(Value) -> Result<()>,
    ) -> Result<()> {
        let text = text_input(input)?;
        self.selected_model(model).await?;
        let body = json!({
            "model": model,
            "messages": [{ "role": "user", "content": text }],
            "stream": true,
        })
        .to_string();
        if body.len() > MAX_REQUEST_BYTES {
            return Err("OLLAMA_INPUT_TOO_LARGE");
        }
        // No tools, format/schema, effort, credentials, automatic pull, or fallback.
        let response = self
            .client
            .post(format!("{}/api/chat", self.base))
            .header("content-type", "application/json")
            .body(body)
            .send()
            .await
            .map_err(|error| {
                if error.is_timeout() {
                    "OLLAMA_TIMEOUT"
                } else {
                    "OLLAMA_SERVICE_UNREACHABLE"
                }
            })?;
        forward_response_stream(response, model, on_event).await
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct LocalModel {
    id: String,
    digest: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Description {
    models: Vec<LocalModel>,
    status_reason: Option<&'static str>,
    complete: bool,
}

impl Description {
    fn unavailable(reason: &'static str) -> Self {
        Self {
            models: Vec::new(),
            status_reason: Some(reason),
            complete: false,
        }
    }
}

fn reason(error: &str) -> &'static str {
    match error {
        "OLLAMA_SERVICE_UNREACHABLE" => "service_unreachable",
        "OLLAMA_METADATA_TIMEOUT" => "metadata_timeout",
        _ => "metadata_invalid",
    }
}

// Name checks only reject obvious cloud variants. Positive eligibility requires
// installed bytes/digest, GGUF details, model metadata, and completion capability.
fn valid_model_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 256
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_:./".contains(&byte))
        && !id.contains("//")
        && !id
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
        && !id
            .to_ascii_lowercase()
            .split(['-', '_', ':', '.', '/'])
            .any(|part| part == "cloud" || part == "remote")
}

fn empty_marker(value: &Value) -> bool {
    value.is_null() || value.as_str() == Some("") || value.as_bool() == Some(false)
}

/// Known remote routing metadata is disqualifying anywhere in returned model details.
fn has_remote_metadata(value: &Value) -> bool {
    match value {
        Value::Object(fields) => fields.iter().any(|(key, value)| {
            let key = key.to_ascii_lowercase();
            ((key.starts_with("remote")
                || key.starts_with("cloud")
                || key == "is_remote"
                || key == "is_cloud")
                && !empty_marker(value))
                || has_remote_metadata(value)
        }),
        Value::Array(values) => values.iter().any(has_remote_metadata),
        _ => false,
    }
}

fn tag_model(entry: &Value) -> Option<LocalModel> {
    let id = entry.get("name")?.as_str()?;
    if !valid_model_id(id) || has_remote_metadata(entry) {
        return None;
    }
    if entry
        .get("capabilities")
        .and_then(Value::as_array)
        .is_some_and(|values| {
            values
                .iter()
                .any(|value| matches!(value.as_str(), Some("cloud" | "remote")))
        })
    {
        return None;
    }
    if entry
        .get("model")
        .is_some_and(|value| value.as_str() != Some(id))
    {
        return None;
    }
    if entry.get("size")?.as_u64()? == 0 {
        return None;
    }
    if entry.pointer("/details/format")?.as_str()? != "gguf" {
        return None;
    }
    let digest = entry.get("digest")?.as_str()?;
    let hex = digest.strip_prefix("sha256:").unwrap_or(digest);
    if hex.len() != 64 || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    Some(LocalModel {
        id: id.into(),
        digest: digest.into(),
    })
}

fn unique_model<'a>(tags: &'a [Value], id: &str) -> Option<&'a Value> {
    let mut matches = tags
        .iter()
        .filter(|entry| entry.get("name").and_then(Value::as_str) == Some(id));
    let model = matches.next()?;
    if matches.next().is_some() {
        return None;
    }
    Some(model)
}

fn confirmed_model(entry: &Value, show: &Value) -> Option<LocalModel> {
    let model = tag_model(entry)?;
    if has_remote_metadata(show) || show.get("error").is_some() {
        return None;
    }
    // Multi-manifest/runner selection is not supported by this minimal adapter.
    if show.get("manifests").is_some_and(|value| {
        !value.is_null() && value.as_array().map_or(true, |items| !items.is_empty())
    }) {
        return None;
    }
    if show.pointer("/details/format")?.as_str()? != "gguf" {
        return None;
    }
    let info = show.get("model_info")?.as_object()?;
    if info.get("general.architecture")?.as_str()?.is_empty() {
        return None;
    }
    let capabilities = show.get("capabilities")?.as_array()?;
    if !capabilities.iter().all(Value::is_string)
        || !capabilities
            .iter()
            .any(|value| value.as_str() == Some("completion"))
        || capabilities
            .iter()
            .any(|value| matches!(value.as_str(), Some("cloud" | "remote")))
    {
        return None;
    }
    Some(model)
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
enum TextInput {
    Text { text: String },
}

fn text_input(value: Value) -> Result<String> {
    let items: Vec<TextInput> =
        serde_json::from_value(value).map_err(|_| "OLLAMA_INPUT_UNSUPPORTED")?;
    if items.is_empty() {
        return Err("OLLAMA_INPUT_UNSUPPORTED");
    }
    let mut text = String::new();
    for (index, TextInput::Text { text: part }) in items.into_iter().enumerate() {
        if text
            .len()
            .saturating_add(part.len())
            .saturating_add(usize::from(index > 0))
            > MAX_INPUT_BYTES
        {
            return Err("OLLAMA_INPUT_TOO_LARGE");
        }
        if index > 0 {
            text.push('\n');
        }
        text.push_str(&part);
    }
    if text.trim().is_empty() {
        return Err("OLLAMA_INPUT_UNSUPPORTED");
    }
    Ok(text)
}

async fn describe(client: &OllamaClient) -> Description {
    let deadline = tokio::time::Instant::now() + DISCOVERY_TIMEOUT;
    let tags = match client.tags().await {
        Ok(tags) => tags,
        Err(error) => return Description::unavailable(reason(error)),
    };
    if tags.is_empty() {
        return Description::unavailable("models_empty");
    }
    let mut models = Vec::new();
    let mut seen = HashSet::new();
    let mut metadata_error = None;
    for entry in &tags {
        let Some(tag) = tag_model(entry) else {
            continue;
        };
        if unique_model(&tags, &tag.id).is_none() || !seen.insert(tag.id.clone()) {
            continue;
        }
        match tokio::time::timeout_at(deadline, client.show(&tag.id)).await {
            Ok(Ok(show)) => {
                if let Some(model) = confirmed_model(entry, &show) {
                    models.push(model);
                }
            }
            Ok(Err(error)) => {
                metadata_error = Some(reason(error));
            }
            Err(_) => {
                metadata_error = Some("metadata_timeout");
                break;
            }
        }
    }
    if models.is_empty() {
        Description::unavailable(metadata_error.unwrap_or("models_unsupported"))
    } else {
        Description {
            models,
            status_reason: None,
            complete: metadata_error.is_none(),
        }
    }
}

#[tauri::command]
pub async fn ai_ollama_describe() -> Description {
    match OllamaClient::local() {
        Ok(client) => describe(&client).await,
        Err(error) => Description::unavailable(reason(error)),
    }
}

#[tauri::command]
pub async fn ai_ollama_chat_stream(
    run_id: String,
    model: String,
    input: Value,
    on_event: Channel<Value>,
) -> std::result::Result<(), String> {
    // Register before the first await; the shared gate handles cancel-before-start.
    let run = ACTIVE_RUNS
        .get_or_init(RunRegistry::default)
        .register(&run_id)
        .map_err(|_| "OLLAMA_STREAM_INVALID".to_string())?;
    let work = async {
        let client = OllamaClient::local()?;
        let mut send = |event| on_event.send(event).map_err(|_| "OLLAMA_CHANNEL_CLOSED");
        tokio::time::timeout(RUN_TIMEOUT, client.chat(&model, input, &mut send))
            .await
            .unwrap_or(Err("OLLAMA_TIMEOUT"))
    };
    match run.until_cancelled(work).await {
        Some(result) => result.map_err(str::to_string),
        None => on_event
            .send(json!({ "type": "completed", "status": "cancelled" }))
            .map_err(|_| "OLLAMA_CHANNEL_CLOSED".to_string()),
    }
}

#[tauri::command]
pub fn ai_ollama_cancel(run_id: String) {
    ACTIVE_RUNS
        .get_or_init(RunRegistry::default)
        .cancel(&run_id);
}

#[cfg(test)]
#[path = "ai_ollama_tests.rs"]
mod tests;
