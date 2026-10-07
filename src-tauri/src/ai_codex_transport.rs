//! Per-process JSON-RPC transport state; no authentication or Tauri dependency.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;
use tokio::sync::oneshot;

pub(super) const CONNECTION_CHANGED: &str = "HIVEN_CODEX_CONNECTION_CHANGED";
type RpcResult = Result<Value, String>;

#[derive(Default)]
struct State {
    pending: HashMap<u64, oneshot::Sender<RpcResult>>,
    closed: bool,
}

pub(super) struct Connection {
    id: String,
    state: Mutex<State>,
    on_event: Box<dyn Fn(Value) + Send + Sync>,
}

impl Connection {
    pub(super) fn new(id: String, on_event: impl Fn(Value) + Send + Sync + 'static) -> Arc<Self> {
        Arc::new(Self { id, state: Mutex::new(State::default()), on_event: Box::new(on_event) })
    }

    fn state(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub(super) fn is_closed(&self) -> bool {
        self.state().closed
    }

    pub(super) fn matches(&self, expected: &str) -> bool {
        self.id == expected && !self.is_closed()
    }

    pub(super) fn tag(&self, value: Value) -> Value {
        let mut object = match value {
            Value::Object(object) => object,
            Value::Null => Default::default(),
            other => {
                let mut object = serde_json::Map::new();
                object.insert("result".into(), other);
                object
            }
        };
        object.insert("_hivenConnectionId".into(), Value::String(self.id.clone()));
        Value::Object(object)
    }

    fn register(self: &Arc<Self>, id: u64) -> Result<PendingReply, String> {
        let mut state = self.state();
        if state.closed {
            return Err(CONNECTION_CHANGED.to_string());
        }
        if state.pending.contains_key(&id) {
            return Err("Codex RPC ID is already pending".to_string());
        }
        let (sender, receiver) = oneshot::channel();
        state.pending.insert(id, sender);
        Ok(PendingReply { receiver, _registration: Some(Registration { connection: self.clone(), id }) })
    }

    pub(super) fn write(
        self: &Arc<Self>,
        writer: &mut impl Write,
        message: &Value,
    ) -> Result<Option<PendingReply>, String> {
        let reply = message.get("id").and_then(Value::as_u64)
            .map(|id| self.register(id)).transpose()?;
        if self.is_closed() {
            return Err(CONNECTION_CHANGED.to_string());
        }
        let mut encoded = serde_json::to_vec(message).map_err(|error| error.to_string())?;
        encoded.push(b'\n');
        if let Err(error) = writer.write_all(&encoded).and_then(|_| writer.flush()) {
            let reason = format!("Codex App Server write failed: {}", error);
            self.close(&reason);
            return Err(reason);
        }
        Ok(reply)
    }

    pub(super) fn close(&self, reason: &str) {
        let pending = {
            let mut state = self.state();
            if state.closed {
                return;
            }
            state.closed = true;
            std::mem::take(&mut state.pending)
        };
        for (_, sender) in pending {
            let _ = sender.send(Err(reason.to_string()));
        }
        // Streams still need this event after turn/start's RPC has already settled.
        (self.on_event)(self.tag(json!({
            "method": "hiven/transport/closed",
            "params": { "message": reason },
        })));
    }

    fn receive(&self, message: Value) {
        if let Some(id) = message.get("id").and_then(Value::as_u64) {
            let sender = self.state().pending.remove(&id);
            if let Some(sender) = sender {
                let result = if let Some(error) = message.get("error") {
                    Err(error.get("message").and_then(Value::as_str)
                        .unwrap_or("Codex RPC failed").to_string())
                } else {
                    Ok(self.tag(message.get("result").cloned().unwrap_or(Value::Null)))
                };
                let _ = sender.send(result);
            }
        } else if !self.is_closed() {
            (self.on_event)(self.tag(message));
        }
    }

    pub(super) fn read(&self, reader: impl BufRead) {
        for line in reader.lines() {
            match line {
                Ok(line) => {
                    if let Ok(message) = serde_json::from_str::<Value>(&line) {
                        self.receive(message);
                    }
                }
                Err(error) => {
                    self.close(&format!("Codex App Server read failed: {}", error));
                    return;
                }
            }
        }
        self.close("Codex App Server stopped");
    }
}

struct Registration {
    connection: Arc<Connection>,
    id: u64,
}

impl Drop for Registration {
    fn drop(&mut self) {
        self.connection.state().pending.remove(&self.id);
    }
}

pub(super) struct PendingReply {
    receiver: oneshot::Receiver<RpcResult>,
    _registration: Option<Registration>,
}

impl PendingReply {
    pub(super) fn ready(value: Value) -> Self {
        let (sender, receiver) = oneshot::channel();
        let _ = sender.send(Ok(value));
        Self { receiver, _registration: None }
    }

    pub(super) async fn wait(self, timeout: Duration) -> RpcResult {
        let Self { receiver, _registration } = self;
        // Keep registration alive until completion, timeout, or this future is dropped.
        let result = tokio::time::timeout(timeout, receiver).await
            .map_err(|_| "Codex RPC timed out".to_string())?
            .map_err(|_| "Codex RPC response channel closed".to_string())?;
        drop(_registration);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{self, BufReader, Cursor, Read};

    fn fixture(id: &str) -> (Arc<Connection>, Arc<Mutex<Vec<Value>>>) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        (Connection::new(id.to_owned(), move |event| sink.lock().unwrap().push(event)), events)
    }

    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap()
    }

    #[test]
    fn eof_after_turn_start_response_still_notifies_active_stream() {
        runtime().block_on(async {
            let (connection, events) = fixture("connection-a");
            let reply = connection.write(&mut Vec::new(), &json!({"id": 1, "method": "turn/start"})).unwrap().unwrap();
            connection.read(Cursor::new(b"{\"id\":1,\"result\":{\"turn\":{\"id\":\"turn-a\"}}}\n"));
            let result = reply.wait(Duration::from_secs(1)).await.unwrap();
            assert_eq!(result["turn"]["id"], "turn-a");
            assert_eq!(result["_hivenConnectionId"], "connection-a");
            assert!(connection.state().pending.is_empty());
            assert_eq!(*events.lock().unwrap(), [json!({"method":"hiven/transport/closed", "_hivenConnectionId":"connection-a", "params":{"message":"Codex App Server stopped"}})]);
            connection.close("duplicate close");
            assert_eq!(events.lock().unwrap().len(), 1);
        });
    }

    #[cfg(unix)]
    #[test]
    fn local_mock_app_server_exits_after_rpc_without_hanging_stream() {
        use std::process::{Command, Stdio};
        runtime().block_on(async {
            let (connection, events) = fixture("mock-process");
            // No Codex binary, login, config, or model invocation is involved.
            let mut child = Command::new("/bin/sh")
                .args(["-c", "read request; printf '%s\\n' '{\"id\":7,\"result\":{\"turn\":{\"id\":\"fixture-turn\"}}}'"])
                .stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
            let reply = connection.write(&mut child.stdin.take().unwrap(), &json!({"id":7, "method":"turn/start"})).unwrap().unwrap();
            let stdout = child.stdout.take().unwrap();
            let reader_connection = connection.clone();
            let reader = std::thread::spawn(move || reader_connection.read(BufReader::new(stdout)));
            assert_eq!(reply.wait(Duration::from_secs(2)).await.unwrap()["turn"]["id"], "fixture-turn");
            reader.join().unwrap();
            assert!(child.wait().unwrap().success());
            assert_eq!(events.lock().unwrap().len(), 1);
            assert_eq!(events.lock().unwrap()[0]["method"], "hiven/transport/closed");
        });
    }

    #[test]
    fn old_connection_events_and_close_keep_their_generation() {
        let (old, old_events) = fixture("old");
        let (new, new_events) = fixture("new");
        old.receive(json!({"method":"item/agentMessage/delta", "params":{"delta":"old"}}));
        old.close("old EOF");
        old.receive(json!({"method":"item/agentMessage/delta", "params":{"delta":"late"}}));
        assert_eq!(old_events.lock().unwrap().len(), 2);
        assert!(old_events.lock().unwrap().iter().all(|event| event["_hivenConnectionId"] == "old"));
        assert!(!new.is_closed());
        assert!(new_events.lock().unwrap().is_empty());
        assert!(!new.matches("old"));
        assert!(new.matches("new"));
        assert!(!old.matches("old"));
    }

    struct BrokenTransport;
    impl Write for BrokenTransport {
        fn write(&mut self, _: &[u8]) -> io::Result<usize> { Err(io::Error::new(io::ErrorKind::BrokenPipe, "fixture pipe closed")) }
        fn flush(&mut self) -> io::Result<()> { Ok(()) }
    }
    impl Read for BrokenTransport {
        fn read(&mut self, _: &mut [u8]) -> io::Result<usize> { Err(io::Error::new(io::ErrorKind::BrokenPipe, "fixture read failed")) }
    }

    #[test]
    fn read_and_write_failures_close_once_and_reject_all_pending() {
        runtime().block_on(async {
            for fail_write in [false, true] {
                let (connection, events) = fixture("broken");
                let reply = connection.write(&mut Vec::new(), &json!({"id":1})).unwrap().unwrap();
                if fail_write {
                    assert!(connection.write(&mut BrokenTransport, &json!({"id":2})).is_err());
                } else {
                    connection.read(BufReader::new(BrokenTransport));
                }
                assert!(reply.wait(Duration::from_secs(1)).await.is_err());
                connection.close("again");
                assert!(connection.state().pending.is_empty());
                assert_eq!(events.lock().unwrap().len(), 1);
                assert!(connection.write(&mut Vec::new(), &json!({"id":3})).is_err());
            }
        });
    }

    #[test]
    fn timed_out_and_dropped_rpc_waiters_release_pending_registration() {
        runtime().block_on(async {
            let (connection, _) = fixture("cleanup");
            let reply = connection.write(&mut Vec::new(), &json!({"id":1})).unwrap().unwrap();
            assert_eq!(reply.wait(Duration::ZERO).await, Err("Codex RPC timed out".into()));
            assert!(connection.state().pending.is_empty());
            let reply = connection.write(&mut Vec::new(), &json!({"id":2})).unwrap().unwrap();
            drop(reply.wait(Duration::from_secs(120)));
            assert!(connection.state().pending.is_empty());
            connection.receive(json!({"id":2,"result":{}}));
            assert!(connection.state().pending.is_empty());
        });
    }
}
