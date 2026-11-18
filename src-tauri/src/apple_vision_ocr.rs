use objc2::rc::autoreleasepool;
use objc2::runtime::{AnyClass, AnyObject};
use serde::Serialize;
use std::ffi::CStr;

#[link(name = "Vision", kind = "framework")]
unsafe extern "C" {}

const MAX_TEXT_CHARS: usize = 32_768;
const MAX_TEXT_LINES: usize = 1_000;

#[repr(C)]
#[derive(Clone, Copy)]
struct VisionRect {
    origin: [f64; 2],
    size: [f64; 2],
}

unsafe impl objc2::encode::Encode for VisionRect {
    const ENCODING: objc2::encode::Encoding = objc2::encode::Encoding::Struct(
        "CGRect",
        &[
            objc2::encode::Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]),
            objc2::encode::Encoding::Struct("CGSize", &[f64::ENCODING, f64::ENCODING]),
        ],
    );
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecognizedTextLine {
    text: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecognizedTextResult {
    text: String,
    lines: Vec<RecognizedTextLine>,
}

unsafe fn nsstring(value: &CStr) -> Result<*mut AnyObject, String> {
    let class = AnyClass::get(c"NSString").ok_or("NSString unavailable")?;
    let result: *mut AnyObject = objc2::msg_send![class, stringWithUTF8String: value.as_ptr()];
    if result.is_null() {
        Err("Could not create OCR language identifier".to_string())
    } else {
        Ok(result)
    }
}

unsafe fn rust_string(value: *mut AnyObject) -> Option<String> {
    if value.is_null() {
        return None;
    }
    let utf8: *const std::ffi::c_char = objc2::msg_send![value, UTF8String];
    if utf8.is_null() {
        return None;
    }
    Some(CStr::from_ptr(utf8).to_string_lossy().into_owned())
}

unsafe fn error_message(error: *mut AnyObject) -> String {
    if error.is_null() {
        return "Apple Vision OCR failed".to_string();
    }
    let description: *mut AnyObject = objc2::msg_send![error, localizedDescription];
    rust_string(description).unwrap_or_else(|| "Apple Vision OCR failed".to_string())
}

unsafe fn recognize(bytes: &[u8]) -> Result<RecognizedTextResult, String> {
    let data_class = AnyClass::get(c"NSData").ok_or("NSData unavailable")?;
    let data: *mut AnyObject =
        objc2::msg_send![data_class, dataWithBytes: bytes.as_ptr(), length: bytes.len()];
    if data.is_null() {
        return Err("Could not read OCR image bytes".to_string());
    }

    let request_class =
        AnyClass::get(c"VNRecognizeTextRequest").ok_or("Apple Vision OCR unavailable")?;
    let request: *mut AnyObject = objc2::msg_send![request_class, new];
    let request: *mut AnyObject = objc2::msg_send![request, autorelease];
    if request.is_null() {
        return Err("Could not create Apple Vision OCR request".to_string());
    }
    let _: () = objc2::msg_send![request, setRecognitionLevel: 0isize];
    let _: () = objc2::msg_send![request, setUsesLanguageCorrection: true];

    // Ask Vision which languages this OS revision supports before preferring Chinese and English.
    let revision: usize = objc2::msg_send![request, revision];
    let mut language_error: *mut AnyObject = std::ptr::null_mut();
    let supported: *mut AnyObject = objc2::msg_send![
        request_class,
        supportedRecognitionLanguagesForTextRecognitionLevel: 0isize,
        revision: revision,
        error: &mut language_error
    ];
    if !supported.is_null() {
        let array_class = AnyClass::get(c"NSMutableArray").ok_or("NSMutableArray unavailable")?;
        let preferred: *mut AnyObject = objc2::msg_send![array_class, arrayWithCapacity: 2usize];
        for code in [c"zh-Hans".as_ref(), c"en-US".as_ref()] {
            let language = nsstring(code)?;
            let available: bool = objc2::msg_send![supported, containsObject: language];
            if available {
                let _: () = objc2::msg_send![preferred, addObject: language];
            }
        }
        let count: usize = objc2::msg_send![preferred, count];
        if count > 0 {
            let _: () = objc2::msg_send![request, setRecognitionLanguages: preferred];
        }
    }

    let dictionary_class = AnyClass::get(c"NSDictionary").ok_or("NSDictionary unavailable")?;
    let options: *mut AnyObject = objc2::msg_send![dictionary_class, dictionary];
    let handler_class =
        AnyClass::get(c"VNImageRequestHandler").ok_or("Apple Vision image handler unavailable")?;
    let handler: *mut AnyObject = objc2::msg_send![handler_class, alloc];
    let handler: *mut AnyObject = objc2::msg_send![handler, initWithData: data, options: options];
    let handler: *mut AnyObject = objc2::msg_send![handler, autorelease];
    if handler.is_null() {
        return Err("Could not decode OCR image".to_string());
    }

    let array_class = AnyClass::get(c"NSArray").ok_or("NSArray unavailable")?;
    let requests: *mut AnyObject = objc2::msg_send![array_class, arrayWithObject: request];
    let mut error: *mut AnyObject = std::ptr::null_mut();
    let completed: bool = objc2::msg_send![handler, performRequests: requests, error: &mut error];
    if !completed {
        return Err(error_message(error));
    }

    let results: *mut AnyObject = objc2::msg_send![request, results];
    if results.is_null() {
        return Ok(RecognizedTextResult {
            text: String::new(),
            lines: Vec::new(),
        });
    }
    let count: usize = objc2::msg_send![results, count];
    let mut text = String::new();
    let mut lines = Vec::new();
    let mut chars = 0usize;
    for index in 0..count.min(MAX_TEXT_LINES) {
        let observation: *mut AnyObject = objc2::msg_send![results, objectAtIndex: index];
        let candidates: *mut AnyObject = objc2::msg_send![observation, topCandidates: 1usize];
        if candidates.is_null() {
            continue;
        }
        let candidate_count: usize = objc2::msg_send![candidates, count];
        if candidate_count == 0 {
            continue;
        }
        let candidate: *mut AnyObject = objc2::msg_send![candidates, objectAtIndex: 0usize];
        let value: *mut AnyObject = objc2::msg_send![candidate, string];
        let Some(line) = rust_string(value)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let remaining = MAX_TEXT_CHARS.saturating_sub(chars + usize::from(chars > 0));
        let line: String = line.chars().take(remaining).collect();
        if line.is_empty() {
            break;
        }
        if chars > 0 && chars < MAX_TEXT_CHARS {
            text.push('\n');
            chars += 1;
        }
        text.push_str(&line);
        chars += line.chars().count();
        let rect: VisionRect = objc2::msg_send![observation, boundingBox];
        let x = rect.origin[0].clamp(0.0, 1.0);
        let height = rect.size[1].clamp(0.0, 1.0);
        let width = rect.size[0].clamp(0.0, 1.0 - x);
        let y = (1.0 - rect.origin[1] - height).clamp(0.0, 1.0 - height);
        if width > 0.0 && height > 0.0 {
            lines.push(RecognizedTextLine {
                text: line,
                x,
                y,
                width,
                height,
            });
        }
        if chars >= MAX_TEXT_CHARS {
            break;
        }
    }
    Ok(RecognizedTextResult { text, lines })
}

pub fn recognize_text(bytes: &[u8]) -> Result<RecognizedTextResult, String> {
    autoreleasepool(|_| unsafe { recognize(bytes) })
}
