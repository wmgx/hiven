#!/usr/bin/env node
/**
 * Contract tests for D3 Chromium tabs desktop bridge (D4 editor bridge removed).
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

for (const path of [
  'src-tauri/src/desktop_bridge.rs',
  'src/workspace/desktopControl/bridgeTargets.ts',
  'src/plugins/web-open/browserProvider.ts',
  'src/workspace/desktopTargets/collectBridgeLauncherItems.ts',
  'src/workspace/desktopTargets/pluginApi.ts',
  'src/plugins/web-open/extension/manifest.json',
  'src/plugins/web-open/extension/background.js',
]) {
  assert.ok(existsSync(join(root, path)), `${path} must exist`)
}

assert.ok(!existsSync(join(root, 'src/workspace/desktopTargets/vscodeDocuments.ts')), 'D4 vscodeDocuments must be removed')
assert.ok(!existsSync(join(root, 'extensions/hiven-vscode-bridge')), 'D4 hiven-vscode-bridge must be removed')

const rust = read('src-tauri/src/lib.rs')
const bridge = read('src-tauri/src/desktop_bridge.rs')
const browserPlugin = read('src/plugins/web-open/browserProvider.ts')
const host = read('src/workspace/launcher/hostProvider.ts')
const types = read('src/workspace/launcher/types.ts')
const collect = read('src/workspace/desktopTargets/collectBridgeLauncherItems.ts')
const chromeExt = read('src/plugins/web-open/extension/background.js')

assert.match(rust, /mod desktop_bridge/)
assert.match(rust, /start_desktop_bridge_server/)
assert.match(rust, /desktop_bridge::list_desktop_bridge_targets/)
assert.match(rust, /desktop_bridge::focus_desktop_bridge_target/)
assert.match(rust, /desktop_bridge::list_desktop_bridge_history/)
assert.match(rust, /desktop_bridge::list_desktop_bridge_events/)
assert.match(rust, /desktop_bridge::open_desktop_bridge_url/)
assert.match(rust, /desktop_bridge::set_desktop_bridge_source_config/)
assert.match(bridge, /DESKTOP_BRIDGE_PORT:\s*u16\s*=\s*19246/)
assert.match(bridge, /127\.0\.0\.1/)
assert.match(bridge, /strip_suffix\("\/history"\)/)
assert.match(bridge, /strip_suffix\("\/events"\)/)
assert.match(bridge, /tab\.opened/)
assert.match(bridge, /tab\.activated/)

assert.match(browserPlugin, /browser\.chromium/)
assert.match(browserPlugin, /if\s*\(!q\)\s*return\s*\[\]/, 'empty query must return 0 tabs')
assert.doesNotMatch(host, /vscodeDocumentsProvider|editor\.vscode/)
assert.match(host, /getDesktopBridgeLauncherDynamicItems/)
assert.match(collect, /browser\.chromium/)
assert.doesNotMatch(collect, /editor\.vscode|vscodeDocuments/)

assert.match(types, /desktop-browser-tabs/)
assert.match(chromeExt, /browser\.chromium/)
assert.match(chromeExt, /19246/)
assert.match(chromeExt, /chrome\.tabs/)
assert.match(chromeExt, /chrome\.history/)
assert.match(chromeExt, /tab\.opened/)
assert.match(chromeExt, /tab\.activated/)
assert.match(chromeExt, /autoCloseIdleTabs/)
assert.match(chromeExt, /closeIdleTabs/)

assert.doesNotMatch(
  host,
  /getHostProcessLauncherDynamicItems/,
  'process terminate must not re-enter first-level dynamic path',
)

console.log('desktop bridge D3 contract checks passed (D4 removed)')
