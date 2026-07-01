#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

const packageJson = JSON.parse(read('package.json'))
const lifecycle = read('src/components/launcher/GlobalLauncherWindowLifecycle.ts')
const quickEditorPanel = read('src/components/quickEditor/QuickEditorPanel.tsx')
const globalLauncherHost = read('src/launcher/hosts/GlobalLauncherHost.tsx')
const store = read('src/store.ts')

assert.equal(
  packageJson.scripts?.['test:quick-editor-launcher-behavior'],
  'node scripts/test-quick-editor-launcher-behavior.mjs',
  'package.json must expose the Quick Editor launcher behavior contract',
)

assert.match(
  globalLauncherHost,
  /closeOnBlur:\s*mode\s*===\s*['"]quick-editor['"]\s*\?\s*false\s*:/,
  'Quick Editor mode must opt out of standalone launcher close-on-blur',
)

assert.match(
  lifecycle,
  /closeOnBlurRef\s*=\s*useRef\(closeOnBlur\)/,
  'standalone launcher focus listener should keep the latest closeOnBlur value in a ref',
)

assert.match(
  lifecycle,
  /closeOnBlurRef\.current\s*=\s*closeOnBlur/,
  'standalone launcher focus listener should refresh the closeOnBlur ref when mode changes',
)

assert.match(
  lifecycle,
  /!\s*focused\s*&&\s*closeOnBlurRef\.current\s*!==\s*false[\s\S]*closeLauncher\(\)/,
  'standalone launcher focus listener should read closeOnBlur from the ref inside the native callback',
)

assert.doesNotMatch(
  lifecycle,
  /onCurrentLauncherWindowFocusChanged\(\(focused\)\s*=>\s*\{[\s\S]*closeOnBlur\s*!==\s*false[\s\S]*\}\)/,
  'native focus listener must not close over a stale closeOnBlur value directly',
)

assert.match(
  quickEditorPanel,
  /onKeyDownCapture=\{handleKeyDownCapture\}/,
  'Quick Editor should capture shell shortcuts before Monaco or the browser can consume them',
)

assert.match(
  quickEditorPanel,
  /event\.key\.toLowerCase\(\)\s*!==\s*['"]k['"]/,
  'Quick Editor shell shortcut handler should target Cmd/Ctrl+K',
)

assert.match(
  quickEditorPanel,
  /event\.preventDefault\(\)[\s\S]*event\.stopPropagation\(\)[\s\S]*openQuickEditorCommand\(\)/,
  'Cmd/Ctrl+K should be prevented and open the Quick Editor command overlay',
)

assert.match(
  store,
  /openGlobalLauncherOverlay:\s*\(mode\)\s*=>\s*set\(\{\s*globalLauncherOpen:\s*true,\s*globalLauncherMode:\s*mode,\s*globalLauncherOverlay:\s*true\s*\}\)/,
  'global launcher overlay routing should be able to replace quick-editor mode with pinned-only mode',
)

console.log('Quick Editor launcher behavior checks passed')
