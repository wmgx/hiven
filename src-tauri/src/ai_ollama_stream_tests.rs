use super::*;

fn chunk(content: &str) -> Value {
    json!({ "model": "fixture:local", "done": false, "message": { "role": "assistant", "content": content } })
}
fn terminal() -> Value {
    json!({ "model": "fixture:local", "done": true, "done_reason": "stop", "message": { "role": "assistant", "content": "" }, "prompt_eval_count": 7, "eval_count": 4 })
}
fn decode(wire: &[u8]) -> (Result<bool>, Vec<Value>) {
    let mut decoder = Decoder::default();
    let mut events = Vec::new();
    let mut send = |event| {
        events.push(event);
        Ok(())
    };
    let result = decoder
        .push(wire, "fixture:local", &mut send)
        .and_then(|done| {
            if done {
                Ok(true)
            } else if !decoder.line.is_empty() {
                decoder.frame("fixture:local", &mut send)
            } else {
                Ok(false)
            }
        });
    (result, events)
}

#[test]
fn utf8_survives_every_byte_boundary_and_terminal_without_newline() {
    let wire = format!("{}\r\n{}", chunk("你好😀"), terminal()).into_bytes();
    for split in 0..=wire.len() {
        let mut decoder = Decoder::default();
        let mut events = Vec::new();
        let mut send = |event| {
            events.push(event);
            Ok(())
        };
        assert!(!decoder
            .push(&wire[..split], "fixture:local", &mut send)
            .unwrap());
        assert!(!decoder
            .push(&wire[split..], "fixture:local", &mut send)
            .unwrap());
        assert!(decoder.frame("fixture:local", &mut send).unwrap());
        assert_eq!(events[0], json!({"type":"text.delta", "delta":"你好😀"}));
        assert_eq!(events[1]["metrics"][0]["amount"], 7);
        assert_eq!(events.last().unwrap()["status"], "completed");
    }
}

#[test]
fn first_terminal_ignores_late_invalid_and_oversized_tail() {
    for tail in [b"\xff\n".to_vec(), vec![b'x'; MAX_LINE_BYTES + 1]] {
        let mut wire = format!("{}\n{}\n", chunk("ok"), terminal()).into_bytes();
        wire.extend(tail);
        let (result, events) = decode(&wire);
        assert_eq!(result, Ok(true));
        assert_eq!(events.len(), 3);
    }
}

#[test]
fn rejects_incomplete_invalid_remote_tool_and_truncated_frames() {
    for bad in [b"{broken\n".to_vec(), b"\xff\n".to_vec(), b"{}\n".to_vec()] {
        assert_eq!(decode(&bad).0, Err("OLLAMA_STREAM_INVALID"));
    }
    let (result, events) = decode(chunk("partial").to_string().as_bytes());
    assert_eq!(result, Ok(false));
    assert_eq!(events.len(), 1);
    let mut bad = terminal();
    bad["done_reason"] = json!("length");
    assert_eq!(
        decode(bad.to_string().as_bytes()).0,
        Err("OLLAMA_OUTPUT_TRUNCATED")
    );
    assert_eq!(
        decode(terminal().to_string().as_bytes()).0,
        Err("OLLAMA_STREAM_INCOMPLETE")
    );
    for reason in [Value::Null, json!("load"), json!("unknown")] {
        bad = terminal();
        bad["done_reason"] = reason;
        assert_eq!(
            decode(bad.to_string().as_bytes()).0,
            Err("OLLAMA_STREAM_INCOMPLETE")
        );
    }
    bad = chunk("ignored");
    bad["model"] = json!("different:local");
    assert_eq!(
        decode(bad.to_string().as_bytes()).0,
        Err("OLLAMA_MODEL_UNAVAILABLE")
    );
    bad = chunk("ignored");
    bad["remote_host"] = json!("https://ollama.com");
    assert_eq!(
        decode(bad.to_string().as_bytes()).0,
        Err("OLLAMA_MODEL_UNAVAILABLE")
    );
    bad = chunk("ignored");
    bad["message"]["tool_calls"] =
        json!([{ "function": { "name": "run", "arguments": { "command": "do not execute" } } }]);
    let (result, events) = decode(bad.to_string().as_bytes());
    assert_eq!(result, Err("OLLAMA_TOOL_CALL_UNSUPPORTED"));
    assert!(events.is_empty());
    assert_eq!(
        decode(br#"{"error":"sensitive server text"}"#).0,
        Err("OLLAMA_HTTP_ERROR")
    );
}

#[test]
fn separates_reasoning_and_validates_usage_without_inventing_counts() {
    let mut first = chunk("hello");
    first["message"]["thinking"] = json!("reason");
    let wire = format!("{}\n{}\n", first, terminal());
    let (result, events) = decode(wire.as_bytes());
    assert_eq!(result, Ok(true));
    assert_eq!(events[0]["type"], "reasoning.delta");
    assert_eq!(events[1]["type"], "text.delta");
    let mut bad = terminal();
    bad["eval_count"] = json!(-1);
    assert_eq!(
        decode(format!("{}\n{}", chunk("ok"), bad).as_bytes()).0,
        Err("OLLAMA_STREAM_INVALID")
    );
    let mut last = terminal();
    last.as_object_mut().unwrap().remove("eval_count");
    last.as_object_mut().unwrap().remove("prompt_eval_count");
    let (result, events) = decode(format!("{}\n{}", chunk("ok"), last).as_bytes());
    assert_eq!(result, Ok(true));
    assert_eq!(events.len(), 2);
}

#[test]
fn transport_limits_and_channel_close_fail_without_success() {
    assert_eq!(
        decode(&vec![b'x'; MAX_LINE_BYTES + 1]).0,
        Err("OLLAMA_STREAM_TOO_LARGE")
    );
    let mut decoder = Decoder {
        received: MAX_STREAM_BYTES,
        ..Default::default()
    };
    assert_eq!(
        decoder.push(b"\n", "fixture:local", &mut |_| Ok(())),
        Err("OLLAMA_STREAM_TOO_LARGE")
    );
    let mut decoder = Decoder::default();
    let wire = format!("{}\n{}\n", chunk("partial"), terminal());
    assert_eq!(
        decoder.push(wire.as_bytes(), "fixture:local", &mut |_| Err(
            "OLLAMA_CHANNEL_CLOSED"
        )),
        Err("OLLAMA_CHANNEL_CLOSED")
    );
}
