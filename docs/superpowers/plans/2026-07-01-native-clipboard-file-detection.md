# Native Clipboard File Detection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace regex-based file path guessing with native macOS pasteboard type detection, providing a single unified Rust command that tells the frontend exactly what kind of content is on the clipboard.

**Architecture:** A new Tauri command `read_clipboard_content` reads `NSPasteboard` types by priority (`public.file-url` > image > text) and returns a tagged enum. The frontend watcher calls this single command per poll cycle (gated by `changeCount`) instead of separately reading text + image + running regex heuristics. A companion `write_clipboard_files` command writes real file URLs back.

**Tech Stack:** Rust (`objc2` 0.6, `block2` 0.6, `tauri` 2.x, `serde`), TypeScript (Tauri invoke API)

---

### Task 1: Rust — `read_clipboard_content` command (macOS)

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the `ClipboardContent` enum**

After the existing imports and before the first `#[tauri::command]`, add:

```rust
#[derive(serde::Serialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum ClipboardContent {
    Files { paths: Vec<String> },
    Image,
    Text { text: String },
    Empty,
}
```

- [ ] **Step 2: Implement `read_clipboard_content` for macOS**

Add this function after `read_clipboard_change_count`:

```rust
#[cfg(target_os = "macos")]
#[tauri::command]
fn read_clipboard_content() -> ClipboardContent {
    unsafe {
        let pasteboard_cls = match objc2::runtime::AnyClass::get(c"NSPasteboard") {
            Some(cls) => cls,
            None => return ClipboardContent::Empty,
        };
        let pasteboard: *mut objc2::runtime::AnyObject =
            objc2::msg_send![pasteboard_cls, generalPasteboard];
        if pasteboard.is_null() {
            return ClipboardContent::Empty;
        }

        // Read available types as NSArray<NSString>
        let types: *mut objc2::runtime::AnyObject = objc2::msg_send![pasteboard, types];
        if types.is_null() {
            return ClipboardContent::Empty;
        }

        let has_type = |type_str: &CStr| -> bool {
            let ns_string_cls = objc2::runtime::AnyClass::get(c"NSString").unwrap();
            let ns_type: *mut objc2::runtime::AnyObject =
                objc2::msg_send![ns_string_cls, stringWithUTF8String: type_str.as_ptr()];
            let contains: bool = objc2::msg_send![types, containsObject: ns_type];
            contains
        };

        // Priority 1: Files (public.file-url)
        if has_type(c"public.file-url") {
            let nsurl_cls = match objc2::runtime::AnyClass::get(c"NSURL") {
                Some(cls) => cls,
                None => return ClipboardContent::Empty,
            };
            let class_array: *mut objc2::runtime::AnyObject = {
                let nsarray_cls = objc2::runtime::AnyClass::get(c"NSArray").unwrap();
                objc2::msg_send![nsarray_cls, arrayWithObject: nsurl_cls]
            };
            let null: *const objc2::runtime::AnyObject = std::ptr::null();
            let urls: *mut objc2::runtime::AnyObject =
                objc2::msg_send![pasteboard, readObjectsForClasses: class_array options: null];

            if !urls.is_null() {
                let count: usize = objc2::msg_send![urls, count];
                let mut paths: Vec<String> = Vec::with_capacity(count);
                for i in 0..count {
                    let url: *mut objc2::runtime::AnyObject =
                        objc2::msg_send![urls, objectAtIndex: i];
                    let is_file: bool = objc2::msg_send![url, isFileURL];
                    if is_file {
                        let path: *mut objc2::runtime::AnyObject =
                            objc2::msg_send![url, path];
                        if !path.is_null() {
                            let utf8: *const c_char = objc2::msg_send![path, UTF8String];
                            if !utf8.is_null() {
                                if let Ok(s) = CStr::from_ptr(utf8).to_str() {
                                    paths.push(s.to_string());
                                }
                            }
                        }
                    }
                }
                if !paths.is_empty() {
                    return ClipboardContent::Files { paths };
                }
            }
        }

        // Priority 2: Image (public.tiff or public.png)
        if has_type(c"public.tiff") || has_type(c"public.png") {
            return ClipboardContent::Image;
        }

        // Priority 3: Text (public.utf8-plain-text)
        if has_type(c"public.utf8-plain-text") {
            let ns_type_str = {
                let ns_string_cls = objc2::runtime::AnyClass::get(c"NSString").unwrap();
                let s: *mut objc2::runtime::AnyObject = objc2::msg_send![
                    ns_string_cls,
                    stringWithUTF8String: c"public.utf8-plain-text".as_ptr()
                ];
                s
            };
            let ns_string: *mut objc2::runtime::AnyObject =
                objc2::msg_send![pasteboard, stringForType: ns_type_str];
            if !ns_string.is_null() {
                let utf8: *const c_char = objc2::msg_send![ns_string, UTF8String];
                if !utf8.is_null() {
                    if let Ok(s) = CStr::from_ptr(utf8).to_str() {
                        return ClipboardContent::Text {
                            text: s.to_string(),
                        };
                    }
                }
            }
        }

        ClipboardContent::Empty
    }
}
```

- [ ] **Step 3: Add non-macOS fallback**

```rust
#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn read_clipboard_content(app: tauri::AppHandle) -> ClipboardContent {
    // Fallback: use tauri clipboard plugin for text only
    match app.clipboard().read_text() {
        Ok(text) if !text.is_empty() => ClipboardContent::Text { text },
        _ => ClipboardContent::Empty,
    }
}
```

- [ ] **Step 4: Register the command in `generate_handler!`**

In the `.invoke_handler(tauri::generate_handler![...])` block, add `read_clipboard_content` after `current_foreground_app_name`:

```rust
    current_foreground_app_name,
    current_foreground_app_context,
    read_clipboard_content,
```

- [ ] **Step 5: Build and verify compilation**

Run:
```bash
cd src-tauri && cargo check
```
Expected: compiles without errors.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(clipboard): add read_clipboard_content native command

Reads NSPasteboard types by priority (files > image > text)
and returns a tagged enum. Replaces frontend regex guessing."
```

---

### Task 2: Rust — `write_clipboard_files` command (macOS)

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Implement `write_clipboard_files` for macOS**

Add after `read_clipboard_content`:

```rust
#[cfg(target_os = "macos")]
#[tauri::command]
fn write_clipboard_files(paths: Vec<String>) -> Result<(), String> {
    unsafe {
        let pasteboard_cls = objc2::runtime::AnyClass::get(c"NSPasteboard")
            .ok_or("NSPasteboard class not found")?;
        let pasteboard: *mut objc2::runtime::AnyObject =
            objc2::msg_send![pasteboard_cls, generalPasteboard];
        if pasteboard.is_null() {
            return Err("Failed to get generalPasteboard".into());
        }

        // Clear current contents
        let _: i64 = objc2::msg_send![pasteboard, clearContents];

        // Build NSMutableArray of NSURL
        let nsarray_cls = objc2::runtime::AnyClass::get(c"NSMutableArray")
            .ok_or("NSMutableArray class not found")?;
        let nsurl_cls = objc2::runtime::AnyClass::get(c"NSURL")
            .ok_or("NSURL class not found")?;
        let ns_string_cls = objc2::runtime::AnyClass::get(c"NSString")
            .ok_or("NSString class not found")?;

        let urls: *mut objc2::runtime::AnyObject =
            objc2::msg_send![nsarray_cls, arrayWithCapacity: paths.len()];

        for path in &paths {
            let c_path = CString::new(path.as_str()).map_err(|e| e.to_string())?;
            let ns_path: *mut objc2::runtime::AnyObject =
                objc2::msg_send![ns_string_cls, stringWithUTF8String: c_path.as_ptr()];
            let url: *mut objc2::runtime::AnyObject =
                objc2::msg_send![nsurl_cls, fileURLWithPath: ns_path];
            let _: () = objc2::msg_send![urls, addObject: url];
        }

        let success: bool = objc2::msg_send![pasteboard, writeObjects: urls];
        if success {
            Ok(())
        } else {
            Err("NSPasteboard writeObjects failed".into())
        }
    }
}
```

- [ ] **Step 2: Add non-macOS fallback**

```rust
#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn write_clipboard_files(app: tauri::AppHandle, paths: Vec<String>) -> Result<(), String> {
    // Fallback: write paths as newline-separated text
    app.clipboard()
        .write_text(paths.join("\n"))
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 3: Register in `generate_handler!`**

```rust
    read_clipboard_content,
    write_clipboard_files,
```

- [ ] **Step 4: Build and verify**

```bash
cd src-tauri && cargo check
```
Expected: compiles without errors.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(clipboard): add write_clipboard_files native command

Writes file paths as public.file-url NSURLs to NSPasteboard,
so other apps (Finder, etc.) recognize them as real file copies."
```

---

### Task 3: Rust — Expose `read_clipboard_change_count` as Tauri command

**Files:**
- Modify: `src-tauri/src/lib.rs`

Currently `read_clipboard_change_count` is a private helper that takes `&AppHandle`. We need a public Tauri command for the frontend to call as a cheap "has anything changed?" check.

- [ ] **Step 1: Add a command wrapper**

```rust
#[tauri::command]
fn clipboard_change_count(app: tauri::AppHandle) -> Option<i64> {
    read_clipboard_change_count(&app)
}
```

- [ ] **Step 2: Register in `generate_handler!`**

```rust
    write_clipboard_files,
    clipboard_change_count,
```

- [ ] **Step 3: Build and verify**

```bash
cd src-tauri && cargo check
```
Expected: compiles without errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(clipboard): expose clipboard_change_count as tauri command

Allows frontend to cheaply check if clipboard has changed
before doing a full content read."
```

---

### Task 4: Frontend — Rewrite watcher to use native commands

**Files:**
- Modify: `src/workspace/pluginClipboard.ts`

- [ ] **Step 1: Add TypeScript type for native response**

At the top of the file, after existing imports, add:

```typescript
type NativeClipboardContent =
  | { kind: 'files'; paths: string[] }
  | { kind: 'image' }
  | { kind: 'text'; text: string }
  | { kind: 'empty' }
```

- [ ] **Step 2: Add invoke helpers**

Replace `readClipboardText` function (keep it for the public `readText()` API method) and add new helpers:

```typescript
async function readNativeClipboardContent(): Promise<NativeClipboardContent> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<NativeClipboardContent>('read_clipboard_content')
  } catch {
    // Fallback: read text via old path
    const text = await readClipboardText()
    if (text) return { kind: 'text', text }
    return { kind: 'empty' }
  }
}

async function readNativeChangeCount(): Promise<number | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<number | null>('clipboard_change_count')
  } catch {
    return null
  }
}
```

- [ ] **Step 3: Delete `extractFilePaths` function**

Remove the entire `extractFilePaths` function (lines 171–185 approximately):

```typescript
// DELETE THIS ENTIRE FUNCTION:
function extractFilePaths(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length === 0) return []
  const looksLikePath = (line: string) =>
    line.startsWith('/') ||
    line.startsWith('~/') ||
    /^[A-Za-z]:[\\/]/.test(line) ||
    line.startsWith('\\\\')

  return lines.every(looksLikePath) ? lines : []
}
```

- [ ] **Step 4: Rewrite the `watch` method's polling logic**

Replace the body of the `setInterval` callback inside the `watch` method with:

```typescript
const intervalId = setInterval(async () => {
  if (stopped || polling) return
  polling = true

  try {
    // Cheap check: has clipboard changed at all?
    const changeCount = await readNativeChangeCount()
    if (changeCount !== null && changeCount === lastChangeCount) return
    lastChangeCount = changeCount

    const content = await readNativeClipboardContent()

    switch (content.kind) {
      case 'files': {
        if (!options.files) break
        const pathsKey = content.paths.join('\n')
        const currentHash = hashString(`files:${pathsKey}`)
        if (currentHash === lastTextHash) break
        lastTextHash = currentHash
        const sourceApp = await readClipboardSourceApp()
        onChange({
          kind: 'files',
          paths: content.paths,
          fileNames: content.paths.map(fileNameForPath),
          hash: currentHash,
          changedAt: Date.now(),
          sourceApp,
        })
        break
      }

      case 'image': {
        if (!options.images || !storage) break
        const now = Date.now()
        if (now - lastImagePollAt < imagePollInterval) break
        lastImagePollAt = now
        const image = await readClipboardImageSnapshot()
        if (!image) break
        const imageHash = hashBytes(image.hashBytes)
        if (imageHash === lastImageHash) break
        const storedImage = await image.toStoredImage()
        if (options.maxImageBytes && storedImage.bytes.length > options.maxImageBytes) break
        const blobRef = await storage.blob.put({
          bytes: storedImage.bytes,
          contentType: storedImage.contentType,
        })
        const sourceApp = await readClipboardSourceApp()
        lastImageHash = imageHash
        onChange({
          kind: 'image',
          blobId: blobRef.blobId,
          previewBlobId: blobRef.blobId,
          contentType: blobRef.contentType,
          byteSize: blobRef.byteSize,
          width: storedImage.width,
          height: storedImage.height,
          hash: imageHash,
          changedAt: Date.now(),
          sourceApp,
        })
        break
      }

      case 'text': {
        if (options.text === false) break
        const byteSize = new TextEncoder().encode(content.text).length
        if (options.maxTextBytes && byteSize > options.maxTextBytes) break
        const currentHash = hashString(`text:${content.text}`)
        if (currentHash === lastTextHash) break
        lastTextHash = currentHash
        const sourceApp = await readClipboardSourceApp()
        onChange({
          kind: 'text',
          text: content.text,
          byteSize,
          hash: currentHash,
          changedAt: Date.now(),
          sourceApp,
        })
        break
      }

      case 'empty':
        break
    }
  } catch (error) {
    console.warn('[plugin-clipboard] watch poll error:', error)
  } finally {
    polling = false
  }
}, pollInterval)
```

- [ ] **Step 5: Add `lastChangeCount` state variable**

In the `watch` method, alongside existing state variables (`lastTextHash`, `lastImageHash`, etc.), add:

```typescript
let lastChangeCount: number | null = null
```

- [ ] **Step 6: Remove the old initialization block that reads text at watch start**

The old code that initialized `lastTextHash` by reading clipboard text can be removed — the `changeCount` gate handles the first-run case. Replace the initialization block with:

```typescript
// Initialize change count to skip the first poll (avoid double-fire on start)
try {
  lastChangeCount = await readNativeChangeCount()
  // Also seed text/image hashes from current content
  const initial = await readNativeClipboardContent()
  if (initial.kind === 'text') lastTextHash = hashString(`text:${initial.text}`)
  else if (initial.kind === 'files') lastTextHash = hashString(`files:${initial.paths.join('\n')}`)
  if (initial.kind !== 'image' && options.images && storage) {
    const img = await readClipboardImageSnapshot()
    if (img) lastImageHash = hashBytes(img.hashBytes)
  }
} catch {
  // Ignore initialization errors
}
```

- [ ] **Step 7: Update `writeFiles` method to use native command**

Replace:
```typescript
async writeFiles(paths: string[]): Promise<void> {
  requirePermissions(['clipboard.write', 'clipboard.files'])
  await writeClipboardText(paths.join('\n'))
}
```

With:
```typescript
async writeFiles(paths: string[]): Promise<void> {
  requirePermissions(['clipboard.write', 'clipboard.files'])
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('write_clipboard_files', { paths })
  } catch {
    // Fallback: write as newline-separated text
    await writeClipboardText(paths.join('\n'))
  }
}
```

- [ ] **Step 8: Build frontend**

```bash
npm run build
```
Expected: builds without TypeScript errors.

- [ ] **Step 9: Commit**

```bash
git add src/workspace/pluginClipboard.ts
git commit -m "feat(clipboard): rewrite watcher to use native content detection

- Remove extractFilePaths regex heuristic
- Use read_clipboard_content for unified type detection
- Use clipboard_change_count for cheap polling gate
- writeFiles now writes real file URLs via native command"
```

---

### Task 5: Cleanup — Remove unused `fileNameForPath` dependency on regex

**Files:**
- Modify: `src/workspace/pluginClipboard.ts`

The `fileNameForPath` function is still used (for extracting display names from native file paths). Verify it has no dependency on the deleted regex logic.

- [ ] **Step 1: Verify `fileNameForPath` is standalone**

Confirm it only does path splitting:

```typescript
function fileNameForPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  return normalized.split('/').filter(Boolean).pop() ?? path
}
```

This is fine as-is — it takes paths returned by the native command. No changes needed.

- [ ] **Step 2: Verify no other references to `extractFilePaths`**

```bash
grep -r "extractFilePaths" src/
```
Expected: zero results.

- [ ] **Step 3: Commit (if any cleanup was needed)**

If grep found stale references, fix and commit. Otherwise skip this step.

---

### Task 6: Verification — End-to-end testing

**Files:**
- No new files — manual verification

- [ ] **Step 1: Build the full app**

```bash
npm run build && cd src-tauri && cargo build
```
Expected: both frontend and Rust compile cleanly.

- [ ] **Step 2: Test Finder file copy detection**

1. Run the app
2. In Finder, select one or more files, press ⌘C
3. Observe clipboard history — should show entry with `kind: 'files'` and correct paths
4. Verify file names are extracted correctly

- [ ] **Step 3: Test text copy is NOT mistaken for files**

1. In Terminal, copy a text line like `/var/log/system.log`
2. Observe clipboard history — should show as `kind: 'text'`, NOT files

- [ ] **Step 4: Test image copy**

1. Take a screenshot (⌘⇧⌃4)
2. Observe clipboard history — should detect as `kind: 'image'`

- [ ] **Step 5: Test writeFiles round-trip**

1. Use a plugin command that calls `writeFiles(['/tmp/test.txt'])`
2. Switch to Finder, press ⌘V
3. Verify Finder pastes the file (not text)

- [ ] **Step 6: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(clipboard): adjustments from manual verification"
```
