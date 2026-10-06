use serde::{Deserialize, Serialize};
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureOptions {
    pub image: bool,
    #[serde(default)]
    pub excluded_apps: Vec<String>,
    pub max_idle_seconds: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    captured_at: u128,
    app_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    bundle_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    window_title: Option<String>,
    idle_seconds: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    skipped: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    image_bytes: Option<Vec<u8>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{CaptureOptions, Snapshot};
    use core_foundation::base::{CFType, TCFType, ToVoid};
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
    use core_foundation::string::CFString;
    use core_graphics::display::CGRectNull;
    use core_graphics::event_source::CGEventSourceStateID;
    use core_graphics::window::{
        kCGWindowImageBestResolution, kCGWindowImageBoundsIgnoreFraming,
        kCGWindowListOptionIncludingWindow, CGWindowListCreateImage,
    };
    use objc2::rc::autoreleasepool;
    use objc2::runtime::{AnyClass, AnyObject};
    use std::ffi::{c_char, c_void, CStr};
    use std::ptr;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(
            state_id: CGEventSourceStateID,
            event_type: u32,
        ) -> f64;
        fn CGSessionCopyCurrentDictionary() -> CFDictionaryRef;
    }

    #[link(name = "Vision", kind = "framework")]
    extern "C" {}

    struct Foreground {
        pid: u32,
        app_name: String,
        bundle_id: Option<String>,
    }

    pub fn capture(options: CaptureOptions) -> Result<Snapshot, String> {
        autoreleasepool(|_| capture_inner(options))
    }

    fn capture_inner(options: CaptureOptions) -> Result<Snapshot, String> {
        if !options.max_idle_seconds.is_finite()
            || !(0.0..=86_400.0).contains(&options.max_idle_seconds)
        {
            return Err("invalid-max-idle-seconds".into());
        }

        let captured_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "clock-unavailable")?
            .as_millis();
        let before = foreground().ok_or("foreground-app-unavailable")?;
        let idle_seconds = idle_seconds();
        let window = super::super::list_macos_desktop_windows_raw()?
            .into_iter()
            .find(|window| window.pid == before.pid);
        let window_title = window
            .as_ref()
            .map(|window| window.title.trim().to_string())
            .filter(|title| !title.is_empty());

        let base = |skipped| Snapshot {
            captured_at,
            app_name: before.app_name.clone(),
            bundle_id: before.bundle_id.clone(),
            window_title: window_title.clone(),
            idle_seconds,
            skipped,
            image_bytes: None,
            text: None,
        };

        if session_is_locked()
            || before.app_name.eq_ignore_ascii_case("loginwindow")
            || before.bundle_id.as_deref() == Some("com.apple.loginwindow")
        {
            return Ok(base(Some("locked")));
        }
        if idle_seconds > options.max_idle_seconds {
            return Ok(base(Some("idle")));
        }
        if is_excluded(&before, &options.excluded_apps) {
            return Ok(base(Some("excluded")));
        }
        if !options.image {
            return Ok(base(None));
        }

        let access = core_graphics::access::ScreenCaptureAccess;
        if !access.preflight() && !access.request() {
            return Err("screen-permission-required".into());
        }
        let Some(window) = window else {
            return Ok(base(Some("changed")));
        };
        let window_id = window
            .id
            .parse::<u32>()
            .map_err(|_| "foreground-window-unavailable")?;

        // ponytail: CGWindowListCreateImage is obsolete on macOS 15 but still available;
        // replace this one-shot primitive with ScreenCaptureKit when the old API is removed.
        let image = unsafe {
            CGWindowListCreateImage(
                CGRectNull,
                kCGWindowListOptionIncludingWindow,
                window_id,
                kCGWindowImageBoundsIgnoreFraming | kCGWindowImageBestResolution,
            )
        };
        if image.is_null() {
            return Err("capture-failed".into());
        }
        // Owned wrapper: the full window bitmap is released on every exit, including the `?`
        // early returns below (a manual CFRelease after them leaked it whenever OCR/PNG failed).
        let image = unsafe { CFType::wrap_under_create_rule(image.cast_const().cast()) };
        let raw_image = image.as_CFTypeRef().cast_mut();
        let text = unsafe { recognize_text(raw_image)? };
        // Lossless transport to the host's system video encoder; avoid JPEG generation loss.
        let image_bytes = unsafe { encode_png(raw_image)? };
        drop(image);

        let after = foreground().ok_or("foreground-app-unavailable")?;
        if session_is_locked()
            || after.app_name.eq_ignore_ascii_case("loginwindow")
            || after.bundle_id.as_deref() == Some("com.apple.loginwindow")
        {
            return Ok(base(Some("locked")));
        }
        let after_window = super::super::list_macos_desktop_windows_raw()?
            .into_iter()
            .find(|candidate| candidate.pid == after.pid);
        if after.pid != before.pid
            || after_window.as_ref().map(|candidate| candidate.id.as_str())
                != Some(window.id.as_str())
        {
            return Ok(base(Some("changed")));
        }
        if is_excluded(&after, &options.excluded_apps) {
            return Ok(base(Some("excluded")));
        }

        Ok(Snapshot {
            captured_at,
            app_name: before.app_name,
            bundle_id: before.bundle_id,
            window_title,
            idle_seconds,
            skipped: None,
            image_bytes: Some(image_bytes),
            text: Some(text),
        })
    }

    fn idle_seconds() -> f64 {
        unsafe {
            CGEventSourceSecondsSinceLastEventType(CGEventSourceStateID::HIDSystemState, u32::MAX)
        }
    }

    fn session_is_locked() -> bool {
        let raw = unsafe { CGSessionCopyCurrentDictionary() };
        if raw.is_null() {
            return true;
        }
        let dictionary: CFDictionary = unsafe { TCFType::wrap_under_create_rule(raw) };
        let value = |key: &str| -> Option<bool> {
            let key = CFString::new(key);
            let raw = *dictionary.find(key.to_void())?;
            if raw.is_null() {
                return None;
            }
            let value = unsafe { CFType::wrap_under_get_rule(raw as *const c_void) };
            value.downcast::<CFBoolean>().map(bool::from)
        };

        value("CGSSessionScreenIsLocked").unwrap_or(false)
            || value("kCGSSessionOnConsoleKey") != Some(true)
            // macOS 15 can omit LoginDone after a successful console login.
            || value("kCGSSessionLoginDoneKey") == Some(false)
    }

    fn foreground() -> Option<Foreground> {
        unsafe {
            let workspace: *mut AnyObject =
                objc2::msg_send![AnyClass::get(c"NSWorkspace")?, sharedWorkspace];
            if workspace.is_null() {
                return None;
            }
            let app: *mut AnyObject = objc2::msg_send![workspace, frontmostApplication];
            if app.is_null() {
                return None;
            }
            let pid: i32 = objc2::msg_send![app, processIdentifier];
            let app_name = ns_string(objc2::msg_send![app, localizedName])?;
            let bundle_id = ns_string(objc2::msg_send![app, bundleIdentifier]);
            Some(Foreground {
                pid: u32::try_from(pid).ok()?,
                app_name,
                bundle_id,
            })
        }
    }

    fn is_excluded(foreground: &Foreground, excluded_apps: &[String]) -> bool {
        excluded_apps.iter().any(|excluded| {
            let excluded = excluded.trim();
            !excluded.is_empty()
                && (excluded.eq_ignore_ascii_case(&foreground.app_name)
                    || foreground
                        .bundle_id
                        .as_deref()
                        .is_some_and(|bundle_id| excluded.eq_ignore_ascii_case(bundle_id)))
        })
    }

    unsafe fn ns_string(value: *mut AnyObject) -> Option<String> {
        if value.is_null() {
            return None;
        }
        let utf8: *const c_char = objc2::msg_send![value, UTF8String];
        (!utf8.is_null()).then(|| CStr::from_ptr(utf8).to_string_lossy().into_owned())
    }

    unsafe fn encode_png(image: *mut c_void) -> Result<Vec<u8>, String> {
        let bitmap_class = AnyClass::get(c"NSBitmapImageRep").ok_or("capture-failed")?;
        let bitmap: *mut AnyObject = objc2::msg_send![bitmap_class, alloc];
        let bitmap: *mut AnyObject = objc2::msg_send![bitmap, initWithCGImage: image];
        if bitmap.is_null() {
            return Err("capture-failed".into());
        }
        let data: *mut AnyObject = objc2::msg_send![
            bitmap,
            representationUsingType: 4usize,
            properties: ptr::null_mut::<AnyObject>()
        ];
        if data.is_null() {
            let _: () = objc2::msg_send![bitmap, release];
            return Err("capture-failed".into());
        }
        let len: usize = objc2::msg_send![data, length];
        let bytes: *const u8 = objc2::msg_send![data, bytes];
        let encoded = (!bytes.is_null() && len > 0)
            .then(|| std::slice::from_raw_parts(bytes, len).to_vec())
            .ok_or("capture-failed");
        let _: () = objc2::msg_send![bitmap, release];
        encoded.map_err(String::from)
    }

    unsafe fn recognize_text(image: *mut c_void) -> Result<String, String> {
        // Resolve every class before creating `request`, so no `?` below can skip its release.
        let request_class = AnyClass::get(c"VNRecognizeTextRequest").ok_or("ocr-failed")?;
        let array_class = AnyClass::get(c"NSArray").ok_or("ocr-failed")?;
        let dictionary_class = AnyClass::get(c"NSDictionary").ok_or("ocr-failed")?;
        let handler_class = AnyClass::get(c"VNImageRequestHandler").ok_or("ocr-failed")?;
        let request: *mut AnyObject = objc2::msg_send![request_class, new];
        if request.is_null() {
            return Err("ocr-failed".into());
        }
        // Accurate is 0. Automatic language detection handles mixed Chinese/English on macOS 13+.
        let _: () = objc2::msg_send![request, setRecognitionLevel: 0isize];
        let _: () = objc2::msg_send![request, setUsesLanguageCorrection: false];
        let _: () = objc2::msg_send![request, setAutomaticallyDetectsLanguage: true];

        let requests: *mut AnyObject = objc2::msg_send![array_class, arrayWithObject: request];
        let options: *mut AnyObject = objc2::msg_send![dictionary_class, dictionary];
        let handler: *mut AnyObject = objc2::msg_send![handler_class, alloc];
        let handler: *mut AnyObject =
            objc2::msg_send![handler, initWithCGImage: image, options: options];
        if handler.is_null() {
            let _: () = objc2::msg_send![request, release];
            return Err("ocr-failed".into());
        }

        let mut error: *mut AnyObject = ptr::null_mut();
        let succeeded: bool =
            objc2::msg_send![handler, performRequests: requests, error: &mut error];
        if !succeeded {
            let _: () = objc2::msg_send![handler, release];
            let _: () = objc2::msg_send![request, release];
            return Err("ocr-failed".into());
        }

        let results: *mut AnyObject = objc2::msg_send![request, results];
        let count: usize = if results.is_null() {
            0
        } else {
            objc2::msg_send![results, count]
        };
        let mut lines = Vec::with_capacity(count);
        for index in 0..count {
            let observation: *mut AnyObject = objc2::msg_send![results, objectAtIndex: index];
            let candidates: *mut AnyObject = objc2::msg_send![observation, topCandidates: 1usize];
            let candidate_count: usize = if candidates.is_null() {
                0
            } else {
                objc2::msg_send![candidates, count]
            };
            if candidate_count == 0 {
                continue;
            }
            let candidate: *mut AnyObject = objc2::msg_send![candidates, objectAtIndex: 0usize];
            let value: *mut AnyObject = objc2::msg_send![candidate, string];
            if let Some(line) = ns_string(value).filter(|line| !line.trim().is_empty()) {
                lines.push(line);
            }
        }

        let _: () = objc2::msg_send![handler, release];
        let _: () = objc2::msg_send![request, release];
        Ok(lines.join("\n"))
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use core_graphics::geometry::{CGPoint, CGRect, CGSize};

        #[link(name = "CoreGraphics", kind = "framework")]
        extern "C" {
            fn CGColorSpaceCreateDeviceRGB() -> *mut c_void;
            fn CGBitmapContextCreate(
                data: *mut c_void,
                width: usize,
                height: usize,
                bits_per_component: usize,
                bytes_per_row: usize,
                color_space: *mut c_void,
                bitmap_info: u32,
            ) -> *mut c_void;
            fn CGContextSetRGBFillColor(
                context: *mut c_void,
                red: f64,
                green: f64,
                blue: f64,
                alpha: f64,
            );
            fn CGContextFillRect(context: *mut c_void, rect: CGRect);
            fn CGBitmapContextCreateImage(context: *mut c_void) -> *mut c_void;
        }

        #[test]
        fn synthetic_image_exercises_png_and_vision_bridges() {
            autoreleasepool(|_| unsafe {
                let color_space = CGColorSpaceCreateDeviceRGB();
                assert!(!color_space.is_null());
                let context = CGBitmapContextCreate(
                    ptr::null_mut(),
                    64,
                    64,
                    8,
                    64 * 4,
                    color_space,
                    1, // kCGImageAlphaPremultipliedLast
                );
                assert!(!context.is_null());
                CGContextSetRGBFillColor(context, 1.0, 1.0, 1.0, 1.0);
                CGContextFillRect(
                    context,
                    CGRect::new(&CGPoint::new(0.0, 0.0), &CGSize::new(64.0, 64.0)),
                );
                let image = CGBitmapContextCreateImage(context);
                assert!(!image.is_null());

                let png = encode_png(image).expect("synthetic PNG encoding");
                assert!(png.starts_with(b"\x89PNG\r\n\x1a\n"));
                assert!(recognize_text(image)
                    .expect("synthetic Vision OCR")
                    .is_empty());

                core_foundation::base::CFRelease(image.cast());
                core_foundation::base::CFRelease(context.cast());
                core_foundation::base::CFRelease(color_space.cast());
            });
        }
    }
}

#[tauri::command]
pub async fn capture_desktop_snapshot(options: CaptureOptions) -> Result<Snapshot, String> {
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || macos::capture(options))
            .await
            .map_err(|error| format!("desktop-capture-task-failed: {error}"))?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = options;
        Err("unsupported-platform".into())
    }
}
