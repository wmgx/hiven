#!/usr/bin/env node
/**
 * History / page events / idle-close contract for browser-tabs + desktop bridge.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const root = process.cwd()
const read = (p) => readFileSync(join(root, p), 'utf8')

for (const path of [
  'src/plugins/web-open/extension/manifest.json',
  'src/plugins/web-open/extension/background.js',
  'src/plugins/web-open/browserTabsModel.ts',
  'src/plugins/web-open/browserProvider.ts',
  'src/workspace/desktopTargets/pluginApi.ts',
  'src/workspace/learning/navigationSensor.ts',
  'src/workspace/desktopTargets/collectBridgeLauncherItems.ts',
]) {
  assert.ok(existsSync(join(root, path)), `${path} must exist`)
}

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

const background = read('src/plugins/web-open/extension/background.js')
assert.match(background, /\/v1\/sources\/\$\{SOURCE_ID\}\/history/)
assert.match(background, /\/v1\/sources\/\$\{SOURCE_ID\}\/events/)
assert.match(background, /type:\s*'tab\.opened'|type === 'tab\.opened'|tab\.opened/)
assert.match(background, /tab\.activated/)
assert.match(background, /autoCloseIdleTabs/)
assert.doesNotMatch(background, /MAX_IDLE_TIMEOUT_MINUTES/)
assert.match(background, /MIN_IDLE_TIMEOUT_MINUTES/)
assert.match(background, /chrome\.tabs\.remove/)
assert.match(background, /tab\.pinned/)
assert.doesNotMatch(background, /from ['"]\.\.\/\.\.\/workspace\//)

const api = read('src/workspace/desktopTargets/pluginApi.ts')
assert.match(api, /listHistory:/)
assert.match(api, /listEvents:/)
assert.match(api, /openUrl:/)
assert.match(api, /setSourceConfig:/)

const sensor = read('src/workspace/learning/navigationSensor.ts')
assert.match(sensor, /listDesktopBridgeHistory/)
assert.match(sensor, /listDesktopBridgeEvents/)
assert.match(sensor, /tab\.opened/)
assert.match(sensor, /tab\.activated/)

const collect = read('src/workspace/desktopTargets/collectBridgeLauncherItems.ts')
assert.match(collect, /t\.kind === 'tab' \|\| t\.kind === 'document'/)

// Merged into web-open: the browser capability is applied from web-open's index,
// and the history/idle toggles live in the connection modal.
const pluginIndex = read('src/plugins/web-open/index.tsx')
assert.match(pluginIndex, /pushChromiumBridgeConfig/)
assert.match(pluginIndex, /applyBrowserCapability/)
const connectionModal = read('src/plugins/web-open/settings/BrowserTabsConnectionModal.tsx')
assert.match(connectionModal, /historyEnabled/)
assert.match(connectionModal, /autoCloseIdleTabs/)
assert.match(connectionModal, /IDLE_TIMEOUT_PRESET_MINUTES/)

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
assert.equal(defaults.autoCloseIdleTabs, false)
assert.equal(defaults.idleTimeoutMinutes, 60)
assert.equal(model.normalizeBrowserTabsSettings({ enabled: false }).enabled, false)
assert.equal(model.normalizeBrowserTabsSettings({ historyEnabled: false }).historyEnabled, false)
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
  'settings.historyToggle',
  'settings.idle',
  'settings.idleHelp',
  'settings.idleToggle',
  'settings.idleTimeout',
  'settings.idleTimeout.3d',
  'settings.idleTimeout.7d',
  'settings.footer',
  'settings.reloadHint',
]) {
  assert.ok(localesEn[key], `en locale missing ${key}`)
  assert.ok(localesZh[key], `zh locale missing ${key}`)
}

console.log('browser-tabs history/events/idle-close contract checks passed')
