fn main() {
    // On macOS: copy hiven-helper into binaries/ so Tauri's bundler can find it.
    // Must happen before tauri_build::build() which validates the path.
    #[cfg(target_os = "macos")]
    prepare_helper_binary();

    tauri_build::build()
}

#[cfg(target_os = "macos")]
fn prepare_helper_binary() {
    let target_triple = std::env::var("TARGET").unwrap_or_default();
    if !target_triple.contains("apple") {
        return;
    }

    let manifest_dir =
        std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default());
    let binaries_dir = manifest_dir.join("binaries");

    if let Err(e) = std::fs::create_dir_all(&binaries_dir) {
        eprintln!("cargo:warning=Failed to create binaries/ dir: {}", e);
        return;
    }

    let dest = binaries_dir.join(format!("hiven-helper-{}", target_triple));

    // Try to copy the real binary from the previous build's output.
    let profile = std::env::var("PROFILE").unwrap_or_else(|_| "debug".to_string());
    let target_dir = manifest_dir.join("target");

    // Search order: same-profile native → same-profile cross → debug fallback.
    // Falling back to debug ensures a release bundle (npm run tauri build) gets
    // fresh code even when the release helper hasn't been pre-built separately.
    // `cargo check --target <triple>` creates 0-byte placeholders, so we skip those.
    let real_src = [
        target_dir.join(&profile).join("hiven-helper"),
        target_dir.join(&target_triple).join(&profile).join("hiven-helper"),
        target_dir.join("debug").join("hiven-helper"),
        target_dir.join(&target_triple).join("debug").join("hiven-helper"),
    ]
    .into_iter()
    .find(|p| p.metadata().map(|m| m.len() > 0).unwrap_or(false));

    if let Some(src) = real_src {
        match std::fs::copy(&src, &dest) {
            Ok(_) => {
                set_executable(&dest);
                println!(
                    "cargo:warning=Copied hiven-helper → binaries/hiven-helper-{}",
                    target_triple
                );
                return;
            }
            Err(e) => {
                eprintln!("cargo:warning=Failed to copy hiven-helper: {}", e);
            }
        }
    }

    // No real binary found yet (first-ever build). Create an empty placeholder
    // so tauri-build doesn't reject the missing path. The placeholder will be
    // replaced on the next build after `cargo build --bin hiven-helper` runs.
    if !dest.exists() {
        let _ = std::fs::write(&dest, b"");
        set_executable(&dest);
        eprintln!(
            "cargo:warning=hiven-helper not built yet; created placeholder at binaries/hiven-helper-{target_triple}. Run `cargo build --bin hiven-helper --target {target_triple}` to populate it."
        );
    }
}

fn set_executable(path: &std::path::Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(path) {
            let mut perms = meta.permissions();
            perms.set_mode(0o755);
            let _ = std::fs::set_permissions(path, perms);
        }
    }
    let _ = path; // silence unused on Windows
}
