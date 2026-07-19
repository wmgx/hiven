#!/usr/bin/env node

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

const files = {
  app: read('src/App.tsx'),
  store: read('src/store.ts'),
  editorWindow: read('src/components/EditorWindow.tsx'),
  editorView: read('src/views/EditorView.tsx'),
  paneEditor: read('src/components/workspace/PaneEditor.tsx'),
  editorLocale: read('src/i18n/locales/editor.ts'),
  shortcutDisplay: read('src/hotkeys/shortcutDisplay.ts'),
}

const failures = []

function check(name, fn) {
  try {
    fn()
  } catch (error) {
    failures.push(`${name}: ${error.message}`)
  }
}

function assertHas(source, pattern, message) {
  assert.match(source, pattern, message)
}


check('Retired settings/plugins view wrappers are removed', () => {
  for (const viewPath of ['src/views/SettingsView.tsx', 'src/views/ScriptsView.tsx', 'src/views/PluginEditorView.tsx']) {
    assert.equal(existsSync(join(root, viewPath)), false, `${viewPath} should be removed after first-class surfaces replace main-window views`)
  }
})

check('Store no longer exposes the retired main-window ViewId model', () => {
  assert.doesNotMatch(
    files.store,
    /export\s+type\s+ViewId\b|\bactiveView\b|\bsetActiveView\b/,
    'ViewId/activeView/setActiveView should be retired after removing the main-window navigation shell',
  )
})

check('Store no longer keeps editor document or runtime instance state', () => {
  assert.doesNotMatch(
    files.store,
    /\beditorText\b|\bsetEditorText\b|\beditorInstance\b|\bsetEditorInstance\b/,
    'Editor text and Monaco instances must stay inside the editor window workspace/runtime registries, not AppState',
  )
  assert.doesNotMatch(
    read('src/workspace/workspaceStore.ts'),
    /\bmigrateLegacyEditorText\b|legacy editorText/,
    'Workspace store should not keep the retired app-store editorText migration path',
  )
  assert.match(
    read('src/workspace/workspaceStore.ts'),
    /createWorkspaceSessionStorage[\s\S]*isEditorWindowWorkspaceSession\(\)[\s\S]*window\.sessionStorage[\s\S]*workspaceRuntimeStorage/,
    'Workspace persistence must be editor-window session scoped and use runtime memory outside editor windows',
  )
  assert.doesNotMatch(
    read('src/workspace/workspaceStore.ts'),
    /isEditorWindowWorkspaceSession\(\)\s*\?\s*window\.sessionStorage\s*:\s*window\.localStorage/,
    'Launcher/background runtimes must not persist a shadow editor workspace in localStorage',
  )
})

check('App does not register Cmd/Ctrl+K for the in-app command palette', () => {
  assert.doesNotMatch(
    files.app,
    /\(e\.metaKey\s*\|\|\s*e\.ctrlKey\)[\s\S]{0,120}key\s*={2,3}\s*['"]k['"][\s\S]{0,260}setEditorCommandBarOpen\(true\)/,
    'App should not open EditorCommandBar from a hard-coded Cmd/Ctrl+K listener',
  )
})

check('Monaco editor does not register CtrlCmd+K for the command palette', () => {
  assert.doesNotMatch(
    files.paneEditor,
    /open-command-palette|2048\s*\|\s*41|CtrlCmd\s*\+\s*KeyK|Cmd\+K/,
    'PaneEditor should not install a local Monaco Cmd/Ctrl+K command palette action',
  )
})

check('Editor command bar is only hosted by the editor window surface', () => {
  assert.doesNotMatch(
    files.app,
    /<EditorCommandBar\s*\/>/,
    'Launcher runtime App must not render the editor command bar',
  )
  assertHas(
    files.editorWindow,
    /<EditorCommandBar\s*\/>/,
    'EditorWindow should own the editor command bar',
  )
})

check('Editor run action hint uses the configured global launcher shortcut', () => {
  assertHas(
    files.editorView,
    /settings\.globalPinnedLauncherShortcut/,
    'EditorView should read the configured global pinned launcher shortcut',
  )
  assertHas(
    files.editorView,
    /formatGlobalPinnedLauncherShortcutLabel/,
    'EditorView should format the run-action hint from the shortcut config',
  )
  assertHas(
    files.editorLocale,
    /runActionWithShortcut/,
    'editor locale should provide a shortcut-aware run action label',
  )
  assert.doesNotMatch(
    files.editorLocale,
    /⌘K|Cmd\+K|Ctrl\+K/,
    'editor run action locale should not hard-code Cmd/Ctrl+K',
  )
  assertHas(
    files.shortcutDisplay,
    /formatGlobalPinnedLauncherShortcutLabel/,
    'shortcut display helper should expose a reusable formatter',
  )
})

if (failures.length > 0) {
  console.error(`command palette page policy checks failed (${failures.length}):`)
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('command palette page policy checks passed')
