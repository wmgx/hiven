#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

const files = {
  app: read('src/App.tsx'),
  store: read('src/store.ts'),
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

const editorOnlyCommandPaletteRender =
  /activeView\s*={2,3}\s*['"]editor['"][\s\S]{0,220}<CommandPalette\s*\/>|<CommandPalette\s*\/>[\s\S]{0,220}activeView\s*={2,3}\s*['"]editor['"]/

check('ViewId includes the plugin editor and pinned runner pages under test', () => {
  assertHas(
    files.store,
    /export\s+type\s+ViewId\s*=[^\n]*['"]plugin-editor['"][^\n]*['"]pinned-runner['"]/,
    'ViewId should include plugin-editor and pinned-runner so this policy test covers both non-editor pages',
  )
})

check('App does not register Cmd/Ctrl+K for the in-app command palette', () => {
  assert.doesNotMatch(
    files.app,
    /\(e\.metaKey\s*\|\|\s*e\.ctrlKey\)[\s\S]{0,120}key\s*={2,3}\s*['"]k['"][\s\S]{0,260}setCommandPaletteOpen\(true\)/,
    'App should not open CommandPalette from a hard-coded Cmd/Ctrl+K listener',
  )
})

check('Monaco editor does not register CtrlCmd+K for the command palette', () => {
  assert.doesNotMatch(
    files.paneEditor,
    /open-command-palette|2048\s*\|\s*41|CtrlCmd\s*\+\s*KeyK|Cmd\+K/,
    'PaneEditor should not install a local Monaco Cmd/Ctrl+K command palette action',
  )
})

check('CommandPalette is only rendered while the editor page is active', () => {
  assert.ok(
    editorOnlyCommandPaletteRender.test(files.app),
    'CommandPalette is rendered outside an activeView === "editor" condition, so a non-editor page can still display it when commandPaletteOpen becomes true',
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
