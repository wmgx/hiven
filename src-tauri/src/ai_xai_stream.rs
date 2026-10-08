//! xAI transport mechanics, independent of Tauri and credentials.

use serde_json::Value;
const MAX_EVENT_BYTES: usize = 8 * 1024 * 1024;

/// Frame bytes before UTF-8 decoding: network chunks may split any code point.
/// Supports LF, CRLF, lone CR, comments, optional field spaces, and multiline data.
#[derive(Default)]
struct SseDecoder {
    line: Vec<u8>,
    data: String,
    has_data: bool,
    after_cr: bool,
    seen_line: bool,
}

impl SseDecoder {
    fn push(&mut self, bytes: &[u8]) -> Result<Vec<String>, String> {
        let mut events = Vec::new();
        for &byte in bytes {
            if self.after_cr {
                self.after_cr = false;
                if byte == b'\n' {
                    continue;
                }
            }
            if byte == b'\n' || byte == b'\r' {
                self.line(&mut events)?;
                self.after_cr = byte == b'\r';
            } else {
                if self.line.len() + self.data.len() >= MAX_EVENT_BYTES {
                    return Err("xAI stream event is too large".to_string());
                }
                self.line.push(byte);
            }
        }
        Ok(events)
    }

    fn line(&mut self, events: &mut Vec<String>) -> Result<(), String> {
        let bytes = std::mem::take(&mut self.line);
        let mut line = std::str::from_utf8(&bytes)
            .map_err(|_| "xAI stream returned invalid UTF-8".to_string())?;
        if !self.seen_line {
            line = line.strip_prefix('\u{feff}').unwrap_or(line);
            self.seen_line = true;
        }
        if line.is_empty() {
            self.dispatch(events);
        } else if let Some(value) = line.strip_prefix("data:") {
            let value = value.strip_prefix(' ').unwrap_or(value);
            if self.has_data {
                self.data.push('\n');
            }
            self.data.push_str(value);
            self.has_data = true;
        } else if line == "data" {
            if self.has_data {
                self.data.push('\n');
            }
            self.has_data = true;
        }
        Ok(())
    }

    fn dispatch(&mut self, events: &mut Vec<String>) {
        if self.has_data {
            events.push(std::mem::take(&mut self.data));
            self.has_data = false;
        }
    }

    fn finish(&mut self) -> Result<Vec<String>, String> {
        let mut events = Vec::new();
        if !self.line.is_empty() {
            self.line(&mut events)?;
        }
        // Some proxies close immediately after a complete final JSON frame.
        // Parse it, but never infer a successful response from transport EOF.
        self.dispatch(&mut events);
        Ok(events)
    }
}

fn forward_events(
    events: Vec<String>,
    on_event: &mut impl FnMut(Value) -> Result<(), String>,
) -> Result<bool, String> {
    for data in events {
        if data.trim().is_empty() {
            continue;
        }
        if data.trim() == "[DONE]" {
            return Err("xAI stream ended before a terminal response".to_string());
        }
        let event: Value = serde_json::from_str(&data)
            .map_err(|error| format!("xAI stream returned invalid JSON: {}", error))?;
        let event_type = event.get("type").and_then(Value::as_str)
            .ok_or("xAI stream event has no type")?;
        let terminal = matches!(event_type, "response.completed" | "response.failed" | "response.incomplete" | "error");
        on_event(event)?;
        if terminal {
            return Ok(true);
        }
    }
    Ok(false)
}

fn forward_chunk(
    decoder: &mut SseDecoder,
    bytes: &[u8],
    on_event: &mut impl FnMut(Value) -> Result<(), String>,
) -> Result<bool, String> {
    // Dispatch before decoding the next frame, even when the transport coalesces
    // them. A terminal response must not depend on invalid bytes in a later frame.
    for line in bytes.split_inclusive(|byte| *byte == b'\r' || *byte == b'\n') {
        if forward_events(decoder.push(line)?, on_event)? {
            return Ok(true);
        }
    }
    Ok(false)
}

pub(super) async fn forward_response_stream(
    mut response: reqwest::Response,
    mut on_event: impl FnMut(Value) -> Result<(), String>,
) -> Result<(), String> {
    if !response.status().is_success() {
        return Err(format!(
            "xAI response failed ({}): {}",
            response.status().as_u16(),
            response.text().await.unwrap_or_default()
        ));
    }
    let mut decoder = SseDecoder::default();
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        if forward_chunk(&mut decoder, &chunk, &mut on_event)? {
            return Ok(());
        }
    }
    if forward_events(decoder.finish()?, &mut on_event)? {
        Ok(())
    } else {
        Err("xAI stream ended before a terminal response".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai_run_registry::RunRegistry;
    use std::sync::Arc;
    use std::time::Duration;
    use serde_json::json;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::thread;
    use tokio::sync::oneshot;

    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap()
    }

    #[test]
    fn sse_preserves_utf8_at_every_chunk_boundary_and_crlf_split() {
        let data = r#"{"type":"response.output_text.delta","delta":"你好😀"}"#;
        let wire = format!("data: {}\r\n\r\n", data);
        for split in 0..=wire.len() {
            let mut decoder = SseDecoder::default();
            let mut events = decoder.push(&wire.as_bytes()[..split]).unwrap();
            events.extend(decoder.push(&wire.as_bytes()[split..]).unwrap());
            events.extend(decoder.finish().unwrap());
            assert_eq!(events, [data], "split at byte {}", split);
        }
        let mut decoder = SseDecoder::default();
        let events: Vec<_> = wire.as_bytes().iter().flat_map(|byte| decoder.push(&[*byte]).unwrap()).collect();
        assert_eq!(events, [data]);
    }

    #[test]
    fn sse_handles_multiline_comments_bom_and_all_line_endings() {
        for ending in ["\n", "\r\n", "\r"] {
            let wire = ["\u{feff}: keepalive", "event: response.completed", "id: 3", "retry: 1000", "data: {\"type\":", "data: \"response.completed\"}", "", ""].join(ending);
            let mut decoder = SseDecoder::default();
            let events = decoder.push(wire.as_bytes()).unwrap();
            let mut received = Vec::new();
            assert!(forward_events(events, &mut |event| { received.push(event); Ok(()) }).unwrap());
            assert_eq!(received, [json!({ "type": "response.completed" })]);
            assert!(decoder.finish().unwrap().is_empty());
        }
    }

    #[test]
    fn sse_retains_complete_eof_frame_but_rejects_invalid_utf8_and_oversize() {
        let mut decoder = SseDecoder::default();
        assert!(decoder.push(b"data: {\"type\":\"response.completed\"}").unwrap().is_empty());
        assert!(forward_events(decoder.finish().unwrap(), &mut |_| Ok(())).unwrap());
        assert!(SseDecoder::default().push(b"data: \xff\n\n").unwrap_err().contains("UTF-8"));
        assert!(SseDecoder::default().push(&vec![b'x'; MAX_EVENT_BYTES + 1]).unwrap_err().contains("too large"));
    }

    #[test]
    fn sse_stops_at_first_terminal_and_never_promotes_done_or_bad_json() {
        for terminal in ["response.completed", "response.failed", "response.incomplete", "error"] {
            let mut received = Vec::new();
            assert!(forward_events(vec![json!({"type": terminal}).to_string(), json!({"type": "response.output_text.delta", "delta": "late"}).to_string()], &mut |event| { received.push(event); Ok(()) }).unwrap());
            assert_eq!(received.len(), 1);
        }
        assert!(forward_events(vec!["[DONE]".to_owned()], &mut |_| Ok(())).unwrap_err().contains("terminal"));
        assert!(forward_events(vec!["{broken".to_owned()], &mut |_| Ok(())).unwrap_err().contains("invalid JSON"));
        assert!(forward_events(vec!["{}".to_owned()], &mut |_| Ok(())).unwrap_err().contains("no type"));
        assert_eq!(forward_events(vec![json!({"type":"response.completed"}).to_string()], &mut |_| Err("channel closed".to_string())), Err("channel closed".to_string()));
    }

    #[test]
    fn terminal_stops_decoding_same_chunk_before_invalid_or_oversized_tail() {
        let terminal = b"data: {\"type\":\"response.completed\"}\r\n\r\n";
        for tail in [b"data: \xff\n\n".to_vec(), vec![b'x'; MAX_EVENT_BYTES + 1]] {
            let wire = [terminal.as_slice(), tail.as_slice()].concat();
            for split in [0, terminal.len() - 1, terminal.len(), wire.len()] {
                let mut decoder = SseDecoder::default();
                let mut events = Vec::new();
                let mut send = |event| { events.push(event); Ok(()) };
                let complete = forward_chunk(&mut decoder, &wire[..split], &mut send).unwrap()
                    || forward_chunk(&mut decoder, &wire[split..], &mut send).unwrap();
                assert!(complete);
                assert_eq!(events, [json!({"type":"response.completed"})]);
            }
        }
    }

    #[test]
    fn valid_delta_before_invalid_frame_is_delivered_then_fails() {
        let mut decoder = SseDecoder::default();
        let mut events = Vec::new();
        let wire = b"data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\ndata: \xff\n\n";
        assert!(forward_chunk(&mut decoder, wire, &mut |event| { events.push(event); Ok(()) }).unwrap_err().contains("UTF-8"));
        assert_eq!(events, [json!({"type":"response.output_text.delta", "delta":"partial"})]);
    }

    fn loopback_server(handle: impl FnOnce(TcpStream) + Send + 'static) -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            stream.set_write_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut request = Vec::new();
            let mut byte = [0];
            while !request.ends_with(b"\r\n\r\n") {
                assert_eq!(stream.read(&mut byte).unwrap(), 1);
                request.push(byte[0]);
            }
            handle(stream);
        });
        (format!("http://{}/responses", address), server)
    }

    async fn fixture_stream(wire: &[u8]) -> (Result<(), String>, Vec<Value>) {
        let wire = wire.to_vec();
        let (url, server) = loopback_server(move |mut stream| {
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", wire.len()).unwrap();
            stream.write_all(&wire).unwrap();
        });
        let response = reqwest::Client::builder().no_proxy().build().unwrap().get(url).send().await.unwrap();
        let mut received = Vec::new();
        let result = forward_response_stream(response, |event| { received.push(event); Ok(()) }).await;
        server.join().unwrap();
        (result, received)
    }

    #[test]
    fn loopback_stream_delivers_unicode_multiline_and_terminal_eof() {
        runtime().block_on(async {
            let (result, events) = fixture_stream("data: {\"type\":\"response.output_text.delta\",\r\ndata: \"delta\":\"你好😀\"}\r\n\r\ndata: {\"type\":\"response.completed\"}".as_bytes()).await;
            result.unwrap();
            assert_eq!(events, [json!({"type":"response.output_text.delta", "delta":"你好😀"}), json!({"type":"response.completed"})]);
        });
    }

    #[test]
    fn loopback_stream_rejects_empty_truncated_done_and_malformed_eof() {
        runtime().block_on(async {
            for wire in [b"".as_slice(), b"data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\n", b"data: [DONE]\n\n", b"data: {\"type\":\"response.completed\""] {
                let (result, events) = fixture_stream(wire).await;
                assert!(result.is_err(), "unexpected success for {:?}", wire);
                assert!(events.iter().all(|event| event["type"] != "response.completed"));
            }
        });
    }

    fn assert_peer_closed(mut stream: TcpStream) {
        let mut byte = [0];
        match stream.read(&mut byte) {
            Ok(0) => (),
            Err(error) if matches!(error.kind(), std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::ConnectionAborted) => (),
            other => panic!("client request did not close after cancellation: {:?}", other),
        }
    }

    #[test]
    fn loopback_cancel_drops_stalled_http_send_and_closes_socket() {
        runtime().block_on(async {
            let (seen_tx, seen_rx) = oneshot::channel();
            let (closed_tx, closed_rx) = oneshot::channel();
            let (url, server) = loopback_server(move |stream| {
                let _ = seen_tx.send(());
                // Never send response headers: cancellation must wake a stalled send().
                assert_peer_closed(stream);
                let _ = closed_tx.send(());
            });
            let registry = Arc::new(RunRegistry::default());
            let worker_registry = registry.clone();
            let task = tokio::spawn(async move {
                let run = worker_registry.register("send").unwrap();
                let client = reqwest::Client::builder().no_proxy().build().unwrap();
                run.until_cancelled(client.get(url).send()).await
            });
            tokio::time::timeout(Duration::from_secs(3), seen_rx).await.unwrap().unwrap();
            registry.cancel("send");
            assert!(tokio::time::timeout(Duration::from_secs(1), task).await.unwrap().unwrap().is_none());
            tokio::time::timeout(Duration::from_secs(2), closed_rx).await.unwrap().unwrap();
            assert!(registry.is_idle());
            server.join().unwrap();
        });
    }

    #[test]
    fn loopback_cancel_drops_stalled_body_and_closes_socket() {
        runtime().block_on(async {
            let (event_tx, event_rx) = oneshot::channel();
            let (closed_tx, closed_rx) = oneshot::channel();
            let (url, server) = loopback_server(move |mut stream| {
                stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: 999999\r\n\r\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"first\"}\n\n").unwrap();
                stream.flush().unwrap();
                // Leave the body open without any next chunk.
                assert_peer_closed(stream);
                let _ = closed_tx.send(());
            });
            let registry = Arc::new(RunRegistry::default());
            let worker_registry = registry.clone();
            let task = tokio::spawn(async move {
                let run = worker_registry.register("body").unwrap();
                run.until_cancelled(async move {
                    let client = reqwest::Client::builder().no_proxy().build().unwrap();
                    let response = client.get(url).send().await.unwrap();
                    let mut event_tx = Some(event_tx);
                    forward_response_stream(response, |_| {
                        if let Some(tx) = event_tx.take() { let _ = tx.send(()); }
                        Ok(())
                    }).await
                }).await
            });
            tokio::time::timeout(Duration::from_secs(3), event_rx).await.unwrap().unwrap();
            registry.cancel("body");
            assert!(tokio::time::timeout(Duration::from_secs(1), task).await.unwrap().unwrap().is_none());
            tokio::time::timeout(Duration::from_secs(2), closed_rx).await.unwrap().unwrap();
            assert!(registry.is_idle());
            server.join().unwrap();
        });
    }
}
