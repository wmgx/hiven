//! Byte-framed, bounded Ollama NDJSON. Model output is data, never an action.
use super::{has_remote_metadata, Result};
use serde_json::{json, Value};

const MAX_LINE_BYTES: usize = 1024 * 1024;
const MAX_STREAM_BYTES: usize = 8 * 1024 * 1024;

#[derive(Default)]
struct Decoder {
    line: Vec<u8>,
    received: usize,
    has_text: bool,
}

impl Decoder {
    fn push(
        &mut self,
        bytes: &[u8],
        model: &str,
        send: &mut impl FnMut(Value) -> Result<()>,
    ) -> Result<bool> {
        // Parse and dispatch each line before reading the next. A valid terminal
        // frame is independent of malformed or oversized bytes after it.
        for &byte in bytes {
            self.received += 1;
            if self.received > MAX_STREAM_BYTES {
                return Err("OLLAMA_STREAM_TOO_LARGE");
            }
            if byte == b'\n' {
                if self.frame(model, send)? {
                    return Ok(true);
                }
            } else {
                if self.line.len() >= MAX_LINE_BYTES {
                    return Err("OLLAMA_STREAM_TOO_LARGE");
                }
                self.line.push(byte);
            }
        }
        Ok(false)
    }

    fn frame(&mut self, model: &str, send: &mut impl FnMut(Value) -> Result<()>) -> Result<bool> {
        let line = std::mem::take(&mut self.line);
        if line.iter().all(u8::is_ascii_whitespace) {
            return Ok(false);
        }
        let event: Value = serde_json::from_slice(&line).map_err(|_| "OLLAMA_STREAM_INVALID")?;
        if event.get("error").is_some() {
            return Err("OLLAMA_HTTP_ERROR");
        }
        if has_remote_metadata(&event) {
            return Err("OLLAMA_MODEL_UNAVAILABLE");
        }
        let response_model = event
            .get("model")
            .and_then(Value::as_str)
            .ok_or("OLLAMA_STREAM_INVALID")?;
        if response_model != model {
            return Err("OLLAMA_MODEL_UNAVAILABLE");
        }
        let done = event
            .get("done")
            .and_then(Value::as_bool)
            .ok_or("OLLAMA_STREAM_INVALID")?;
        let message = event
            .get("message")
            .and_then(Value::as_object)
            .ok_or("OLLAMA_STREAM_INVALID")?;
        if message.get("role").and_then(Value::as_str) != Some("assistant") {
            return Err("OLLAMA_STREAM_INVALID");
        }
        if message.get("tool_calls").is_some_and(|value| {
            !value.is_null() && value.as_array().map_or(true, |calls| !calls.is_empty())
        }) {
            return Err("OLLAMA_TOOL_CALL_UNSUPPORTED");
        }
        let content = message
            .get("content")
            .map(|value| value.as_str().ok_or("OLLAMA_STREAM_INVALID"))
            .transpose()?
            .unwrap_or("");
        let thinking = message
            .get("thinking")
            .map(|value| value.as_str().ok_or("OLLAMA_STREAM_INVALID"))
            .transpose()?
            .unwrap_or("");
        let mut metrics = Vec::new();
        if done {
            match event.get("done_reason").and_then(Value::as_str) {
                Some("stop") => (),
                Some("length") => return Err("OLLAMA_OUTPUT_TRUNCATED"),
                _ => return Err("OLLAMA_STREAM_INCOMPLETE"),
            }
            for (field, kind) in [
                ("prompt_eval_count", "input_tokens"),
                ("eval_count", "output_tokens"),
            ] {
                if let Some(value) = event.get(field) {
                    let amount = value
                        .as_u64()
                        .filter(|value| *value <= 9_007_199_254_740_991)
                        .ok_or("OLLAMA_STREAM_INVALID")?;
                    metrics.push(json!({ "kind": kind, "amount": amount, "unit": "token" }));
                }
            }
        }
        if !thinking.is_empty() {
            send(json!({ "type": "reasoning.delta", "delta": thinking }))?;
        }
        if !content.is_empty() {
            self.has_text |= !content.trim().is_empty();
            send(json!({ "type": "text.delta", "delta": content }))?;
        }
        if done {
            if !self.has_text {
                return Err("OLLAMA_STREAM_INCOMPLETE");
            }
            if !metrics.is_empty() {
                send(json!({ "type": "usage.updated", "metrics": metrics }))?;
            }
            send(json!({ "type": "completed", "status": "completed" }))?;
        }
        Ok(done)
    }
}

pub(super) async fn forward_response_stream(
    mut response: reqwest::Response,
    model: &str,
    send: &mut impl FnMut(Value) -> Result<()>,
) -> Result<()> {
    if !response.status().is_success() {
        return Err("OLLAMA_HTTP_ERROR");
    }
    let mut decoder = Decoder::default();
    while let Some(chunk) = response.chunk().await.map_err(|error| {
        if error.is_timeout() {
            "OLLAMA_TIMEOUT"
        } else {
            "OLLAMA_STREAM_INCOMPLETE"
        }
    })? {
        if decoder.push(&chunk, model, send)? {
            return Ok(());
        }
    }
    // A full terminal JSON object may be the final frame without a newline.
    if !decoder.line.is_empty() && decoder.frame(model, send)? {
        return Ok(());
    }
    Err("OLLAMA_STREAM_INCOMPLETE")
}

#[cfg(test)]
#[path = "ai_ollama_stream_tests.rs"]
mod tests;
