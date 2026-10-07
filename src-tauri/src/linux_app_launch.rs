use std::io;
use std::process::{Command, Stdio};
use std::time::Duration;
use tokio::sync::oneshot;

const HELPER_EXIT_TIMEOUT: Duration = Duration::from_secs(5);
const UNCONFIRMED: &str = "APP_LAUNCH_UNCONFIRMED";

pub(crate) async fn open(target: &str) -> Result<(), String> {
    // Discovery stores a desktop-entry id, not a path or URL. xdg-open cannot
    // substitute for gtk-launch here and can open an unrelated local file.
    let mut command = Command::new("gtk-launch");
    command.arg(target);
    launch_helper(command, HELPER_EXIT_TIMEOUT).await
}

async fn launch_helper(mut command: Command, exit_timeout: Duration) -> Result<(), String> {
    let (started_tx, started_rx) = oneshot::channel();
    let worker = tokio::task::spawn_blocking(move || {
        let mut child = command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| match error.kind() {
                io::ErrorKind::NotFound => "APP_LAUNCH_HELPER_MISSING".to_string(),
                _ => "APP_LAUNCH_START_FAILED".to_string(),
            })?;
        // Start the timeout only after a child exists. Timing out a queued
        // spawn_blocking task could otherwise launch an app after returning.
        // This bounds helper exit waiting, not OS process creation/pool delay.
        let _ = started_tx.send(());
        // Keep ownership and reap even if the async caller has timed out. Do
        // not kill this process or its descendants: the app may already be open.
        let status = child.wait().map_err(|_| UNCONFIRMED.to_string())?;
        if status.success() {
            // gtk-launch accepted the request; GUI visibility is not guaranteed.
            Ok(())
        } else if status.code().is_some() {
            Err("APP_LAUNCH_REJECTED".to_string())
        } else {
            Err("APP_LAUNCH_INTERRUPTED".to_string())
        }
    });

    if started_rx.await.is_err() {
        // Process creation failed (or the worker panicked before its handshake).
        return worker
            .await
            .map_err(|_| "APP_LAUNCH_START_FAILED".to_string())?;
    }
    tokio::time::timeout(exit_timeout, worker)
        .await
        .map_err(|_| UNCONFIRMED.to_string())?
        .map_err(|_| UNCONFIRMED.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../temp")
                .join(format!(
                    "linux-app-launch-{}-{}",
                    std::process::id(),
                    NEXT.fetch_add(1, Ordering::Relaxed)
                ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn script(&self, name: &str, body: &str) -> PathBuf {
            let path = self.0.join(name);
            fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
            fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
            path
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    }

    #[test]
    fn accepted_helper_receives_one_literal_desktop_id() {
        let fixture = Fixture::new();
        let output = fixture.0.join("arguments");
        let script = fixture.script(
            "accepted",
            "printf '%s\\n' \"$#\" \"$1\" > \"$2\"\nexit 0",
        );
        let mut command = Command::new(script);
        command.arg("org.example.Synthetic App.desktop").arg(&output);
        assert_eq!(
            runtime().block_on(launch_helper(command, Duration::from_secs(1))),
            Ok(())
        );
        assert_eq!(
            fs::read_to_string(output).unwrap(),
            "2\norg.example.Synthetic App.desktop\n"
        );
    }

    #[test]
    fn rejected_and_signalled_helpers_never_report_success() {
        let fixture = Fixture::new();
        let rt = runtime();
        for (name, body, expected) in [
            ("rejected", "exit 23", "APP_LAUNCH_REJECTED"),
            ("interrupted", "kill -TERM $$", "APP_LAUNCH_INTERRUPTED"),
        ] {
            let command = Command::new(fixture.script(name, body));
            assert_eq!(
                rt.block_on(launch_helper(command, Duration::from_secs(1))),
                Err(expected.into())
            );
        }
    }

    #[test]
    fn missing_or_unexecutable_helper_does_not_use_xdg_open() {
        let fixture = Fixture::new();
        let fallback_marker = fixture.0.join("fallback-ran");
        fixture.script("xdg-open", "printf ran > \"$MARKER\"");
        let denied = fixture.script("not-executable", "exit 0");
        fs::set_permissions(&denied, fs::Permissions::from_mode(0o600)).unwrap();
        let rt = runtime();
        for (program, expected) in [
            (
                fixture.0.join("missing-gtk-launch"),
                "APP_LAUNCH_HELPER_MISSING",
            ),
            (denied, "APP_LAUNCH_START_FAILED"),
        ] {
            let mut command = Command::new(program);
            command
                .env("PATH", &fixture.0)
                .env("MARKER", &fallback_marker)
                .arg("synthetic.desktop");
            assert_eq!(
                rt.block_on(launch_helper(command, Duration::from_secs(1))),
                Err(expected.into())
            );
            assert!(!fallback_marker.exists());
        }
    }

    #[test]
    fn timeout_keeps_runtime_responsive_and_reaps_without_killing_or_retrying() {
        let fixture = Fixture::new();
        let started = fixture.0.join("started");
        let finished = fixture.0.join("finished");
        let release = fixture.0.join("release");
        // The test controls exit rather than racing a short sleep. The loop is
        // bounded so an assertion failure cannot strand runtime shutdown.
        let script = fixture.script(
            "slow",
            "printf '%s\\n' \"$$\" >> \"$1\"\n\
             count=0\n\
             while [ ! -f \"$3\" ] && [ \"$count\" -lt 500 ]; do\n\
               sleep 0.01\n\
               count=$((count + 1))\n\
             done\n\
             printf finished > \"$2\"",
        );
        let mut command = Command::new(script);
        command.arg(&started).arg(&finished).arg(&release);
        runtime().block_on(async {
            let launch = tokio::spawn(launch_helper(command, Duration::from_millis(20)));
            assert_eq!(launch.await.unwrap(), Err(UNCONFIRMED.into()));
            // spawn() confirms a process exists, not that its script has run.
            tokio::time::timeout(Duration::from_secs(2), async {
                while fs::read_to_string(&started).unwrap_or_default().trim().is_empty() {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .unwrap();
            assert!(!finished.exists(), "timeout must not kill the helper");
            let pid: i32 = fs::read_to_string(&started).unwrap().trim().parse().unwrap();
            fs::write(&release, "release").unwrap();
            tokio::time::timeout(Duration::from_secs(2), async {
                // WNOWAIT observes without stealing the worker's child reap.
                loop {
                    if finished.exists() {
                        let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
                        let result = unsafe {
                            libc::waitid(
                                libc::P_PID,
                                pid as libc::id_t,
                                &mut info,
                                libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
                            )
                        };
                        if result == -1 {
                            assert_eq!(
                                io::Error::last_os_error().raw_os_error(),
                                Some(libc::ECHILD)
                            );
                            break;
                        }
                        assert_eq!(result, 0);
                    }
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .unwrap();
            assert_eq!(
                fs::read_to_string(&started).unwrap().lines().count(),
                1,
                "no automatic retry"
            );
        });
    }

    #[test]
    fn queued_spawn_cannot_timeout_then_launch_later() {
        let fixture = Fixture::new();
        let started = fixture.0.join("started");
        let mut command = Command::new(fixture.script("queued", "printf started > \"$1\""));
        command.arg(&started);
        let rt = tokio::runtime::Builder::new_current_thread()
            .max_blocking_threads(1)
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let (release_tx, release_rx) = std::sync::mpsc::channel();
            let (occupied_tx, occupied_rx) = oneshot::channel();
            let blocker = tokio::task::spawn_blocking(move || {
                occupied_tx.send(()).unwrap();
                release_rx.recv().unwrap();
            });
            occupied_rx.await.unwrap();
            let launch = tokio::spawn(launch_helper(command, Duration::from_millis(10)));
            tokio::time::sleep(Duration::from_millis(40)).await;
            let returned_before_spawn = launch.is_finished();
            let started_while_queued = started.exists();
            release_tx.send(()).unwrap();
            blocker.await.unwrap();
            assert_eq!(launch.await.unwrap(), Ok(()));
            assert!(
                !returned_before_spawn,
                "no timeout response before process creation"
            );
            assert!(!started_while_queued);
            assert!(started.exists());
        });
    }
}
