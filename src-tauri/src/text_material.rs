//! Explicit attached file -> current text material. Separate from the legacy read_file command.

use std::fs::{self, OpenOptions};
use std::io::{self, Read};
use std::path::Path;

const MAX_TEXT_BYTES: u64 = 1024 * 1024;

fn io_code(error: io::Error) -> String {
    match error.kind() {
        io::ErrorKind::NotFound => "not_found",
        io::ErrorKind::PermissionDenied => "permission_denied",
        _ => "read_failed",
    }
    .to_owned()
}

fn supported_path(path: &Path) -> bool {
    path.is_absolute()
        && path.to_str().is_some_and(|value| {
            !value.chars().any(char::is_control)
                && !value.starts_with("//")
                && !value.starts_with("\\\\")
        })
        && path
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| {
                matches!(
                    ext.to_ascii_lowercase().as_str(),
                    "txt"
                        | "md"
                        | "markdown"
                        | "json"
                        | "csv"
                        | "tsv"
                        | "xml"
                        | "yaml"
                        | "yml"
                        | "sql"
                        | "css"
                )
            })
}

fn read_bounded_text(reader: impl Read) -> Result<String, String> {
    let mut bytes = Vec::new();
    // Enforce the limit while reading too: metadata can race with file growth.
    reader
        .take(MAX_TEXT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(io_code)?;
    if bytes.len() as u64 > MAX_TEXT_BYTES {
        return Err("too_large".into());
    }
    let text = String::from_utf8(bytes).map_err(|_| "invalid_utf8".to_owned())?;
    if text
        .chars()
        .any(|ch| ch.is_control() && !matches!(ch, '\t' | '\n' | '\r'))
    {
        return Err("binary_content".into());
    }
    Ok(text)
}

pub(crate) fn read_text_file(path: &Path) -> Result<String, String> {
    if !supported_path(path) {
        return Err("unsupported_file".into());
    }
    // Reject known devices/FIFOs/directories before opening. Verify the opened
    // handle again below, since the path could be replaced between these calls.
    if !fs::metadata(path).map_err(io_code)?.is_file() {
        return Err("not_regular_file".into());
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        // A regular-file -> FIFO race must not hang the blocking worker at open.
        options.custom_flags(libc::O_NONBLOCK);
    }
    let file = options.open(path).map_err(io_code)?;
    let metadata = file.metadata().map_err(io_code)?;
    if !metadata.is_file() {
        return Err("not_regular_file".into());
    }
    if metadata.len() > MAX_TEXT_BYTES {
        return Err("too_large".into());
    }
    read_bounded_text(file)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static SERIAL: AtomicUsize = AtomicUsize::new(0);

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "hiven-text-material-{}-{}",
                std::process::id(),
                SERIAL.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn file(&self, name: &str, bytes: &[u8]) -> PathBuf {
            let path = self.0.join(name);
            fs::write(&path, bytes).unwrap();
            path
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn preserves_exact_text_and_empty_files() {
        let fixture = Fixture::new();
        for text in [
            "",
            " \t\r\n\r\n",
            "\u{feff}  中文\r\nline\n\r  ",
            "/synthetic/other.json",
        ] {
            let path = fixture.file("input.TXT", text.as_bytes());
            assert_eq!(read_text_file(&path).unwrap(), text);
        }
    }

    #[test]
    fn limit_is_inclusive_and_never_truncates() {
        let fixture = Fixture::new();
        let exact = vec![b'a'; MAX_TEXT_BYTES as usize];
        assert_eq!(
            read_text_file(&fixture.file("exact.txt", &exact))
                .unwrap()
                .len(),
            exact.len()
        );
        assert_eq!(
            read_text_file(&fixture.file("large.txt", &vec![b'a'; exact.len() + 1])),
            Err("too_large".into())
        );
        // The reader itself enforces the cap even if a regular file grows after metadata.
        struct Growing {
            read: usize,
        }
        impl Read for Growing {
            fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
                buf.fill(b'a');
                self.read += buf.len();
                Ok(buf.len())
            }
        }
        let mut growing = Growing { read: 0 };
        assert_eq!(read_bounded_text(&mut growing), Err("too_large".into()));
        assert_eq!(growing.read, MAX_TEXT_BYTES as usize + 1);
    }

    #[test]
    fn rejects_encoding_and_binary_without_partial_success() {
        let fixture = Fixture::new();
        assert_eq!(
            read_text_file(&fixture.file("bad.txt", &[b'a', 0xff])),
            Err("invalid_utf8".into())
        );
        for bytes in [
            b"before\0after".as_slice(),
            b"before\x01after",
            b"before\x7fafter",
            "a\u{0085}b".as_bytes(),
        ] {
            assert_eq!(
                read_text_file(&fixture.file("binary.txt", bytes)),
                Err("binary_content".into())
            );
        }
        struct FailingReader(bool);
        impl Read for FailingReader {
            fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
                if self.0 {
                    return Err(io::Error::from(io::ErrorKind::Other));
                }
                self.0 = true;
                buf[0] = b'a';
                Ok(1)
            }
        }
        assert_eq!(
            read_bounded_text(FailingReader(false)),
            Err("read_failed".into())
        );
    }

    #[test]
    fn rejects_unsupported_missing_and_non_regular_paths() {
        let fixture = Fixture::new();
        assert_eq!(
            read_text_file(Path::new("relative.txt")),
            Err("unsupported_file".into())
        );
        assert_eq!(
            read_text_file(&fixture.file("image.png", b"text")),
            Err("unsupported_file".into())
        );
        assert_eq!(
            read_text_file(&fixture.0.join("missing.txt")),
            Err("not_found".into())
        );
        let directory = fixture.0.join("directory.txt");
        fs::create_dir(&directory).unwrap();
        assert_eq!(read_text_file(&directory), Err("not_regular_file".into()));
        assert_eq!(
            io_code(io::Error::from(io::ErrorKind::PermissionDenied)),
            "permission_denied"
        );
        assert_eq!(
            io_code(io::Error::from(io::ErrorKind::Other)),
            "read_failed"
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_fifo_and_device_without_waiting_for_a_writer() {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;
        use std::os::unix::fs::symlink;
        let fixture = Fixture::new();
        let fifo = fixture.0.join("pipe.txt");
        let name = CString::new(fifo.as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0);
        assert_eq!(read_text_file(&fifo), Err("not_regular_file".into()));
        let device = fixture.0.join("device.txt");
        symlink("/dev/null", &device).unwrap();
        assert_eq!(read_text_file(&device), Err("not_regular_file".into()));
    }

    #[cfg(unix)]
    #[test]
    fn reports_permission_denied_without_losing_the_error_code() {
        use std::os::unix::fs::PermissionsExt;
        let fixture = Fixture::new();
        let path = fixture.file("private.txt", b"synthetic text");
        fs::set_permissions(&path, fs::Permissions::from_mode(0)).unwrap();
        // Root can read mode-000 files; the stable mapping is covered above too.
        if unsafe { libc::geteuid() } != 0 {
            assert_eq!(read_text_file(&path), Err("permission_denied".into()));
        }
    }
}
