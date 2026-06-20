#!/usr/bin/env node

/**
 * Plugin settings global launcher contract
 *
 * Plugin settings opened from the standalone global launcher render inline
 * inside the launcher shell. Escape closes that settings content, not the
 * launcher controller frame stack or the whole launcher.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

const settingsDialog = read('src/components/PluginSettingsDialog.tsx')
const globalLauncher = read('src/components/GlobalLauncher.tsx')
const registry = read('src/workspace/launcher/registry.ts')
const settingsStore = read('src/workspace/pluginSettingsStore.ts')

assert.ok(
  /presentation\??:\s*['"]dialog['"]\s*\|\s*['"]global-launcher['"]/.test(settingsStore),
  'plugin settings targets should record whether they render as a dialog or inside the global launcher',
)

assert.ok(
  /ctx\.surfaceId\s*===\s*['"]global-launcher['"][\s\S]{0,260}presentation:\s*['"]global-launcher['"]/.test(registry),
  'global launcher plugin settings actions should request inline global-launcher presentation',
)

assert.ok(
  /ctx\.surfaceId\s*!==\s*['"]global-launcher['"][\s\S]{0,260}presentation:\s*['"]dialog['"]|ctx\.surfaceId\s*===\s*['"]global-launcher['"][\s\S]{0,260}return\s+\{\s*ok:\s*true,\s*keepOpen:\s*true\s*\}[\s\S]{0,260}presentation:\s*['"]dialog['"]|presentation:\s*ctx\.surfaceId\s*===\s*['"]global-launcher['"]\s*\?\s*['"]global-launcher['"]\s*:\s*['"]dialog['"]/.test(registry),
  'non-global plugin settings actions should keep dialog presentation',
)

assert.ok(
  /target\.presentation\s*===\s*['"]global-launcher['"][\s\S]{0,260}return\s+null/.test(settingsDialog),
  'PluginSettingsDialog should not render its fixed modal for global launcher inline settings',
)

assert.ok(
  /className=["'][^"']*fixed\s+inset-0/.test(settingsDialog),
  'PluginSettingsDialog should keep the fixed inset modal shell for non-global launcher settings targets',
)

assert.ok(
  /export\s+function\s+(?:PluginSettingsContent|SettingsDialogContent|SettingsInlineContent)/.test(settingsDialog),
  'PluginSettingsDialog should expose reusable settings content for inline launcher rendering',
)

assert.ok(
  /PluginSettingsContent|SettingsDialogContent/.test(globalLauncher),
  'GlobalLauncher should render the shared plugin settings content inline',
)

assert.ok(
  /global-launcher-settings-shell/.test(globalLauncher),
  'GlobalLauncher should wrap inline settings in a dedicated shell so size is not clipped by the result list',
)

assert.ok(
  /(?:event|e)\.key\s*===\s*['"]Escape['"][\s\S]{0,260}(?:launcherSettingsTarget|settingsDialogTarget)[\s\S]{0,260}closeSettingsDialog\(\)[\s\S]{0,160}return/.test(globalLauncher),
  'GlobalLauncher host Escape should close inline plugin settings directly',
)

const inlineEscapeIndex = globalLauncher.search(/(?:event|e)\.key\s*===\s*['"]Escape['"][\s\S]{0,260}(?:launcherSettingsTarget|settingsDialogTarget)[\s\S]{0,260}closeSettingsDialog\(\)/)
const nextControllerBackIndex = inlineEscapeIndex >= 0 ? globalLauncher.indexOf('controllerRef.current?.back()', inlineEscapeIndex) : -1
const nextLeaveSurfaceIndex = inlineEscapeIndex >= 0 ? globalLauncher.indexOf('leaveSurface()', inlineEscapeIndex) : -1

assert.ok(inlineEscapeIndex >= 0, 'GlobalLauncher should have an Escape close branch for inline settings')
if (nextControllerBackIndex >= 0) {
  assert.ok(
    nextControllerBackIndex - inlineEscapeIndex > 160,
    'inline settings Escape branch should return before controller.back can run',
  )
}
if (nextLeaveSurfaceIndex >= 0) {
  assert.ok(
    nextLeaveSurfaceIndex - inlineEscapeIndex > 160,
    'inline settings Escape branch should return before leaveSurface can run',
  )
}

console.log('plugin settings global launcher checks passed')
