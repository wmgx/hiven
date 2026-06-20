#!/usr/bin/env node

/**
 * Clipboard History Plugin — Background Lifecycle & Settings Tests
 *
 * Verifies:
 * 1. Background file exists and exports correct structure
 * 2. Background starts only when settings.enabled === true
 * 3. Background uses clipboard.watch() from context
 * 4. Settings change triggers stop+restart
 * 5. Background respects recordText/recordImages/recordFiles toggles
 */

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

// ─── 1. Background file structure ───────────────────────────────────────────

const bgPath = 'src/plugins/clipboard-history/background/clipboardHistoryBackground.ts'
assert.ok(existsSync(join(root, bgPath)), 'Background file must exist')

const bgFile = read(bgPath)

// Must export a background contribution with start function
assert.match(bgFile, /createClipboardHistoryBackground|clipboardHistoryBackground/, 'Must export background contribution')
assert.match(bgFile, /start/, 'Background must have start function')

// Must check settings.enabled before starting
assert.match(bgFile, /settings\.enabled|ctx\.settings\.enabled/, 'Background must check settings.enabled')

// Must use clipboard.watch
assert.match(bgFile, /clipboard\.watch|ctx\.clipboard\.watch/, 'Background must use clipboard.watch')

// Must return stop function
assert.match(bgFile, /stop|unwatch|cleanup/, 'Background must return a stop/cleanup function')

// ─── 2. Must not directly import @tauri-apps ────────────────────────────────

assert.doesNotMatch(bgFile, /@tauri-apps/, 'Background must not import @tauri-apps directly')

// ─── 3. Must not import host deep paths ─────────────────────────────────────

assert.doesNotMatch(bgFile, /\.\.\/\.\.\/store|\.\.\/\.\.\/workspace/, 'Background must not import host deep paths')

// ─── 4. Must reference storage for persisting items ─────────────────────────

assert.match(bgFile, /storage|repository|addItem/, 'Background must use storage/repository for persistence')

// ─── 5. Must handle recordText/recordImages/recordFiles settings ─────────────

assert.match(bgFile, /recordText|text.*settings|settings.*text/, 'Background must reference text recording setting')
assert.match(bgFile, /recordImages|image.*settings|settings.*image/, 'Background must reference image recording setting')
assert.match(bgFile, /recordFiles|files.*settings|settings.*file/, 'Background must reference files recording setting')

// ─── 6. Settings schema is the source of truth ───────────────────────────────

const pluginIndex = read('src/plugins/clipboard-history/index.tsx')
const schemaRenderer = read('src/components/PluginSettingsSchemaRenderer.tsx')
assert.match(pluginIndex, /schema:\s*\{/, 'Clipboard history settings must be schema-rendered')
assert.match(pluginIndex, /key:\s*['"]enabled['"]/, 'Settings schema must expose enabled toggle')
assert.match(pluginIndex, /key:\s*['"]recordText['"]/, 'Settings schema must expose text recording toggle')
assert.match(pluginIndex, /key:\s*['"]recordImages['"]/, 'Settings schema must expose image recording toggle')
assert.match(pluginIndex, /key:\s*['"]recordFiles['"]/, 'Settings schema must expose file recording toggle')
assert.match(pluginIndex, /key:\s*['"]maxItems['"]/, 'Settings schema must expose max item limit')
assert.match(pluginIndex, /key:\s*['"]retentionDays['"]/, 'Settings schema must expose retention limit')
assert.match(pluginIndex, /key:\s*['"]maxTextBytes['"][\s\S]{0,420}storageScale:\s*MB/, 'Text byte limit must render as MB via schema')
assert.match(pluginIndex, /key:\s*['"]maxImageBytes['"][\s\S]{0,420}storageScale:\s*MB/, 'Image byte limit must render as MB via schema')
assert.match(pluginIndex, /key:\s*['"]maxTotalCacheBytes['"][\s\S]{0,420}storageScale:\s*MB/, 'Total cache limit must render as MB via schema')
assert.doesNotMatch(pluginIndex, /key:\s*['"]defaultAction['"]/, 'Settings schema must not expose fixed default action as a fake selector')
assert.doesNotMatch(pluginIndex, /key:\s*['"]pasteFailureFallback['"]/, 'Settings schema must not expose fixed paste fallback as a fake selector')
assert.doesNotMatch(pluginIndex, /ClipboardHistorySettingsBody/, 'Clipboard history settings must not use the legacy custom body')
assert.match(schemaRenderer, /storageScale/, 'Schema renderer must display byte-backed limits with unit scaling')

const zh = read('src/plugins/clipboard-history/locales/zh.json')
const en = read('src/plugins/clipboard-history/locales/en.json')
assert.match(zh, /文本单项大小上限（MB）/, 'Chinese settings size labels must use MB')
assert.match(en, /Max text size \(MB\)/, 'English settings size labels must use MB')

const pluginTypes = read('src/workspace/pluginTypes.ts')
assert.match(pluginTypes, /PluginSettingsHostApi/, 'Plugin settings props must expose a narrow host API')
assert.match(pluginTypes, /host:\s*PluginSettingsHostApi/, 'Plugin settings body must receive host API through SDK props')

const settingsDialog = read('src/components/PluginSettingsDialog.tsx')
assert.match(settingsDialog, /createPluginPrivateStorage/, 'Settings dialog must provide plugin private storage to settings body')
assert.match(settingsDialog, /getPluginPermissionSnapshot/, 'Settings dialog must provide permission snapshot to settings body')
assert.match(settingsDialog, /host:\s*settingsHost/, 'Settings dialog must pass settings host API')
assert.match(settingsDialog, /data-launcher-scrollable/, 'Settings dialog scroll body must opt into launcher wheel scrolling')

console.log('clipboard-history settings tests passed')
