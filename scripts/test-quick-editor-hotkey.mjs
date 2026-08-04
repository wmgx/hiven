#!/usr/bin/env node
/**
 * Quick Editor global hotkey: settings + registration + open path.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

const packageJson = JSON.parse(read('package.json'))
const store = read('src/store.ts')
const settings = read('src/surfaces/SettingsContent.tsx')
const i18n = read('src/i18n/locales/settings.ts')
const hotkeys = read('src/hotkeys/quickEditor.ts')
const app = read('src/App.tsx')
const requests = read('src/workspace/quickEditor/quickEditorRequests.ts')
const bridge = read('src/workspace/launcherHostSurfaceBridge.ts')

assert.equal(
  packageJson.scripts?.['test:quick-editor-hotkey'],
  'node scripts/test-quick-editor-hotkey.mjs',
  'package.json must expose test:quick-editor-hotkey',
)

assert.match(
  store,
  /quickEditorShortcut:\s*GlobalPinnedLauncherShortcut/,
  'settings must model quickEditorShortcut',
)
assert.match(
  store,
  /quickEditorShortcut:\s*\{\s*kind:\s*['"]disabled['"]\s*\}/,
  'quickEditorShortcut default must be disabled until user records one',
)
assert.match(
  store,
  /quickEditorShortcut:\s*stripShortcutRuntimeStatus/,
  'quickEditorShortcut runtime registration status must not be persisted raw without strip',
)

assert.match(settings, /quickEditorShortcut/, 'settings UI must bind quickEditorShortcut')
assert.match(
  settings,
  /t\(['"]quickEditorShortcut['"]\)/,
  'settings row must use i18n key for Quick Editor hotkey',
)
assert.match(
  settings,
  /updateSetting\(['"]quickEditorShortcut['"]/,
  'settings must write quickEditorShortcut on record/clear',
)

assert.match(i18n, /['"]quickEditorShortcut['"]\s*:\s*['"]Quick Editor['"]/, 'en i18n for quickEditorShortcut')
assert.match(i18n, /['"]quickEditorShortcut['"]\s*:\s*['"]快捷编辑器['"]/, 'zh i18n for quickEditorShortcut')
assert.match(i18n, /quickEditorShortcutInfo/, 'i18n must describe the Quick Editor hotkey')

assert.match(hotkeys, /export function installQuickEditorHotkeys/, 'hotkey installer must exist')
assert.match(hotkeys, /export async function routeQuickEditorShortcut/, 'hotkey route must be exportable')
assert.match(hotkeys, /showQuickEditorSurface/, 'hotkey must summon via showQuickEditorSurface')
assert.match(hotkeys, /settings\.quickEditorShortcut/, 'hotkey installer must read quickEditorShortcut')

assert.match(app, /installQuickEditorHotkeys/, 'App must install Quick Editor hotkeys')

assert.match(
  requests,
  /requestOpenLauncherHostSurface\(['"]quick-editor['"]\)/,
  'showQuickEditorSurface must open host surface through the launcher bridge (shows window)',
)
assert.match(
  bridge,
  /value === ['"]quick-editor['"]/,
  'launcher host surface bridge must accept quick-editor target',
)

console.log('quick-editor-hotkey: ok')
