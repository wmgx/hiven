//! Hidden-launcher delivery; copies and round policy remain in the plugin.
use std::sync::{Mutex, OnceLock};

fn target() -> &'static Mutex<Option<(String, u32)>> {
    static TARGET: OnceLock<Mutex<Option<(String, u32)>>> = OnceLock::new();
    TARGET.get_or_init(|| Mutex::new(None))
}
fn require_launcher(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "launcher" && !window.is_visible().unwrap_or(true) { Ok(()) }
    else { Err("QueueTargetError".into()) }
}
#[tauri::command]
pub(crate) async fn begin_history_queue_paste(window: tauri::WebviewWindow) -> Result<String, String> {
    require_launcher(&window)?;
    #[cfg(target_os = "macos")]
    {
        if !crate::ax_is_trusted(false) { return Err("QueuePermissionError".into()); }
        let pid = crate::current_foreground_process_id().filter(|pid| *pid != 0 && *pid != std::process::id()).ok_or("QueueTargetError")?;
        let attempt = crate::paste_recovery::begin("launcher").ok_or("QueueTargetError")?;
        *target().lock().map_err(|_| "QueueUnavailableError")? = Some((attempt.id.clone(), pid));
        Ok(attempt.id.clone())
    }
    #[cfg(not(target_os = "macos"))]
    Err("QueuePlatformUnavailableError".into())
}
#[tauri::command]
pub(crate) async fn paste_history_queue_text(app: tauri::AppHandle, window: tauri::WebviewWindow, attempt_id: String, text: String) -> Result<(), String> {
    require_launcher(&window)?;
    if text.len() > 1024 * 1024 { return Err("QueueSnapshotError".into()); }
    let attempt = crate::paste_recovery::current("launcher", &attempt_id)?;
    attempt.claim()?;
    let pid = target().lock().map_err(|_| "QueueUnavailableError")?.take().filter(|(id, _)| id == &attempt_id).ok_or("QueueTargetError")?.1;
    #[cfg(target_os = "macos")]
    let result = tokio::task::spawn_blocking(move || deliver(&app, &attempt, pid, text)).await.map_err(|_| "QueueDeliveryError".to_string())?;
    #[cfg(not(target_os = "macos"))]
    let result = { let _ = (app, attempt, pid, text); Err("QueuePlatformUnavailableError".into()) };
    crate::paste_recovery::cancel("launcher", &attempt_id);
    result
}

#[cfg(target_os = "macos")]
fn deliver(app: &tauri::AppHandle, attempt: &std::sync::Arc<crate::paste_recovery::Attempt>, pid: u32, text: String) -> Result<(), String> {
    use std::time::{Duration, Instant};
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" { fn CGEventSourceFlagsState(state: i32) -> u64; }
    let verify = || {
        attempt.ensure_active()?;
        if crate::current_foreground_process_id() != Some(pid) { return Err("QueueTargetError".into()); }
        Ok::<(), String>(())
    };
    let deadline = Instant::now() + Duration::from_secs(1);
    // A released letter can leave Ctrl/Shift held; never inject through them.
    while unsafe { CGEventSourceFlagsState(1) } & ((1 << 17) | (1 << 18) | (1 << 19) | (1 << 20)) != 0 {
        verify()?;
        if Instant::now() >= deadline { return Err("QueueHeldKeyError".into()); }
        std::thread::sleep(Duration::from_millis(10));
    }
    verify()?;
    let for_write = attempt.clone();
    let (snapshot, written_count) = crate::clipboard_privacy::with_clipboard(app, move |_app| unsafe {
        for_write.ensure_active()?;
        if crate::current_foreground_process_id() != Some(pid) { return Err("QueueTargetError".into()); }
        let snapshot = capture(board())?;
        if let Err(error) = crate::clipboard_privacy::write_marked_text(board(), text, true) {
            restore(board(), snapshot)?;
            return Err(error);
        }
        Ok((snapshot, change_count()))
    })?;
    let for_paste = attempt.clone();
    let result = verify().and_then(|_| crate::clipboard_privacy::with_clipboard(app, move |_| unsafe {
        for_paste.ensure_active()?;
        if change_count() != written_count || crate::current_foreground_process_id() != Some(pid) { return Err("QueueTargetError".into()); }
        crate::simulate_paste_impl()
    }));
    // shortcut: macOS has no paste-consumed acknowledgement; validate this delay
    // with destination apps before extending delivery beyond plain-text targets.
    if result.is_ok() { std::thread::sleep(Duration::from_millis(250)); }
    let restored = crate::clipboard_privacy::with_clipboard(app, move |_| unsafe {
        // Never overwrite a newer copy made while the destination was reading.
        if change_count() == written_count { restore(board(), snapshot)?; }
        Ok(())
    });
    result.and(restored)
}

#[cfg(target_os = "macos")]
type Snapshot = Vec<Vec<(String, Vec<u8>)>>;
#[cfg(target_os = "macos")]
unsafe fn board() -> *mut objc2::runtime::AnyObject {
    objc2::msg_send![objc2::class!(NSPasteboard), generalPasteboard]
}
#[cfg(target_os = "macos")]
unsafe fn change_count() -> isize { objc2::msg_send![board(), changeCount] }
#[cfg(target_os = "macos")]
type Board = *mut objc2::runtime::AnyObject;
#[cfg(target_os = "macos")]
unsafe fn capture(board: Board) -> Result<Snapshot, String> {
    use objc2::{msg_send, runtime::AnyObject};
    let revision: isize = msg_send![board, changeCount];
    let items: *mut AnyObject = msg_send![board, pasteboardItems];
    let count: usize = msg_send![items, count];
    if count > 128 { return Err("QueueClipboardError".into()); }
    let mut snapshot = Vec::new();
    let mut bytes = 0usize;
    for index in 0..count {
        let item: *mut AnyObject = msg_send![items, objectAtIndex: index];
        let types: *mut AnyObject = msg_send![item, types];
        let type_count: usize = msg_send![types, count];
        if type_count > 128 { return Err("QueueClipboardError".into()); }
        let mut contents = Vec::new();
        for index in 0..type_count {
            let kind: *mut AnyObject = msg_send![types, objectAtIndex: index];
            let name: *const std::ffi::c_char = msg_send![kind, UTF8String];
            if name.is_null() { return Err("QueueClipboardError".into()); }
            let name = std::ffi::CStr::from_ptr(name).to_string_lossy().into_owned();
            let data: *mut AnyObject = msg_send![item, dataForType: kind];
            // Promised/lazy flavors can be unreadable after the source app moves on;
            // keep every readable flavor instead of refusing the whole delivery.
            if data.is_null() { continue; }
            let size: usize = msg_send![data, length];
            bytes = bytes.checked_add(size).ok_or("QueueClipboardError")?;
            if bytes > 64 * 1024 * 1024 { return Err("QueueClipboardError".into()); }
            let data: *const u8 = msg_send![data, bytes];
            if size != 0 && data.is_null() { return Err("QueueClipboardError".into()); }
            contents.push((name, if size == 0 { Vec::new() } else { std::slice::from_raw_parts(data, size).to_vec() }));
        }
        if !contents.is_empty() { snapshot.push(contents); }
    }
    let current: isize = msg_send![board, changeCount];
    if revision != current { return Err("QueueClipboardError".into()); }
    Ok(snapshot)
}
#[cfg(target_os = "macos")]
unsafe fn restore(board: Board, snapshot: Snapshot) -> Result<(), String> {
    use objc2::{class, msg_send, runtime::AnyObject};
    // Nothing readable was captured: leave the board alone rather than clear it.
    if snapshot.is_empty() { return Ok(()); }
    let items: *mut AnyObject = msg_send![class!(NSMutableArray), array];
    for (index, mut contents) in snapshot.into_iter().enumerate() {
        let item: *mut AnyObject = msg_send![class!(NSPasteboardItem), new];
        let _: *mut AnyObject = msg_send![item, autorelease];
        // The restored copy is written by hiven; mark it on this board so history ignores it.
        if index == 0 && !contents.iter().any(|(name, _)| name == "org.hiven.ClipboardOrigin") {
            contents.push(("org.hiven.ClipboardOrigin".into(), Vec::new()));
        }
        for (name, bytes) in contents {
            let name = std::ffi::CString::new(name).map_err(|_| "QueueClipboardError")?;
            let kind: *mut AnyObject = msg_send![class!(NSString), stringWithUTF8String: name.as_ptr()];
            let data: *mut AnyObject = msg_send![class!(NSData), dataWithBytes: bytes.as_ptr(), length: bytes.len()];
            let accepted: bool = msg_send![item, setData: data, forType: kind];
            if !accepted { return Err("QueueClipboardError".into()); }
        }
        let _: () = msg_send![items, addObject: item];
    }
    let _: isize = msg_send![board, clearContents];
    let written: bool = msg_send![board, writeObjects: items];
    if written { Ok(()) } else { Err("QueueClipboardError".into()) }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use objc2::{class, msg_send, runtime::AnyObject};

    unsafe fn set(board: *mut AnyObject, kinds: &[(&std::ffi::CStr, &[u8])]) {
        let item: *mut AnyObject = msg_send![class!(NSPasteboardItem), new];
        for (kind, bytes) in kinds {
            let kind: *mut AnyObject = msg_send![class!(NSString), stringWithUTF8String: kind.as_ptr()];
            let data: *mut AnyObject = msg_send![class!(NSData), dataWithBytes: bytes.as_ptr(), length: bytes.len()];
            let _: bool = msg_send![item, setData: data, forType: kind];
        }
        let items: *mut AnyObject = msg_send![class!(NSArray), arrayWithObject: item];
        let _: isize = msg_send![board, clearContents];
        let _: bool = msg_send![board, writeObjects: items];
        let _: () = msg_send![item, release];
    }

    #[test]
    fn delivery_restores_every_flavor_of_the_previous_copy() {
        objc2::rc::autoreleasepool(|_| unsafe {
            // A private pasteboard leaves the user's clipboard untouched.
            let board: *mut AnyObject = msg_send![class!(NSPasteboard), pasteboardWithUniqueName];
            assert!(!board.is_null());
            let rtf: &[u8] = b"{\\rtf1\\ansi \\u21512?\\u25104? bold}";
            let png: &[u8] = &[0x89, b'P', b'N', b'G', 0, 1, 2, 255];
            set(board, &[
                (c"public.utf8-plain-text", "合成 第一段 😀".as_bytes()),
                (c"public.rtf", rtf),
                (c"public.png", png),
                (c"com.example.empty", b""),
            ]);
            let before = super::capture(board).unwrap();
            crate::clipboard_privacy::write_marked_text(board, "队列第二段 é".into(), true).unwrap();
            assert_eq!(super::capture(board).unwrap()[0][0], ("public.utf8-plain-text".into(), "队列第二段 é".as_bytes().to_vec()));
            super::restore(board, before.clone()).unwrap();
            let after = super::capture(board).unwrap();
            // Restore adds the hiven origin marker; every original flavor must survive byte-for-byte.
            for flavor in &before[0] { assert!(after[0].contains(flavor), "lost {}", flavor.0); }
            assert!(after[0].iter().any(|(name, _)| name == "org.hiven.ClipboardOrigin"));
            let _: () = msg_send![board, releaseGlobally];
        })
    }
}
