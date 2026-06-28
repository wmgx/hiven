# Hiven Refactor Final Validation

Source design: `/Users/bytedance/Downloads/hiven_refactor_design_2026-06-26 (1).md`.

This document is the final acceptance matrix for the workbench-window refactor. It separates proven automated evidence from the product smoke items that still require a human-operated macOS desktop check.

## Validation summary

Status: architecture and automated acceptance are green; manual product smoke is the only remaining evidence gap before claiming full product completion.

Automated gate used as the authoritative build/check proof:

```bash
npm run test:refactor-gate
```

The gate covers:

- `npm run test:refactor-suite`
- `npx tsc --noEmit --pretty false`
- `npm run check:architecture`
- `git diff --check`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `npm run build`

## Acceptance matrix

### Build / TypeScript / Rust / architecture

Requirement: the refactor must build cleanly and leave no TypeScript, architecture, whitespace, or Tauri Rust compile errors.

Automated evidence:

- `npm run test:refactor-gate`
- `npm run build`
- `npx tsc --noEmit --pretty false`
- `npm run check:architecture`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `git diff --check`

Current automated status: proven by the refactor gate.

### Launcher ↔ Editor Bridge

Requirement: launcher-to-editor communication must go through an explicit bridge rather than direct editor store mutation.

Implemented bridge API:

- `getEditorContext`
- `createEditorPane`
- `replaceEditorSelection`
- `insertIntoEditor`
- `openEditorPanel`
- `registerActiveEditorContext`
- `updateActivePaneSnapshot`

Automated evidence:

- `scripts/test-editor-bridge-behavior.mjs`
- `scripts/test-output-router-behavior.mjs`
- `scripts/test-output-router-text-targets.mjs`
- `scripts/test-workflow-context-routing-story.mjs`
- `scripts/test-refactor-final-acceptance.mjs`

Current automated status: proven for API shape, editor publication, output routing, and direct-store-mutation guardrails.

### SurfaceRegistry

Requirement: SurfaceRegistry must not be an isolated in-memory Map that makes launcher/window search unstable.

Implemented behavior:

- frontend registry hydrates from Rust-side state
- upsert/state/remove operations persist to Rust commands
- windows receive registry updates through Tauri events
- launcher/editor/plugin surfaces publish stable labels

Automated evidence:

- `scripts/test-surface-registry-behavior.mjs`
- `scripts/test-plugin-surface-window-lifecycle-behavior.mjs`
- `scripts/test-refactor-final-acceptance.mjs`

Current automated status: proven for Rust-backed state shape, sync commands, event propagation, and window lifecycle updates.

### GlobalLauncherHost split

Requirement: GlobalLauncherHost must not keep growing as one monolithic host.

Implemented extracted frames:

- `GlobalLauncherSearchFrame`
- `GlobalLauncherPluginSurfaceFrame`
- `GlobalLauncherSystemSurfaceFrame`
- `GlobalLauncherSettingsFrame`
- `GlobalLauncherResultFrame`

Automated evidence:

- `scripts/test-refactor-final-acceptance.mjs`
- `npm run check:architecture`

Current automated status: proven by file existence, import/usage checks, and architecture gate.

### Settings / Plugins / PluginEditor as surfaces

Requirement: Settings, Plugins, and PluginEditor must be real surfaces instead of retired main-window views.

Implemented surfaces:

- `SettingsSurface`
- `PluginsSurface`
- `PluginEditorSurface`

Automated evidence:

- `scripts/test-refactor-final-acceptance.mjs`
- `scripts/test-window-architecture-phases.mjs`
- `scripts/test-no-main-window-startup.mjs`

Current automated status: proven for surface wrappers and no-main-window routing.

### Editor independent window

Requirement: Editor must be an independent system surface, not a main-window view.

Automated evidence:

- `scripts/test-editor-window-launch.mjs`
- `scripts/test-context-snapshot-editor.mjs`
- `scripts/test-window-entry-runtime-smoke.mjs`
- `scripts/test-refactor-final-acceptance.mjs`

Current automated status: proven for entry routing, native window command, global launcher open-editor path, context snapshot, and PanelHostV2 retention.

### Plugin surface independent window lifecycle

Requirement: plugin surfaces must be able to run in independent windows without overwriting Global Launcher state.

Automated evidence:

- `scripts/test-plugin-surface-window.mjs`
- `scripts/test-plugin-surface-shortcut-window.mjs`
- `scripts/test-plugin-surface-shortcuts.mjs`
- `scripts/test-plugin-surface-window-lifecycle-behavior.mjs`
- `scripts/test-plugin-surface-shortcut-lifecycle-story.mjs`
- `scripts/test-window-entry-runtime-smoke.mjs`

Current automated status: proven for window labels, shortcut presentation routing, hide/destroy lifecycle, renderer reuse, and plugin-surface entry startup.

### Object → Action → Surface → Output Target

Requirement: Hiven must route from current objects to actions, then to editor/plugin surfaces or output targets.

Automated evidence:

- `scripts/test-workflow-object-model.mjs`
- `scripts/test-workflow-registry-behavior.mjs`
- `scripts/test-workflow-launcher-adapter-behavior.mjs`
- `scripts/test-global-launcher-workflow-tab-behavior.mjs`
- `scripts/test-current-context-work-objects-behavior.mjs`
- `scripts/test-workflow-json-clipboard-story.mjs`
- `scripts/test-workflow-translate-selection-story.mjs`
- `scripts/test-workflow-clipboard-history-story.mjs`
- `scripts/test-workflow-chat-reply-story.mjs`
- `scripts/test-workflow-context-routing-story.mjs`
- `scripts/test-workflow-json-panel-story.mjs`

Current automated status: proven for current context objects, clipboard/editor document objects, workflow action expansion, output routing, and editor/plugin surface handoff.

### Foreground paste / clipboard history

Requirement: short tasks such as clipboard history selection must be able to paste back to the foreground app with explicit fallback behavior.

Automated evidence:

- `scripts/test-plugin-paste-behavior.mjs`
- `scripts/test-clipboard-history-surface-paste-story.mjs`
- `scripts/test-output-router-behavior.mjs`
- `scripts/test-workflow-clipboard-history-story.mjs`

Current automated status: proven for text/image/files paste API behavior, `hide_launcher_window`, `simulate_paste`, Accessibility-permission fallback message, stale-selection prevention, and host close behavior.

### Runtime smoke

Requirement: launcher/editor/plugin-surface entries must start without obvious runtime failures.

Automated evidence:

- `scripts/test-tauri-debug-smoke.mjs`
- `scripts/test-window-entry-runtime-smoke.mjs`
- `scripts/test-launcher-web-smoke.mjs`

Current automated status: proven for debug-start failure signature scan and route module transformation.

## Observed debug smoke - 2026-06-29

Command run from `/Users/bytedance/flux_text`:

```bash
npm run tauri -- dev
```

Observed runtime evidence:

- Vite dev server reached `VITE v8.1.0 ready`.
- Tauri dev command reached `Running DevCommand`.
- Rust binary reached `Running target/debug/hiven`.
- macOS process check found `11858 target/debug/hiven`.
- System Events process check found `hiven windows=0` immediately after startup.
- `src-tauri/tauri.conf.json` contains only one initial window label: `launcher`, with `visible: false`; no `main` window is declared.

Interpretation:

- The debug app starts as a background/launcher runtime without opening a retired main window.
- The process remains alive after startup, which supports the tray/background runtime requirement.
- Attempted synthetic `Shift+Cmd+Space` via AppleScript did not make a launcher window observable in this non-interactive automation context; this does not disprove the feature, but it means the real global-shortcut/focus path still needs human desktop smoke validation.

## Manual debug smoke remaining

These are not marked as fully proven by automation because they depend on the real macOS foreground application, Accessibility permission state, global shortcut registration, focus behavior, and tray behavior.

Manual checklist before declaring full product acceptance:

1. external app selected text → global shortcut → Hiven shows the current selected-text object and relevant actions.
2. clipboard history item → Enter or double click → paste into the real foreground app with Accessibility permission granted.
3. plugin shortcut → opens or focuses the plugin surface independent window without replacing a Global Launcher embedded surface.
4. global launcher search `editor` → opens/focuses the Editor Window; Editor Cmd+K mutates the current selection only.
5. attach translator/json/clipboard surface → appears in Editor PanelHostV2.
6. close all visible windows → tray/background remains alive; global shortcut or reopen event can show the launcher again.
7. deny Accessibility permission → paste action leaves content copied and surfaces the explicit fallback message.

Manual status: pending human-operated debug smoke. Automated evidence is strong enough for CI/build confidence, but not enough to claim every product interaction has been manually accepted.

## Final claim rule

Do not mark the full refactor goal complete until both conditions are true:

1. `npm run test:refactor-gate` passes on the current worktree.
2. The manual debug smoke checklist above is executed on macOS and any failures are fixed or explicitly accepted.
