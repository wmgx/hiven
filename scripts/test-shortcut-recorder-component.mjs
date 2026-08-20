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
  settingsSurfaceContent: read('src/surfaces/SettingsContent.tsx'),
  pluginsSurfaceContent: read('src/surfaces/PluginsContent.tsx'),
  css: read('src/index.css'),
}

assert.match(files.component, /export function ShortcutRecorder/, 'ShortcutRecorder should export a reusable React component')
assert.match(files.component, /allowDoubleModifier/, 'ShortcutRecorder should make double-modifier recording an explicit capability')
assert.match(files.component, /lastModifierTapRef/, 'ShortcutRecorder should detect consecutive modifier taps while recording')
assert.match(files.component, /onRecord/, 'ShortcutRecorder should report the recorded shortcut through a callback')
assert.match(files.component, /onClear/, 'ShortcutRecorder should support clearing from the same component')
assert.match(files.component, /formatAcceleratorLabel/, 'ShortcutRecorder should own platform-aware accelerator display')
assert.match(files.component, /doubleModifierLabel/, 'ShortcutRecorder should own platform-aware double-modifier display')

assert.match(files.settingsSurfaceContent, /<ShortcutRecorder[\s\S]*allowDoubleModifier/, 'SettingsSurfaceContent should use ShortcutRecorder for global launcher hotkeys')
assert.doesNotMatch(files.settingsSurfaceContent, /chooseDoubleModifier/, 'SettingsSurfaceContent should not render separate double-modifier choice buttons')
assert.doesNotMatch(files.settingsSurfaceContent, /onClick=\{\(\) => chooseDoubleModifier/, 'double-modifier shortcuts should be recorded instead of chosen')

assert.match(files.pluginsSurfaceContent, /<ShortcutRecorder/, 'PluginsManagerSurfaceContent should use ShortcutRecorder for plugin surface shortcuts')
assert.doesNotMatch(files.pluginsSurfaceContent, /<input[\s\S]{0,240}plugin-surface-shortcut-input/, 'plugin surface shortcuts should not use a manual text input')
assert.doesNotMatch(files.pluginsSurfaceContent, /shortcutDrafts/, 'plugin surface shortcut binding should not keep text-entry drafts')
assert.match(files.pluginsSurfaceContent, /grantPluginPermissions[\s\S]{0,320}setPluginSurfaceShortcut/, 'plugin surface recording should still grant global shortcut permission before binding')

assert.match(files.css, /shortcut-recorder/, 'shared shortcut recorder styles should exist')

console.log('shortcut recorder component checks passed')
