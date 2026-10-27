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
        let snapshot = capture()?;
        crate::clipboard_privacy::write_marked_text(board(), text, true)?;
        Ok((snapshot, change_count()))
    })?;
    let result = verify().and_then(|_| crate::simulate_paste_impl());
    // shortcut: macOS has no paste-consumed acknowledgement; validate this delay
    // with destination apps before extending delivery beyond plain-text targets.
    if result.is_ok() { std::thread::sleep(Duration::from_millis(250)); }
    let restored = crate::clipboard_privacy::with_clipboard(app, move |_| unsafe {
        // Never overwrite a newer copy made while the destination was reading.
        if change_count() == written_count { restore(snapshot)?; }
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
unsafe fn capture() -> Result<Snapshot, String> {
    use objc2::{msg_send, runtime::AnyObject};
    let revision = change_count();
    let items: *mut AnyObject = msg_send![board(), pasteboardItems];
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
            if data.is_null() { return Err("QueueClipboardError".into()); }
            let size: usize = msg_send![data, length];
            bytes = bytes.checked_add(size).ok_or("QueueClipboardError")?;
            if bytes > 64 * 1024 * 1024 { return Err("QueueClipboardError".into()); }
            let data: *const u8 = msg_send![data, bytes];
            if size != 0 && data.is_null() { return Err("QueueClipboardError".into()); }
            contents.push((name, if size == 0 { Vec::new() } else { std::slice::from_raw_parts(data, size).to_vec() }));
        }
        snapshot.push(contents);
    }
    if revision != change_count() { return Err("QueueClipboardError".into()); }
    Ok(snapshot)
}
#[cfg(target_os = "macos")]
unsafe fn restore(snapshot: Snapshot) -> Result<(), String> {
    use objc2::{class, msg_send, runtime::AnyObject};
    let items: *mut AnyObject = msg_send![class!(NSMutableArray), array];
    for contents in snapshot {
        let item: *mut AnyObject = msg_send![class!(NSPasteboardItem), new];
        let _: *mut AnyObject = msg_send![item, autorelease];
        for (name, bytes) in contents {
            let name = std::ffi::CString::new(name).map_err(|_| "QueueClipboardError")?;
            let kind: *mut AnyObject = msg_send![class!(NSString), stringWithUTF8String: name.as_ptr()];
            let data: *mut AnyObject = msg_send![class!(NSData), dataWithBytes: bytes.as_ptr(), length: bytes.len()];
            let accepted: bool = msg_send![item, setData: data, forType: kind];
            if !accepted { return Err("QueueClipboardError".into()); }
        }
        let _: () = msg_send![items, addObject: item];
    }
    let _: isize = msg_send![board(), clearContents];
    let written: bool = msg_send![board(), writeObjects: items];
    if !written { return Err("QueueClipboardError".into()); }
    crate::clipboard_privacy::mark_owned_clipboard()
}
