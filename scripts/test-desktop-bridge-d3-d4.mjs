#!/usr/bin/env node
/**
 * Contract tests for D3 Chromium tabs + D4 editor documents desktop bridge.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

// ── Files exist ──────────────────────────────────────────────────────────────
for (const path of [
  'src-tauri/src/desktop_bridge.rs',
  'src/workspace/desktopControl/bridgeTargets.ts',
  'src/plugins/browser-tabs/provider.ts',
  'src/workspace/desktopTargets/vscodeDocuments.ts',
  'src/workspace/desktopTargets/collectBridgeLauncherItems.ts',
  'src/workspace/desktopTargets/pluginApi.ts',
  'src/plugins/browser-tabs/extension/manifest.json',
  'src/plugins/browser-tabs/extension/background.js',
  'extensions/hiven-vscode-bridge/package.json',
  'extensions/hiven-vscode-bridge/extension.js',
]) {
  assert.ok(existsSync(join(root, path)), `${path} must exist`)
}

const rust = read('src-tauri/src/lib.rs')
const bridge = read('src-tauri/src/desktop_bridge.rs')
const vscode = read('src/workspace/desktopTargets/vscodeDocuments.ts')
const host = read('src/workspace/launcher/hostProvider.ts')
const types = read('src/workspace/launcher/types.ts')
const collect = read('src/workspace/desktopTargets/collectBridgeLauncherItems.ts')
const chromeExt = read('src/plugins/browser-tabs/extension/background.js')
const codeExt = read('extensions/hiven-vscode-bridge/extension.js')

// ── Native bridge ────────────────────────────────────────────────────────────
assert.match(rust, /mod desktop_bridge/)
assert.match(rust, /start_desktop_bridge_server/)
assert.match(rust, /desktop_bridge::list_desktop_bridge_targets/)
assert.match(rust, /desktop_bridge::focus_desktop_bridge_target/)
assert.match(rust, /desktop_bridge::desktop_bridge_status/)
assert.match(bridge, /DESKTOP_BRIDGE_PORT:\s*u16\s*=\s*19246/)
assert.match(bridge, /fn list_desktop_bridge_targets/)
assert.match(bridge, /fn focus_desktop_bridge_target/)
assert.match(bridge, /127\.0\.0\.1/)
assert.match(bridge, /Access-Control-Allow-Origin/)

// ── Providers ────────────────────────────────────────────────────────────────
// Chromium tabs live in first-party plugin browser-tabs (not host-registered).
const browserPlugin = read('src/plugins/browser-tabs/provider.ts')
assert.match(browserPlugin, /browser\.chromium/)
assert.match(browserPlugin, /if\s*\(!q\)\s*return\s*\[\]/, 'empty query must return 0 tabs')
assert.match(vscode, /editor\.vscode/)
assert.match(vscode, /if\s*\(!q\)\s*return\s*\[\]/, 'empty query must return 0 docs')
assert.doesNotMatch(host, /chromiumTabsProvider/, 'host must not register chromium provider directly')
assert.match(host, /registerDesktopTargetProvider\(vscodeDocumentsProvider\)/)
assert.match(host, /getDesktopBridgeLauncherDynamicItems/)
assert.match(collect, /browser\.chromium/)
assert.match(collect, /editor\./)

// ── Capabilities ─────────────────────────────────────────────────────────────
assert.match(types, /desktop-browser-tabs/)
assert.match(
  types,
  /'global-launcher'[\s\S]*desktop-browser-tabs/,
  'global-launcher must advertise desktop-browser-tabs',
)

// ── Extensions talk to bridge ────────────────────────────────────────────────
assert.match(chromeExt, /browser\.chromium/)
assert.match(chromeExt, /19246/)
assert.match(chromeExt, /chrome\.tabs/)
assert.match(codeExt, /editor\.vscode/)
assert.match(codeExt, /19246/)
assert.match(codeExt, /openTextDocument/)

// ── Process isolation still true ─────────────────────────────────────────────
assert.doesNotMatch(
  host,
  /getHostProcessLauncherDynamicItems/,
  'process terminate must not re-enter first-level dynamic path',
)

console.log('desktop bridge D3/D4 contract checks passed')
