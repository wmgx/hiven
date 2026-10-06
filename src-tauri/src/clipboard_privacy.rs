use tauri::{image::JsImage, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

// NSPasteboard's cache is shared with WebKit and our privacy/file readers.
// The clipboard plugin's own mutex cannot protect those other callers.
pub(crate) fn with_clipboard<T: Send + 'static>(
    app: &tauri::AppHandle,
    operation: impl FnOnce(tauri::AppHandle) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let handle = app.clone();
    #[cfg(target_os = "macos")]
    {
        let run = move || {
            debug_assert!(objc2::MainThreadMarker::new().is_some());
            objc2::rc::autoreleasepool(|_| operation(handle))
        };
        if objc2::MainThreadMarker::new().is_some() {
            return run();
        }
        let (tx, rx) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            let _ = tx.send(run());
        })
        .map_err(|error| error.to_string())?;
        rx.recv().map_err(|error| error.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    operation(handle)
}

#[tauri::command]
pub async fn clipboard_write_text(app: tauri::AppHandle, text: String) -> Result<(), String> {
    with_clipboard(&app, move |app| {
        app.clipboard()
            .write_text(text)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
pub async fn clipboard_read_image(webview: tauri::Webview) -> Result<tauri::ResourceId, String> {
    let image = with_clipboard(webview.app_handle(), |app| {
        app.clipboard()
            .read_image()
            .map(|image| image.to_owned())
            .map_err(|error| error.to_string())
    })?;
    Ok(webview.resources_table().add(image))
}

#[tauri::command]
pub async fn clipboard_write_image(webview: tauri::Webview, image: JsImage) -> Result<(), String> {
    // Release the resource-table lock before waiting for the main thread.
    let image = image
        .into_img(&webview.resources_table())
        .map_err(|error| error.to_string())?
        .as_ref()
        .clone()
        .to_owned();
    with_clipboard(webview.app_handle(), move |app| {
        app.clipboard()
            .write_image(&image)
            .map_err(|error| error.to_string())
    })
}

// One native operation checks the marker and reads the same pasteboard snapshot.
// A separate JS check followed by readText could capture a newly copied secret.
#[tauri::command]
pub async fn clipboard_read_public_text(app: tauri::AppHandle) -> Result<String, String> {
    with_clipboard(&app, |app| {
        #[cfg(target_os = "macos")]
        unsafe {
            let _ = app;
            use objc2::{class, msg_send, runtime::AnyObject};
            let board: *mut AnyObject = msg_send![class!(NSPasteboard), generalPasteboard];
            read_public_text(board)
        }
        #[cfg(not(target_os = "macos"))]
        app.clipboard()
            .read_text()
            .map_err(|_| "Clipboard read failed".into())
    })
}

#[tauri::command]
pub async fn clipboard_write_sensitive_text(
    app: tauri::AppHandle,
    text: String,
) -> Result<(), String> {
    with_clipboard(&app, move |_app| {
        #[cfg(target_os = "macos")]
        unsafe {
            use objc2::{class, msg_send, runtime::AnyObject};
            let board: *mut AnyObject = msg_send![class!(NSPasteboard), generalPasteboard];
            write_sensitive_text(board, text)
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = text;
            Err("Sensitive clipboard is only supported on macOS".into())
        }
    })
}

#[cfg(target_os = "macos")]
unsafe fn read_public_text(board: *mut objc2::runtime::AnyObject) -> Result<String, String> {
    use objc2::{class, msg_send, runtime::AnyObject};
    if board.is_null() {
        return Err("Clipboard unavailable".into());
    }
    let revision: isize = msg_send![board, changeCount];
    let types: *mut AnyObject = msg_send![board, types];
    for marker in [
        c"org.nspasteboard.ConcealedType",
        c"org.nspasteboard.TransientType",
    ] {
        let name: *mut AnyObject =
            msg_send![class!(NSString), stringWithUTF8String: marker.as_ptr()];
        let contains: bool = msg_send![types, containsObject: name];
        if contains {
            return Ok(String::new());
        }
    }
    let kind: *mut AnyObject =
        msg_send![class!(NSString), stringWithUTF8String: c"public.utf8-plain-text".as_ptr()];
    let value: *mut AnyObject = msg_send![board, stringForType: kind];
    if value.is_null() {
        return Ok(String::new());
    }
    let bytes: *const std::ffi::c_char = msg_send![value, UTF8String];
    let text = std::ffi::CStr::from_ptr(bytes)
        .to_string_lossy()
        .into_owned();
    let current: isize = msg_send![board, changeCount];
    Ok(if revision == current {
        text
    } else {
        String::new()
    })
}

#[cfg(target_os = "macos")]
unsafe fn write_sensitive_text(
    board: *mut objc2::runtime::AnyObject,
    text: String,
) -> Result<(), String> {
    use objc2::{class, msg_send, runtime::AnyObject};
    if board.is_null() {
        return Err("Clipboard unavailable".into());
    }
    let value = std::ffi::CString::new(text).map_err(|_| "Invalid clipboard text")?;
    let value: *mut AnyObject = msg_send![class!(NSString), stringWithUTF8String: value.as_ptr()];
    let item: *mut AnyObject = msg_send![class!(NSPasteboardItem), new];
    let empty: *mut AnyObject = msg_send![class!(NSString), stringWithUTF8String: c"".as_ptr()];
    for (kind, content) in [
        (c"public.utf8-plain-text", value),
        (c"org.nspasteboard.ConcealedType", empty),
        (c"org.nspasteboard.TransientType", empty),
    ] {
        let kind: *mut AnyObject = msg_send![class!(NSString), stringWithUTF8String: kind.as_ptr()];
        let accepted: bool = msg_send![item, setString: content, forType: kind];
        if !accepted {
            let _: () = msg_send![item, release];
            return Err("Sensitive clipboard preparation failed".into());
        }
    }
    let items: *mut AnyObject = msg_send![class!(NSArray), arrayWithObject: item];
    let _: isize = msg_send![board, clearContents];
    let written: bool = msg_send![board, writeObjects: items];
    let _: () = msg_send![item, release];
    if written {
        Ok(())
    } else {
        Err("Sensitive clipboard write failed".into())
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    #[test]
    fn sensitive_copy_is_readable_by_destination_but_not_history() {
        objc2::rc::autoreleasepool(|_| unsafe {
            use objc2::{class, msg_send, runtime::AnyObject};
            // A private pasteboard leaves the user's clipboard untouched.
            let board: *mut AnyObject = msg_send![class!(NSPasteboard), pasteboardWithUniqueName];
            assert!(
                !board.is_null(),
                "Private macOS pasteboard unavailable in this environment"
            );
            let kind: *mut AnyObject = msg_send![class!(NSString), stringWithUTF8String: c"public.utf8-plain-text".as_ptr()];
            let ordinary: *mut AnyObject =
                msg_send![class!(NSString), stringWithUTF8String: c"ordinary".as_ptr()];
            let _: bool = msg_send![board, setString: ordinary, forType: kind];
            assert_eq!(super::read_public_text(board).unwrap(), "ordinary");
            super::write_sensitive_text(board, "  dummy-secret  ".into()).unwrap();
            assert_eq!(super::read_public_text(board).unwrap(), "");
            let value: *mut AnyObject = msg_send![board, stringForType: kind];
            let bytes: *const std::ffi::c_char = msg_send![value, UTF8String];
            assert_eq!(
                std::ffi::CStr::from_ptr(bytes).to_str().unwrap(),
                "  dummy-secret  "
            );
            let _: () = msg_send![board, releaseGlobally];
        })
    }
}
