use std::sync::Mutex;

const MAX_LOGIN_LINK_BYTES: usize = 16 * 1024;
const MAX_TRACKED_LOGIN_LINKS: usize = 32;

/// Only an authorization-code request may use the ordinary Linux clipboard.
/// Keep this contract aligned with isSafeCodexLoginUrl in loginSession.ts.
fn is_safe_login_link(text: &str) -> bool {
    if text.is_empty()
        || text.len() > MAX_LOGIN_LINK_BYTES
        || text
            .bytes()
            .any(|byte| !(b'!'..=b'~').contains(&byte) || byte == b'\\' || byte == b'#')
    {
        return false;
    }
    let Some(authority_and_path) = text.strip_prefix("https://") else {
        return false;
    };
    let authority = authority_and_path.split('/').next().unwrap_or_default();
    if authority != "auth.openai.com" && authority != "auth.openai.com:443" {
        return false;
    }
    let Ok(url) = reqwest::Url::parse(text) else {
        return false;
    };
    if url.scheme() != "https"
        || url.host_str() != Some("auth.openai.com")
        || url.path() != "/oauth/authorize"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.port_or_known_default() != Some(443)
    {
        return false;
    }
    let mut names = std::collections::HashSet::new();
    let mut authorization_code = false;
    for (name, value) in url.query_pairs() {
        if !names.insert(name.to_string()) {
            return false;
        }
        match name.as_ref() {
            "response_type" if value == "code" => authorization_code = true,
            "client_id" | "redirect_uri" | "scope" | "state" | "code_challenge" | "originator"
            | "allowed_workspace_id" => {}
            "code_challenge_method" if value == "S256" => {}
            "id_token_add_organizations" | "codex_cli_simplified_flow"
                if value == "true" || value == "false" =>
            {}
            _ => return false,
        }
    }
    authorization_code
}

/// Process memory only: no persistence, clipboard clearing, or login-end reset.
/// Retain up to 32 links (512 KiB) until exit, including across native selection
/// capture temporarily replacing and then restoring the previous clipboard.
/// This protects Hiven's public reader, not OS or third-party clipboard history.
pub(super) struct ClipboardPrivacy {
    guard: Mutex<LoginLinkGuard>,
}

impl ClipboardPrivacy {
    pub(super) const fn new() -> Self {
        Self {
            guard: Mutex::new(LoginLinkGuard { links: Vec::new() }),
        }
    }

    pub(super) fn with<T>(
        &self,
        operation: impl FnOnce(&mut LoginLinkGuard) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut guard = self
            .guard
            .lock()
            .map_err(|_| "Clipboard unavailable".to_string())?;
        operation(&mut guard)
    }
}

pub(super) struct LoginLinkGuard {
    links: Vec<String>,
}

impl LoginLinkGuard {
    pub(super) fn write_login_link(
        &mut self,
        text: String,
        write: impl FnOnce(&str) -> Result<(), String>,
    ) -> Result<(), String> {
        if !is_safe_login_link(&text) {
            return Err("Invalid login link".into());
        }
        if !self.links.contains(&text) {
            // Do not evict: a failed write or selection capture/restore can
            // leave an older link on the clipboard. At the bound, fail closed.
            if self.links.len() == MAX_TRACKED_LOGIN_LINKS {
                return Err("Login link copy unavailable".into());
            }
            self.links.push(text.clone());
        }
        // Mark before the backend call, under the public reader's mutex. A
        // backend may have changed the clipboard even when it returns an error.
        write(&text).map_err(|_| "Login link copy failed".to_string())
    }

    pub(super) fn public_text(&self, text: String) -> String {
        if self.links.contains(&text) {
            String::new()
        } else {
            text
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{mpsc, Arc};

    fn link(state: &str) -> String {
        format!("https://auth.openai.com/oauth/authorize?response_type=code&state={state}&code_challenge=dummy&code_challenge_method=S256")
    }

    #[test]
    fn login_link_validator_matches_shared_frontend_cases() {
        #[derive(serde::Deserialize)]
        struct Case {
            name: String,
            url: String,
            valid: bool,
        }
        let cases: Vec<Case> = serde_json::from_str(include_str!(
            "../../scripts/fixtures/codex-login-url-validation.json"
        ))
        .unwrap();
        for case in cases {
            assert_eq!(is_safe_login_link(&case.url), case.valid, "{}", case.name);
        }
    }

    #[test]
    fn login_link_size_is_bounded() {
        let mut text = "https://auth.openai.com/oauth/authorize?response_type=code&state=".to_string();
        text.push_str(&"x".repeat(MAX_LOGIN_LINK_BYTES - text.len()));
        assert!(is_safe_login_link(&text));
        text.push('x');
        assert!(!is_safe_login_link(&text));
    }

    #[test]
    fn invalid_links_never_reach_the_clipboard_backend() {
        let privacy = ClipboardPrivacy::new();
        let result = privacy.with(|guard| {
            guard.write_login_link("dummy-secret".into(), |_| panic!("must not write"))
        });
        assert_eq!(result.unwrap_err(), "Invalid login link");
    }

    #[test]
    fn copied_links_remain_private_after_selection_restore_and_new_login() {
        let privacy = ClipboardPrivacy::new();
        let mut clipboard = String::new();
        let text = link("dummy");
        privacy
            .with(|guard| {
                guard.write_login_link(text.clone(), |text| {
                    clipboard = text.to_owned();
                    Ok(())
                })
            })
            .unwrap();
        assert_eq!(clipboard, text);
        for _ in 0..3 {
            assert_eq!(
                privacy.with(|guard| Ok(guard.public_text(clipboard.clone()))).unwrap(),
                ""
            );
        }
        privacy
            .with(|guard| {
                assert_eq!(guard.public_text(String::new()), "");
                assert_eq!(guard.public_text(text.clone()), "");
                assert_eq!(guard.public_text("ordinary".into()), "ordinary");
                // A native selection capture can restore the prior clipboard after
                // a public reader observes the temporary ordinary selection text.
                assert_eq!(guard.public_text(text.clone()), "");
                guard.write_login_link(link("next-login"), |_| Ok(()))?;
                assert_eq!(guard.public_text(text), "");
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn failures_preserve_both_previous_and_possibly_written_links() {
        for partially_written in [false, true] {
            let privacy = ClipboardPrivacy::new();
            let previous = link("previous");
            let attempted = link("attempted");
            let mut clipboard = previous.clone();
            privacy
                .with(|guard| guard.write_login_link(previous.clone(), |_| Ok(())))
                .unwrap();
            let result = privacy.with(|guard| {
                guard.write_login_link(attempted.clone(), |text| {
                    if partially_written {
                        clipboard = text.to_owned();
                    }
                    Err(format!("backend error may contain {text}"))
                })
            });
            assert_eq!(result.unwrap_err(), "Login link copy failed");
            privacy
                .with(|guard| {
                    assert_eq!(guard.links.len(), 2);
                    assert_eq!(guard.public_text(clipboard), "");
                    assert_eq!(guard.public_text(previous), "");
                    assert_eq!(guard.public_text(attempted), "");
                    Ok(())
                })
                .unwrap();
        }
    }

    #[test]
    fn marker_capacity_rejects_writes_without_forgetting_uncertain_links() {
        let privacy = ClipboardPrivacy::new();
        privacy
            .with(|guard| {
                for index in 0..MAX_TRACKED_LOGIN_LINKS {
                    assert!(guard
                        .write_login_link(link(&format!("dummy-{index}")), |_| Err("failed".into()))
                        .is_err());
                }
                assert_eq!(
                    guard.write_login_link(link("overflow"), |_| panic!("must not write")).unwrap_err(),
                    "Login link copy unavailable"
                );
                assert_eq!(guard.links.len(), MAX_TRACKED_LOGIN_LINKS);
                assert_eq!(guard.public_text(link("dummy-0")), "");
                // Retrying a marked value needs no extra capacity and must not
                // release earlier links that can be restored by native capture.
                guard.write_login_link(link("dummy-0"), |_| Ok(()))?;
                assert_eq!(guard.links.len(), MAX_TRACKED_LOGIN_LINKS);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn native_public_read_waits_until_mark_and_write_finish() {
        let privacy = Arc::new(ClipboardPrivacy::new());
        let clipboard = Arc::new(Mutex::new("ordinary".to_string()));
        let (inside_tx, inside_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let writer_privacy = Arc::clone(&privacy);
        let writer_clipboard = Arc::clone(&clipboard);
        let writer = std::thread::spawn(move || {
            writer_privacy.with(|guard| {
                guard.write_login_link(link("dummy"), |text| {
                    *writer_clipboard.lock().unwrap() = text.to_owned();
                    inside_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                    Ok(())
                })
            })
        });
        inside_rx.recv().unwrap();
        assert!(privacy.guard.try_lock().is_err());
        let (started_tx, started_rx) = mpsc::channel();
        let (read_tx, read_rx) = mpsc::channel();
        let reader = std::thread::spawn(move || {
            started_tx.send(()).unwrap();
            let result = privacy.with(|guard| Ok(guard.public_text(clipboard.lock().unwrap().clone())));
            read_tx.send(result).unwrap();
        });
        started_rx.recv().unwrap();
        assert!(matches!(read_rx.try_recv(), Err(mpsc::TryRecvError::Empty)));
        release_tx.send(()).unwrap();
        writer.join().unwrap().unwrap();
        assert_eq!(read_rx.recv().unwrap().unwrap(), "");
        reader.join().unwrap();
    }
}
