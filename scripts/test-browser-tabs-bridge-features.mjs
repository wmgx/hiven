#!/usr/bin/env node
/**
 * History / page events / idle-close contract for browser-tabs + desktop bridge.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const root = process.cwd()
const read = (p) => readFileSync(join(root, p), 'utf8')

const manifest = JSON.parse(read('src/plugins/web-open/extension/manifest.json'))
assert.ok(manifest.permissions.includes('history'), 'extension must request history')
assert.ok(manifest.permissions.includes('storage'), 'extension must persist idle/history config')
assert.ok(manifest.permissions.includes('tabs'))
// Floor, not an exact minor: the extension version rises whenever its behavior
// changes (0.3.0 added per-visit timestamps), so pinning one minor guarantees a
// false failure on the next legitimate bump.
{
  const [major, minor] = manifest.version.split('.').map(Number)
  assert.ok(
    major > 0 || minor >= 2,
    `extension version must be >= 0.2 , got ${manifest.version}`,
  )
}

function loadTs(path) {
  const src = readFileSync(path, 'utf8').replace(/import\s+type\s*\{[\s\S]*?\}\s*from\s*'[^']*'\s*;?\s*\n?/g, '')
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
  }).outputText
  const moduleExports = {}
  vm.runInNewContext(out, { exports: moduleExports, module: { exports: moduleExports } })
  return moduleExports
}

const model = loadTs(join(root, 'src/plugins/web-open/browserTabsModel.ts'))
const defaults = model.normalizeBrowserTabsSettings(undefined)
assert.equal(defaults.enabled, true)
assert.equal(defaults.historyEnabled, true)
assert.equal(defaults.historySearchDays, 5)
assert.equal(defaults.autoCloseIdleTabs, false)
assert.equal(defaults.idleTimeoutMinutes, 60)
assert.equal(model.normalizeBrowserTabsSettings({ enabled: false }).enabled, false)
assert.equal(model.normalizeBrowserTabsSettings({ historyEnabled: false }).historyEnabled, false)
assert.equal(model.normalizeBrowserTabsSettings({ historySearchDays: 30 }).historySearchDays, 30)
assert.equal(model.normalizeBrowserTabsSettings({ historySearchDays: 'all' }).historySearchDays, 'all')
assert.equal(model.normalizeBrowserTabsSettings({ historySearchDays: 10 }).historySearchDays, 5)
assert.deepEqual([...model.HISTORY_SEARCH_DAY_OPTIONS], [3, 5, 7, 30, 60, 90, 365, 'all'])
assert.equal(model.normalizeBrowserTabsSettings({ autoCloseIdleTabs: true }).autoCloseIdleTabs, true)
assert.equal(model.clampIdleTimeoutMinutes(1), 5)
assert.equal(model.clampIdleTimeoutMinutes(99999), 99999)
assert.equal(model.clampIdleTimeoutMinutes(45), 45)
assert.equal(model.clampIdleTimeoutMinutes(3 * 24 * 60), 3 * 24 * 60)
assert.equal(model.clampIdleTimeoutMinutes(7 * 24 * 60), 7 * 24 * 60)
assert.equal(model.MAX_IDLE_TIMEOUT_MINUTES, undefined)
assert.deepEqual([...model.IDLE_TIMEOUT_PRESET_MINUTES], [15, 30, 60, 360, 720, 1440, 4320, 10080])
assert.equal(model.idleTimeoutPresetKey(4320), '3d')
assert.equal(model.idleTimeoutPresetKey(10080), '7d')

const localesEn = JSON.parse(read('src/plugins/web-open/locales/en.json'))
const localesZh = JSON.parse(read('src/plugins/web-open/locales/zh.json'))
for (const key of [
  'settings.history',
  'settings.historyHelp',
  'settings.historySearchRange',
  'settings.historySearchRange.days',
  'settings.historySearchRange.all',
  'settings.idle',
  'settings.idleHelp',
  'settings.idleTimeout',
  'settings.idleTimeout.3d',
  'settings.idleTimeout.7d',
]) {
  assert.ok(localesEn[key], `en locale missing ${key}`)
  assert.ok(localesZh[key], `zh locale missing ${key}`)
}

console.log('browser-tabs history/events/idle-close contract checks passed')
