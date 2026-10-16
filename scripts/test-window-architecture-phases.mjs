#!/usr/bin/env node
/** Window architecture: structured Tauri config / capability checks. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'))

const tauriConfig = readJson('src-tauri/tauri.conf.json')
assert.ok(
  !tauriConfig.app?.windows?.some((window) => window.label === 'main'),
  'Tauri config must not declare the retired main window',
)
const defaultCapability = readJson('src-tauri/capabilities/default.json')
assert.ok(!defaultCapability.windows?.includes('main'), 'default capability must not grant access to a retired main window')
assert.ok(
  !defaultCapability.permissions?.includes('core:window:allow-create') &&
    !defaultCapability.permissions?.includes('core:webview:allow-create-webview-window'),
  'default capability must not expose frontend window creation now that native window manager owns editor/plugin windows',
)
assert.ok(
  defaultCapability.permissions?.includes('core:window:allow-close'),
  'default capability must allow editor windows to close themselves',
)

console.log('window architecture phase checks passed')
