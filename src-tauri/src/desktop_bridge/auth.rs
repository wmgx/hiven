//! Request guard for the loopback bridge: per-machine token, Host and Origin checks.
//!
//! The token lives in `<config>/bridge-token` (0600) and is copied into the unpacked
//! extension folder as `bridge-token.json` when the user prepares the extension. That file
//! is not web-accessible, so ordinary web pages cannot read it.

use super::DESKTOP_BRIDGE_PORT;
use std::fs;
use std::io::Read;
use std::path::Path;
use std::sync::OnceLock;

pub(super) const TOKEN_FILE_NAME: &str = "bridge-token";
const TOKEN_BYTES: usize = 32;

fn random_hex() -> Result<String, String> {
    let mut bytes = [0u8; TOKEN_BYTES];
    fs::File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(&mut bytes))
        .map_err(|e| format!("cannot read system randomness: {}", e))?;
    Ok(bytes.iter().map(|b| format!("{:02x}", b)).collect())
}

fn is_valid_token(value: &str) -> bool {
    value.len() == TOKEN_BYTES * 2 && value.bytes().all(|b| b.is_ascii_hexdigit())
}

#[cfg(unix)]
fn write_private(path: &Path, content: &str) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let tmp = path.with_extension(format!("tmp-{}", std::process::id()));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&tmp)
        .map_err(|e| e.to_string())?;
    file.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
    drop(file);
    fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[cfg(not(unix))]
fn write_private(path: &Path, content: &str) -> Result<(), String> {
    fs::write(path, content).map_err(|e| e.to_string())
}

/// Reads the token in `dir`, generating it on first use.
pub(crate) fn load_or_create_token(dir: &Path) -> Result<String, String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let path = dir.join(TOKEN_FILE_NAME);
    if let Ok(existing) = fs::read_to_string(&path) {
        let existing = existing.trim();
        if is_valid_token(existing) {
            return Ok(existing.to_string());
        }
    }
    let token = random_hex()?;
    write_private(&path, &token)?;
    Ok(token)
}

/// Process-wide token. `None` means it could not be created: the bridge then rejects all sources.
pub(crate) fn bridge_token() -> Option<&'static str> {
    static TOKEN: OnceLock<Option<String>> = OnceLock::new();
    TOKEN
        .get_or_init(|| {
            let dir = crate::config_dir().ok()?;
            match load_or_create_token(&dir) {
                Ok(token) => Some(token),
                Err(error) => {
                    eprintln!("[hiven] desktop bridge token unavailable: {}", error);
                    None
                }
            }
        })
        .as_deref()
}

/// Extension-side copy of the token. The extension reads it through `chrome.runtime.getURL`;
/// it is deliberately not listed in `web_accessible_resources`.
pub(crate) const EXTENSION_TOKEN_FILE: &str = "bridge-token.json";

pub(crate) fn write_extension_token(extension_dir: &Path) -> Result<(), String> {
    let token = bridge_token().ok_or_else(|| "bridge token unavailable".to_string())?;
    write_private(
        &extension_dir.join(EXTENSION_TOKEN_FILE),
        &serde_json::json!({ "token": token }).to_string(),
    )
}

pub(super) fn constant_time_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Host must name the loopback listener, which defeats DNS rebinding.
pub(super) fn host_allowed(host: Option<&str>) -> bool {
    let Some(host) = host else { return false };
    let host = host.trim().to_ascii_lowercase();
    host == format!("127.0.0.1:{}", DESKTOP_BRIDGE_PORT)
        || host == format!("localhost:{}", DESKTOP_BRIDGE_PORT)
}

/// Extension pages and service workers send a `*-extension://` origin; web pages send http(s).
pub(super) fn is_extension_origin(origin: &str) -> bool {
    origin.starts_with("chrome-extension://") || origin.starts_with("moz-extension://")
}

pub(super) fn origin_allowed(origin: Option<&str>) -> bool {
    origin.map_or(true, is_extension_origin)
}

pub(super) fn bearer_matches(authorization: Option<&str>, token: Option<&str>) -> bool {
    let (Some(header), Some(token)) = (authorization, token) else {
        return false;
    };
    let Some((scheme, value)) = header.trim().split_once(' ') else {
        return false;
    };
    scheme.eq_ignore_ascii_case("bearer") && constant_time_eq(value.trim(), token)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_is_created_once_with_private_mode() {
        let dir = tempfile::tempdir().unwrap();
        let first = load_or_create_token(dir.path()).unwrap();
        assert!(is_valid_token(&first));
        assert_eq!(first, load_or_create_token(dir.path()).unwrap());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(dir.path().join(TOKEN_FILE_NAME))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
    }

    #[test]
    fn host_must_be_loopback_with_bridge_port() {
        assert!(host_allowed(Some("127.0.0.1:19246")));
        assert!(host_allowed(Some("localhost:19246")));
        assert!(!host_allowed(Some("evil.example:19246")));
        assert!(!host_allowed(Some("127.0.0.1")));
        assert!(!host_allowed(Some("127.0.0.1:1420")));
        assert!(!host_allowed(None));
    }

    #[test]
    fn only_extension_or_missing_origin_is_allowed() {
        assert!(origin_allowed(None));
        assert!(origin_allowed(Some("chrome-extension://abcdef")));
        assert!(!origin_allowed(Some("https://evil.example")));
        assert!(!origin_allowed(Some("http://127.0.0.1:1420")));
        assert!(!origin_allowed(Some("null")));
    }

    #[test]
    fn bearer_requires_exact_token() {
        assert!(bearer_matches(Some("Bearer secret"), Some("secret")));
        assert!(bearer_matches(Some("bearer secret"), Some("secret")));
        assert!(!bearer_matches(Some("Bearer wrong"), Some("secret")));
        assert!(!bearer_matches(Some("secret"), Some("secret")));
        assert!(!bearer_matches(None, Some("secret")));
        assert!(!bearer_matches(Some("Bearer secret"), None));
    }
}
