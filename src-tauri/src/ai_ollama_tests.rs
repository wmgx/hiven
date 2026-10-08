//! Synthetic loopback fixtures test protocol and client cancellation, not model quality or server compute reclamation.
use super::*;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;
use tokio::sync::oneshot;

type Handler = Box<dyn FnOnce(TcpStream) + Send>;
fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
}
fn tag() -> Value {
    json!({ "name": "fixture:local", "model": "fixture:local", "size": 123, "digest": "a".repeat(64), "details": { "format": "gguf" } })
}
fn show() -> Value {
    json!({ "details": { "format": "gguf" }, "model_info": { "general.architecture": "fixture" }, "capabilities": ["completion", "thinking", "tools"] })
}
fn tags() -> Value {
    json!({ "models": [tag()] })
}
fn success_wire() -> String {
    "{\"model\":\"fixture:local\",\"done\":false,\"message\":{\"role\":\"assistant\",\"content\":\"你好😀\"}}\n{\"model\":\"fixture:local\",\"done\":true,\"done_reason\":\"stop\",\"message\":{\"role\":\"assistant\",\"content\":\"\"},\"prompt_eval_count\":3,\"eval_count\":2}".to_owned()
}
fn input() -> Value {
    json!([{ "type": "text", "text": "synthetic fixture input" }])
}

fn server(handlers: Vec<Handler>) -> (OllamaClient, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    listener.set_nonblocking(true).unwrap();
    let worker = thread::spawn(move || {
        for handler in handlers {
            let deadline = Instant::now() + Duration::from_secs(5);
            let stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(error)
                        if error.kind() == std::io::ErrorKind::WouldBlock
                            && Instant::now() < deadline =>
                    {
                        thread::sleep(Duration::from_millis(2))
                    }
                    Err(error) => panic!("fixture request not received: {}", error),
                }
            };
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            stream
                .set_write_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            handler(stream);
        }
    });
    (
        OllamaClient {
            client: OllamaClient::http_client().unwrap(),
            base: format!("http://{}", address),
        },
        worker,
    )
}
fn request(stream: &mut TcpStream) -> (String, Value) {
    let mut headers = Vec::new();
    let mut byte = [0];
    while !headers.ends_with(b"\r\n\r\n") {
        assert_eq!(stream.read(&mut byte).unwrap(), 1);
        headers.push(byte[0]);
        assert!(headers.len() < 32 * 1024);
    }
    let headers = String::from_utf8(headers).unwrap();
    assert!(!headers.to_ascii_lowercase().contains("authorization:"));
    let path = headers.split_whitespace().nth(1).unwrap().to_owned();
    let size: usize = headers
        .lines()
        .find_map(|line| {
            line.to_ascii_lowercase()
                .strip_prefix("content-length:")
                .map(|size| size.trim().parse().unwrap())
        })
        .unwrap_or(0);
    let mut body = vec![0; size];
    stream.read_exact(&mut body).unwrap();
    (
        path,
        if body.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&body).unwrap()
        },
    )
}
fn reply(path: &'static str, value: Value) -> Handler {
    reply_raw(path, 200, value.to_string())
}
fn reply_raw(path: &'static str, status: u16, body: String) -> Handler {
    Box::new(move |mut stream| {
        assert_eq!(request(&mut stream).0, path);
        let location = if (300..400).contains(&status) {
            format!(
                "Location: http://{}/forbidden\r\n",
                stream.local_addr().unwrap()
            )
        } else {
            String::new()
        };
        let result = write!(stream, "HTTP/1.1 {} Fixture\r\n{}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", status, location, body.len(), body);
        if body.len() <= MAX_METADATA_BYTES {
            result.unwrap();
        }
    })
}
fn peer_closed(stream: &mut TcpStream) {
    let mut byte = [0];
    match stream.read(&mut byte) {
        Ok(0) => (),
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::ConnectionAborted
            ) =>
        {
            ()
        }
        result => panic!("cancelled socket remained open: {:?}", result),
    }
}

#[test]
fn eligibility_requires_positive_local_completion_metadata() {
    assert!(confirmed_model(&tag(), &show()).is_some());
    for field in [
        "remote_host",
        "remote_model",
        "is_remote",
        "cloud",
        "cloud_host",
    ] {
        let mut remote = show();
        remote[field] = json!("upstream");
        assert!(confirmed_model(&tag(), &remote).is_none(), "{}", field);
        let mut remote_tag = tag();
        remote_tag[field] = json!("upstream");
        assert!(confirmed_model(&remote_tag, &show()).is_none());
    }
    for name in [
        "fixture:cloud",
        "fixture-cloud:latest",
        "fixture:remote",
        "https://example/model",
        "../model",
        "fixture\n",
    ] {
        let mut entry = tag();
        entry["name"] = json!(name);
        entry["model"] = json!(name);
        assert!(confirmed_model(&entry, &show()).is_none());
    }
    for field in ["details", "model_info", "capabilities"] {
        let mut unknown = show();
        unknown.as_object_mut().unwrap().remove(field);
        assert!(confirmed_model(&tag(), &unknown).is_none());
    }
    for capabilities in [
        json!(["embedding"]),
        json!(["completion", "cloud"]),
        json!(["completion", false]),
    ] {
        let mut unknown = show();
        unknown["capabilities"] = capabilities;
        assert!(confirmed_model(&tag(), &unknown).is_none());
    }
    let mut variants = show();
    variants["manifests"] = json!([{"model":"unconfirmed"}]);
    assert!(confirmed_model(&tag(), &variants).is_none());
    for field in ["size", "digest", "details"] {
        let mut unknown = tag();
        unknown.as_object_mut().unwrap().remove(field);
        assert!(confirmed_model(&unknown, &show()).is_none());
    }
    let mut zero = tag();
    zero["size"] = json!(0);
    assert!(tag_model(&zero).is_none());
}

#[test]
fn text_limits_are_utf8_bytes_and_never_silently_truncate() {
    assert_eq!(
        text_input(json!([{ "type":"text", "text":"你" }, { "type":"text", "text":"好😀" }]))
            .unwrap(),
        "你\n好😀"
    );
    assert_eq!(
        text_input(json!([{ "type":"localFile", "path":"fixture" }])),
        Err("OLLAMA_INPUT_UNSUPPORTED")
    );
    assert_eq!(text_input(json!([])), Err("OLLAMA_INPUT_UNSUPPORTED"));
    assert_eq!(
        text_input(json!([{ "type":"text", "text":" " }])),
        Err("OLLAMA_INPUT_UNSUPPORTED")
    );
    assert_eq!(
        text_input(json!([{ "type":"text", "text":"你".repeat(MAX_INPUT_BYTES / 3 + 1) }])),
        Err("OLLAMA_INPUT_TOO_LARGE")
    );
    let value = "x".repeat(MAX_INPUT_BYTES);
    assert_eq!(
        text_input(json!([{ "type":"text", "text":value }]))
            .unwrap()
            .len(),
        MAX_INPUT_BYTES
    );
}

#[test]
fn describe_only_reads_tags_and_show_and_reports_empty_unknown_and_unreachable() {
    runtime().block_on(async {
        let (client, worker) = server(vec![reply("/api/tags", tags()), reply("/api/show", show())]);
        let result = describe(&client).await;
        worker.join().unwrap();
        assert!(result.status_reason.is_none());
        assert!(result.complete);
        assert_eq!(result.models.len(), 1);
        for (body, expected) in [
            (json!({"models":[]}), "models_empty"),
            (json!({"models":[{"name":"unknown"}]}), "models_unsupported"),
            (json!({}), "metadata_invalid"),
        ] {
            let (client, worker) = server(vec![reply("/api/tags", body)]);
            let result = describe(&client).await;
            worker.join().unwrap();
            assert_eq!(result.status_reason, Some(expected));
            assert!(result.models.is_empty());
        }
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let client = OllamaClient {
            client: OllamaClient::http_client().unwrap(),
            base: format!("http://{}", address),
        };
        assert_eq!(
            describe(&client).await.status_reason,
            Some("service_unreachable")
        );
    });
}

#[test]
fn run_revalidates_selected_model_and_sends_only_text_chat() {
    runtime().block_on(async {
        let captured = Arc::new(Mutex::new(Value::Null)); let copy = captured.clone();
        let (client, worker) = server(vec![reply("/api/tags", tags()), reply("/api/show", show()), reply("/api/tags", tags()), Box::new(move |mut stream| {
            let (path, body) = request(&mut stream); assert_eq!(path, "/api/chat"); *copy.lock().unwrap() = body;
            let wire = success_wire();
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", wire.len(), wire).unwrap();
        })]);
        let mut events = Vec::new(); client.chat("fixture:local", input(), &mut |event| { events.push(event); Ok(()) }).await.unwrap(); worker.join().unwrap();
        assert_eq!(*captured.lock().unwrap(), json!({"model":"fixture:local", "stream":true, "messages":[{"role":"user", "content":"synthetic fixture input"}]}));
        assert_eq!(events[0]["delta"], "你好😀"); assert_eq!(events.last().unwrap()["status"], "completed");
    });
}

#[test]
fn removed_remote_changed_and_duplicate_models_never_reach_chat() {
    runtime().block_on(async {
        let mut remote = show();
        remote["remote_host"] = json!("https://example.invalid");
        let mut changed = tag();
        changed["digest"] = json!("b".repeat(64));
        for handlers in [
            vec![reply("/api/tags", json!({"models":[]}))],
            vec![reply("/api/tags", tags()), reply("/api/show", remote)],
            vec![
                reply("/api/tags", tags()),
                reply("/api/show", show()),
                reply("/api/tags", json!({"models":[changed]})),
            ],
            vec![reply("/api/tags", json!({"models":[tag(),tag()]}))],
        ] {
            let (client, worker) = server(handlers);
            assert_eq!(
                client
                    .chat("fixture:local", input(), &mut |_| panic!(
                        "no event expected"
                    ))
                    .await,
                Err("OLLAMA_MODEL_UNAVAILABLE")
            );
            worker.join().unwrap();
        }
    });
}

#[test]
fn redirect_error_oversize_and_malformed_metadata_fail_closed() {
    runtime().block_on(async {
        for (status, body) in [
            (302, "".into()),
            (500, "internal secret".into()),
            (200, "{broken".into()),
            (200, "x".repeat(MAX_METADATA_BYTES + 1)),
        ] {
            let (client, worker) = server(vec![reply_raw("/api/tags", status, body)]);
            assert_eq!(
                describe(&client).await.status_reason,
                Some("metadata_invalid")
            );
            worker.join().unwrap();
        }
    });
}

#[test]
fn http_stream_error_and_missing_terminal_do_not_complete() {
    runtime().block_on(async {
        for (status, wire, expected) in [
            (500, "server detail".into(), "OLLAMA_HTTP_ERROR"),
            (200, "".into(), "OLLAMA_STREAM_INCOMPLETE"),
            (200, "{broken".into(), "OLLAMA_STREAM_INVALID"),
        ] {
            let (client, worker) = server(vec![
                reply("/api/tags", tags()),
                reply("/api/show", show()),
                reply("/api/tags", tags()),
                reply_raw("/api/chat", status, wire),
            ]);
            assert_eq!(
                client
                    .chat("fixture:local", input(), &mut |_| panic!(
                        "no event expected"
                    ))
                    .await,
                Err(expected)
            );
            worker.join().unwrap();
        }
    });
}

#[test]
fn cancellation_before_start_and_during_metadata_or_chat_closes_real_request() {
    runtime().block_on(async {
        let registry = RunRegistry::default(); registry.cancel("early");
        let run = registry.register("early").unwrap();
        assert!(run.until_cancelled(async { panic!("pre-cancel must not start metadata") }).await.is_none()); drop(run);
        for stage in ["metadata", "headers", "body"] {
            let (seen_tx, seen_rx) = oneshot::channel(); let (closed_tx, closed_rx) = oneshot::channel();
            let mut handlers = Vec::new();
            if stage != "metadata" { handlers.extend([reply("/api/tags", tags()), reply("/api/show", show()), reply("/api/tags", tags())]); }
            handlers.push(Box::new(move |mut stream| {
                let (path, _) = request(&mut stream); assert_eq!(path, if stage == "metadata" { "/api/tags" } else { "/api/chat" });
                if stage == "body" { stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 999999\r\n\r\n{\"model\":\"fixture:local\",\"done\":false,\"message\":{\"role\":\"assistant\",\"content\":\"first\"}}\n").unwrap(); stream.flush().unwrap(); }
                seen_tx.send(()).unwrap(); peer_closed(&mut stream); closed_tx.send(()).unwrap();
            }) as Handler);
            let (client, worker) = server(handlers);
            let registry = Arc::new(RunRegistry::default()); let copy = registry.clone();
            let task = tokio::spawn(async move {
                let run = copy.register("cancel").unwrap();
                run.until_cancelled(client.chat("fixture:local", input(), &mut |_| Ok(()))).await
            });
            tokio::time::timeout(Duration::from_secs(3), seen_rx).await.unwrap().unwrap(); registry.cancel("cancel"); registry.cancel("cancel");
            assert!(tokio::time::timeout(Duration::from_secs(1), task).await.unwrap().unwrap().is_none());
            tokio::time::timeout(Duration::from_secs(2), closed_rx).await.unwrap().unwrap(); worker.join().unwrap(); assert!(registry.is_idle());
            assert_eq!(registry.register("new-run").unwrap().until_cancelled(async { 7 }).await, Some(7));
        }
    });
}

#[test]
fn metadata_timeout_and_stream_timeout_close_stalled_response() {
    runtime().block_on(async {
        let (closed_tx, closed_rx) = oneshot::channel();
        let (client, worker) = server(vec![Box::new(move |mut stream| {
            assert_eq!(request(&mut stream).0, "/api/tags");
            peer_closed(&mut stream);
            closed_tx.send(()).unwrap();
        })]);
        assert_eq!(
            describe(&client).await.status_reason,
            Some("metadata_timeout")
        );
        tokio::time::timeout(Duration::from_secs(2), closed_rx)
            .await
            .unwrap()
            .unwrap();
        worker.join().unwrap();
        let (closed_tx, closed_rx) = oneshot::channel();
        let (mut client, worker) = server(vec![
            reply("/api/tags", tags()),
            reply("/api/show", show()),
            reply("/api/tags", tags()),
            Box::new(move |mut stream| {
                assert_eq!(request(&mut stream).0, "/api/chat");
                stream
                    .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 99\r\n\r\n")
                    .unwrap();
                stream.flush().unwrap();
                peer_closed(&mut stream);
                closed_tx.send(()).unwrap();
            }),
        ]);
        // Shorten the client deadline for the fixture only; production stays at 180s.
        client.client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_millis(50))
            .build()
            .unwrap();
        assert_eq!(
            client
                .chat("fixture:local", input(), &mut |_| panic!(
                    "no event expected"
                ))
                .await,
            Err("OLLAMA_TIMEOUT")
        );
        tokio::time::timeout(Duration::from_secs(2), closed_rx)
            .await
            .unwrap()
            .unwrap();
        worker.join().unwrap();
    });
}

#[test]
fn catalog_failure_preserves_only_confirmed_models_as_partial() {
    runtime().block_on(async {
        let mut second = tag();
        second["name"] = json!("second:local");
        second["model"] = json!("second:local");
        let (client, worker) = server(vec![
            reply("/api/tags", json!({"models":[tag(), second]})),
            reply("/api/show", show()),
            reply_raw("/api/show", 500, String::new()),
        ]);
        let result = describe(&client).await;
        worker.join().unwrap();
        assert!(result.status_reason.is_none());
        assert!(!result.complete);
        assert_eq!(result.models, vec![tag_model(&tag()).unwrap()]);
    });
}
