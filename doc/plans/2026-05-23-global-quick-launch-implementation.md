# Global Quick Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build the stage-1 quick launch experience: global shortcut opens FluxText, loads clipboard text into an isolated Quick Tab, opens Command Palette, runs existing Actions, and copies results back to the clipboard.

**Architecture:** Keep the current `ActionDef` runtime and Command Palette execution model. Add a Tauri global launch event, a foreground Quick Tab model that is compatible with existing `editorText` callers, and a small compatible `ActionResult` expansion for result side effects.

**Tech Stack:** React 19, TypeScript, Zustand, Monaco Editor, Tauri v2, `@tauri-apps/plugin-global-shortcut`, `@tauri-apps/plugin-clipboard-manager`.

---

## Scope

This plan implements stage 1 only.

Included:

- Global shortcut based quick launch.
- Background resident window with hide/show behavior.
- Quick Tab isolation for clipboard input.
- Command Palette auto open on global launch.
- Existing Action execution against Quick Tab.
- Result auto-copy.
- Minimal settings for quick launch behavior.

Excluded:

- `CommandDef` abstraction.
- Workflow engine.
- Plugin marketplace.
- Custom plugin UI views.
- Shell command execution.
- Clipboard history.
- Full multi-tab UI.

## File Structure

Modify:

- `package.json`: add global shortcut plugin package.
- `src-tauri/Cargo.toml`: add Rust global shortcut plugin.
- `src-tauri/src/lib.rs`: register global shortcut, show/focus window, emit frontend event, hide instead of exit where needed.
- `src-tauri/capabilities/default.json`: add global shortcut permission.
- `src-tauri/tauri.conf.json`: optional window visibility/focus tweaks if needed.
- `src/store.ts`: add `EditorTab`, `LaunchMode`, Quick Tab state, compatible `editorText` access, `ActionResult`.
- `src/fluxtext.d.ts`: expose compatible `ActionResult`.
- `src/App.tsx`: listen for Tauri global launch event, read clipboard, open Quick Tab, open Command Palette.
- `src/components/CommandPalette.tsx`: normalize `ActionResult`, write result to active tab, copy output, optionally hide window.
- `src/views/EditorView.tsx`: continue using `editorText` compatibility; optionally show Quick Tab indicator.
- `src/views/SettingsView.tsx`: add quick launch settings if the existing settings UI has an appropriate section.
- `src/i18n.ts`: add labels for any visible settings or Quick Tab indicator.

Create:

- `src/utils/actionResult.ts`: normalize legacy and expanded Action return values.

Verification:

- `npm run lint`
- `npm run build`
- `npm run tauri dev` manual smoke test on macOS.

## Task 1: Add Global Shortcut Dependencies

**Files:**

- Modify: `package.json`
- Modify: `src-tauri/Cargo.toml`

- [x] **Step 1: Add JS plugin dependency**

Run:

```bash
npm install @tauri-apps/plugin-global-shortcut
```

Expected:

- `package.json` contains `@tauri-apps/plugin-global-shortcut`.
- lockfile is updated if the repo has one.

- [x] **Step 2: Add Rust plugin dependency**

Run:

```bash
cd src-tauri
cargo add tauri-plugin-global-shortcut
```

Expected:

- `src-tauri/Cargo.toml` contains `tauri-plugin-global-shortcut`.
- `src-tauri/Cargo.lock` is updated.

- [x] **Step 3: Verify dependency resolution**

Run:

```bash
npm run build
```

Expected:

- Vite build completes.
- Any dependency conflict is resolved before continuing.

## Task 2: Register Global Shortcut and Emit Launch Event

**Files:**

- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`

- [x] **Step 1: Add plugin and launch event in Rust**

In `src-tauri/src/lib.rs`, add the global shortcut plugin in the Tauri builder. Use a default shortcut such as `CmdOrCtrl+Shift+Space`.

Implementation shape:

```rust
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
```

Inside `.setup(|app| { ... })`, after menu setup:

```rust
let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
let app_handle = app.handle().clone();

app.global_shortcut()
    .on_shortcut(shortcut, move |_app, _shortcut, event| {
        if event.state() != ShortcutState::Pressed {
            return;
        }
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
            let _ = window.emit("fluxtext://global-launch", ());
        }
    })
    .map_err(|e| e.to_string())?;
```

Also add:

```rust
.plugin(tauri_plugin_global_shortcut::Builder::new().build())
```

The exact API may differ slightly by plugin version. If compilation fails, inspect the installed plugin docs/types and keep the behavior the same: register shortcut, show/focus main window, emit `fluxtext://global-launch`.

- [x] **Step 2: Add capability permission**

In `src-tauri/capabilities/default.json`, add the global shortcut permission required by the installed plugin. Expected shape:

```json
"global-shortcut:default"
```

If the plugin exposes a more specific permission in generated errors, use that exact permission.

- [x] **Step 3: Compile Tauri side**

Run:

```bash
npm run tauri dev
```

Expected:

- App starts.
- No missing permission error for global shortcut.
- Pressing `Ctrl+Shift+Space` or platform equivalent shows/focuses the app.

## Task 3: Add Quick Tab State With Backward Compatibility

**Files:**

- Modify: `src/store.ts`

- [x] **Step 1: Add types**

Add near existing state types:

```ts
export type LaunchMode = 'full' | 'quick'

export interface EditorTab {
  id: string
  title: string
  text: string
  kind: 'normal' | 'quick'
  dirty: boolean
  createdAt: number
  updatedAt: number
}
```

- [x] **Step 2: Add AppState fields**

Add to `AppState`:

```ts
tabs: EditorTab[]
activeTabId: string
launchMode: LaunchMode
setLaunchMode: (mode: LaunchMode) => void
setActiveTab: (id: string) => void
updateActiveTabText: (text: string) => void
openQuickTabFromClipboard: (text: string) => void
keepQuickTab: () => void
```

- [x] **Step 3: Initialize tabs**

In the Zustand initial state, replace direct single-editor initialization with a normal tab while keeping `editorText` and `setEditorText` available:

```ts
tabs: [{
  id: 'main',
  title: 'Untitled',
  text: '',
  kind: 'normal',
  dirty: false,
  createdAt: Date.now(),
  updatedAt: Date.now(),
}],
activeTabId: 'main',
launchMode: 'full',
```

- [x] **Step 4: Keep `editorText` compatibility**

Keep the public `editorText` field for current selectors, but update it together with active tab for stage 1 compatibility:

```ts
editorText: '',
setEditorText: (text) => set((state) => ({
  editorText: text,
  tabs: state.tabs.map((tab) =>
    tab.id === state.activeTabId
      ? { ...tab, text, dirty: true, updatedAt: Date.now() }
      : tab
  ),
})),
```

When switching tabs or opening Quick Tab, also set `editorText` to the active tab text. This avoids changing all existing selectors in this phase.

- [x] **Step 5: Implement Quick Tab helpers**

Add:

```ts
setLaunchMode: (mode) => set({ launchMode: mode }),
setActiveTab: (id) => set((state) => {
  const tab = state.tabs.find((t) => t.id === id)
  if (!tab) return {}
  return { activeTabId: id, editorText: tab.text }
}),
updateActiveTabText: (text) => set((state) => ({
  editorText: text,
  tabs: state.tabs.map((tab) =>
    tab.id === state.activeTabId
      ? { ...tab, text, dirty: true, updatedAt: Date.now() }
      : tab
  ),
})),
openQuickTabFromClipboard: (text) => set((state) => {
  const now = Date.now()
  const quick: EditorTab = {
    id: 'quick',
    title: 'Quick',
    text,
    kind: 'quick',
    dirty: false,
    createdAt: now,
    updatedAt: now,
  }
  const hasQuick = state.tabs.some((tab) => tab.id === 'quick')
  return {
    tabs: hasQuick
      ? state.tabs.map((tab) => tab.id === 'quick' ? quick : tab)
      : [...state.tabs, quick],
    activeTabId: 'quick',
    editorText: text,
    launchMode: 'quick',
    activeView: 'editor',
  }
}),
keepQuickTab: () => set((state) => ({
  tabs: state.tabs.map((tab) =>
    tab.id === 'quick'
      ? { ...tab, id: `tab-${Date.now().toString(36)}`, title: 'Quick Saved', kind: 'normal', dirty: true }
      : tab
  ),
})),
```

- [x] **Step 6: Verify build**

Run:

```bash
npm run build
```

Expected:

- TypeScript build succeeds.
- Existing editor still displays and updates text.

## Task 4: Frontend Global Launch Handler

**Files:**

- Modify: `src/App.tsx`

- [x] **Step 1: Listen for launch event**

Add an effect that only runs in Tauri:

```ts
useEffect(() => {
  if (!(window as any).__TAURI_INTERNALS__) return

  let unlisten: (() => void) | undefined

  async function setup() {
    const { listen } = await import('@tauri-apps/api/event')
    const { readText } = await import('@tauri-apps/plugin-clipboard-manager')
    unlisten = await listen('fluxtext://global-launch', async () => {
      const text = (await readText()) ?? ''
      const store = useAppStore.getState()
      store.openQuickTabFromClipboard(text)
      store.setCommandPaletteOpen(true)
    })
  }

  setup().catch((e) => console.error('[FluxText] Failed to listen global launch:', e))
  return () => { unlisten?.() }
}, [])
```

- [x] **Step 2: Preserve existing app-local shortcut**

Keep current `Cmd/Ctrl+K` behavior as application-local Command Palette shortcut. It should not read clipboard or open Quick Tab.

- [x] **Step 3: Manual smoke test**

Run:

```bash
npm run tauri dev
```

Expected:

- Copy text in another app.
- Press global shortcut.
- FluxText appears.
- Editor content changes to copied text in Quick mode.
- Command Palette opens.

## Task 5: Add ActionResult Normalization

**Files:**

- Create: `src/utils/actionResult.ts`
- Modify: `src/store.ts`
- Modify: `src/fluxtext.d.ts`

- [x] **Step 1: Add `ActionResult` type**

In `src/store.ts`:

```ts
export interface ActionResult {
  text?: string
  copyToClipboard?: boolean
  openUrl?: string
  notification?: string
}
```

Update `ActionDef.run`:

```ts
run: (ctx: ActionContext) => ActionResult | Promise<ActionResult> | void
```

- [x] **Step 2: Add SDK declaration**

In `src/fluxtext.d.ts`:

```ts
export interface ActionResult {
  text?: string
  copyToClipboard?: boolean
  openUrl?: string
  notification?: string
}
```

No existing script needs changes.

- [x] **Step 3: Create normalizer**

Create `src/utils/actionResult.ts`:

```ts
import type { ActionResult } from '../store'

export function normalizeActionResult(result: ActionResult | void): ActionResult {
  if (!result) return {}
  return result
}

export function isSafeOpenUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol)
  } catch {
    return false
  }
}
```

- [x] **Step 4: Verify build**

Run:

```bash
npm run build
```

Expected:

- Existing built-in scripts still type-check through app build.

## Task 6: Copy Action Output and Handle Result Side Effects

**Files:**

- Modify: `src/components/CommandPalette.tsx`

- [x] **Step 1: Import helpers**

Add:

```ts
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { open as openUrl } from '@tauri-apps/plugin-shell'
import { normalizeActionResult, isSafeOpenUrl } from '../utils/actionResult'
```

If `@tauri-apps/plugin-shell` exports a different function name in this project version, use the actual export that opens URLs.

- [x] **Step 2: Update async result handling**

In `runAction`, route both sync and async return values through one handler:

```ts
async function handleActionResult(raw: any) {
  const normalized = normalizeActionResult(raw)
  if (normalized.text !== undefined) {
    applyResult(normalized.text)
    const shouldCopy = useAppStore.getState().settings.autoCopyOutput || normalized.copyToClipboard
    if (shouldCopy) {
      await writeText(normalized.text)
    }
  }
  if (normalized.openUrl) {
    if (isSafeOpenUrl(normalized.openUrl)) {
      await openUrl(normalized.openUrl)
    } else {
      setLastResult(`Error: Unsafe URL scheme: ${normalized.openUrl}`)
      setLastActionName(action.name)
    }
  }
}
```

Use this handler for promise and non-promise results.

- [x] **Step 3: Preserve selected text behavior**

Keep the current behavior:

- If Monaco has a selection, replace only the selection.
- Otherwise replace active tab text.

Because `setEditorText` now updates the active tab, no extra write path is needed.

- [x] **Step 4: Manual smoke test**

Run:

```bash
npm run tauri dev
```

Expected:

- Copy JSON text.
- Global launch.
- Run JSON Formatter.
- Output appears in Quick Tab.
- Output is copied to clipboard when `autoCopyOutput` is enabled.

## Task 7: Add Minimal Quick Launch Settings

**Files:**

- Modify: `src/store.ts`
- Modify: `src/views/SettingsView.tsx`
- Modify: `src/i18n.ts`

- [x] **Step 1: Add settings fields**

In `store.ts` settings:

```ts
globalShortcut: string
openCommandPaletteOnGlobalLaunch: boolean
useClipboardOnGlobalLaunch: boolean
hideAfterQuickAction: boolean
quickTabBehavior: 'reuse' | 'new'
```

Default values:

```ts
globalShortcut: 'CmdOrCtrl+Shift+Space',
openCommandPaletteOnGlobalLaunch: true,
useClipboardOnGlobalLaunch: true,
hideAfterQuickAction: false,
quickTabBehavior: 'reuse',
```

Keep `autoCopyOutput` default aligned with current project intent. For global quick launch, recommended default is `true`.

- [x] **Step 2: Respect settings in App**

In the global launch listener:

```ts
const store = useAppStore.getState()
const text = store.settings.useClipboardOnGlobalLaunch ? ((await readText()) ?? '') : ''
store.openQuickTabFromClipboard(text)
if (store.settings.openCommandPaletteOnGlobalLaunch) {
  store.setCommandPaletteOpen(true)
}
```

- [x] **Step 3: Add Settings UI**

In `SettingsView.tsx`, add a compact section:

```text
Quick Launch
- Use clipboard on global launch
- Open Command Palette on global launch
- Auto copy output
- Hide after quick action
```

Use the existing settings UI style and `updateSetting`.

- [x] **Step 4: Add i18n labels**

Add English and Chinese strings in `src/i18n.ts` for visible labels.

- [x] **Step 5: Verify settings persistence**

Run:

```bash
npm run tauri dev
```

Expected:

- Toggle settings.
- Restart app.
- Settings persist via Zustand persist middleware.

## Task 8: Optional Quick Tab Indicator

**Files:**

- Modify: `src/views/EditorView.tsx`

- [x] **Step 1: Show current mode**

Add a small status bar label when `launchMode === 'quick'`:

```tsx
{launchMode === 'quick' && (
  <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-tertiary)' }}>
    Quick
  </span>
)}
```

- [x] **Step 2: Add keep action if cheap**

If the status bar has room, add a small `Keep` text button calling `keepQuickTab()`. If it complicates layout, skip this for P0.

- [x] **Step 3: Verify no layout regression**

Run:

```bash
npm run build
```

Expected:

- Build passes.
- Status bar text does not overflow at the minimum window width.

## Task 9: Hide Window After Quick Action

**Files:**

- Modify: `src/components/CommandPalette.tsx`

- [x] **Step 1: Hide only when configured**

After `handleActionResult` completes successfully:

```ts
const state = useAppStore.getState()
if (state.launchMode === 'quick' && state.settings.hideAfterQuickAction && (window as any).__TAURI_INTERNALS__) {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().hide()
}
```

- [x] **Step 2: Preserve error visibility**

Do not hide the window if action execution throws or dependency loading fails. The user needs to see the error.

- [x] **Step 3: Manual smoke test**

Run:

```bash
npm run tauri dev
```

Expected:

- With `hideAfterQuickAction = true`, successful quick action hides window.
- Failed action keeps window visible and shows error in existing result area.

## Task 10: Final Verification

**Files:**

- No code changes unless verification finds defects.

- [x] **Step 1: Lint**

Run:

```bash
npm run lint
```

Expected:

- PASS, or only pre-existing unrelated warnings documented.

- [x] **Step 2: Build**

Run:

```bash
npm run build
```

Expected:

- PASS.

- [x] **Step 3: Tauri dev smoke test**

Run:

```bash
npm run tauri dev
```

Manual checks:

- Normal app launch keeps existing editor behavior.
- App-local `Cmd/Ctrl+K` opens Command Palette without reading clipboard.
- Global shortcut shows/focuses app.
- Global launch reads clipboard into Quick Tab.
- JSON Formatter works on Quick Tab text.
- Selection replacement still works in full mode.
- Result copies to clipboard when enabled.
- Main editor content is not overwritten by Quick Tab launch.

- [x] **Step 4: Check git status**

Run:

```bash
git status --short
```

Expected:

- Only planned source, lockfile, and doc changes are present.
- No runtime caches, build output, local logs, or system files are staged.

## Implementation Notes

### Compatibility Rule

Do not require existing scripts to change. Existing scripts returning `{ text: string }` must keep working.

### Security Rule

Do not add shell execution in stage 1. URL opening must use a scheme allowlist.

### UX Rule

Global launch must not overwrite normal editor content. Clipboard text goes into Quick Tab only.

### Migration Rule

Keep `editorText` and `setEditorText` in `store.ts` until all current callers are migrated to tab-specific selectors.

## Acceptance Criteria

The feature is accepted when:

- A user can copy text in another app, press the global shortcut, run an existing FluxText Action, and paste the transformed result back into the original app.
- The flow works without damaging the normal editor content.
- Existing built-in and custom text Actions still work.
- `npm run lint` and `npm run build` pass.
- Manual Tauri smoke test passes on the primary development platform.
