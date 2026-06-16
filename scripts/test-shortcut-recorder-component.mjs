#!/usr/bin/env node

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

const componentPath = 'src/components/ShortcutRecorder.tsx'
assert.ok(existsSync(join(root, componentPath)), 'ShortcutRecorder component should be extracted for reusable recording UI')

const files = {
  component: read(componentPath),
  settingsView: read('src/views/SettingsView.tsx'),
  scriptsView: read('src/views/ScriptsView.tsx'),
  css: read('src/index.css'),
}

assert.match(files.component, /export function ShortcutRecorder/, 'ShortcutRecorder should export a reusable React component')
assert.match(files.component, /onRecord/, 'ShortcutRecorder should report the recorded shortcut through a callback')
assert.match(files.component, /onClear/, 'ShortcutRecorder should support clearing from the same component')
assert.match(files.component, /formatAcceleratorLabel/, 'ShortcutRecorder should own platform-aware accelerator display')

assert.match(files.settingsView, /<ShortcutRecorder/, 'SettingsView should use ShortcutRecorder for global launcher hotkeys')
assert.doesNotMatch(files.settingsView, /allowDoubleModifier/, 'SettingsView should not pass allowDoubleModifier after double support removal')
assert.doesNotMatch(files.settingsView, /chooseDoubleModifier/, 'SettingsView should not render separate double-modifier choice buttons')

assert.match(files.scriptsView, /<ShortcutRecorder/, 'ScriptsView should use ShortcutRecorder for plugin surface shortcuts')
assert.doesNotMatch(files.scriptsView, /<input[\s\S]{0,240}plugin-surface-shortcut-input/, 'plugin surface shortcuts should not use a manual text input')
assert.doesNotMatch(files.scriptsView, /shortcutDrafts/, 'plugin surface shortcut binding should not keep text-entry drafts')
assert.match(files.scriptsView, /grantPluginPermissions[\s\S]{0,320}setPluginSurfaceShortcut/, 'plugin surface recording should still grant global shortcut permission before binding')

assert.match(files.css, /shortcut-recorder/, 'shared shortcut recorder styles should exist')

console.log('shortcut recorder component checks passed')
