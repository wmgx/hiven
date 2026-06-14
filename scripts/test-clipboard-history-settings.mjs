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

// ─── 6. Settings body file exists ────────────────────────────────────────────

const settingsBodyPath = 'src/plugins/clipboard-history/settings/ClipboardHistorySettingsBody.tsx'
assert.ok(existsSync(join(root, settingsBodyPath)), 'Settings body component must exist')

const settingsBody = read(settingsBodyPath)
const clipboardStyle = read('src/plugins/clipboard-history/style.css')
assert.match(settingsBody, /ClipboardHistorySettingsBody/, 'Must export ClipboardHistorySettingsBody component')
assert.match(settingsBody, /enabled/, 'Settings body must reference enabled toggle')
assert.match(settingsBody, /maxItems|retentionDays/, 'Settings body must reference limits')
assert.match(settingsBody, /createClipboardHistoryRepository/, 'Settings body must use repository for clear-all')
assert.match(settingsBody, /repository\.clearAll\(\)/, 'Settings body clear-all must delete persisted history and blobs')
assert.match(settingsBody, /host\.permissions/, 'Settings body must display current permission state')
assert.match(settingsBody, /missingPermissions\s*=\s*REQUIRED_PERMISSIONS\.filter/, 'Settings body must prioritize missing permissions instead of showing every granted permission by default')
assert.match(settingsBody, /permissionsAllGranted/, 'Settings body must summarize the all-granted state')
assert.match(settingsBody, /clipboard-history-permission-popover/, 'Settings body must provide a hover permission popover')
assert.match(clipboardStyle, /\.clipboard-history-permission-popover[\s\S]{0,120}position:\s*absolute/, 'Granted permissions should render in a floating popover')
assert.match(clipboardStyle, /\.clipboard-history-permission-popover[\s\S]{0,180}display:\s*none/, 'Permission popover should be hidden by default')
assert.match(clipboardStyle, /\.clipboard-history-permissions:hover \.clipboard-history-permission-popover/, 'All permissions should show in a popover on hover')
assert.doesNotMatch(settingsBody, /x-apple\.systempreferences:com\.apple\.preference\.security\?Privacy_Accessibility|settings\.openAccessibility/, 'Settings body must not show a non-functional Accessibility settings shortcut')
assert.doesNotMatch(settingsBody, /Clear handled by surface/, 'Settings clear-all must not be a placeholder')
assert.match(settingsBody, /bytesToMegabytes/, 'Settings body must display byte-backed limits as MB')
assert.match(settingsBody, /megabytesToBytes/, 'Settings body must persist MB inputs as bytes')
assert.doesNotMatch(settingsBody, /formatBytes/, 'Settings body must not expose raw byte formatting for limit inputs')

const zh = read('src/plugins/clipboard-history/locales/zh.json')
const en = read('src/plugins/clipboard-history/locales/en.json')
assert.match(zh, /文本单项大小上限（MB）/, 'Chinese settings size labels must use MB')
assert.match(en, /Max text size \(MB\)/, 'English settings size labels must use MB')
assert.match(zh, /全部已授权/, 'Chinese settings permissions should include all-granted summary')
assert.match(en, /All granted/, 'English settings permissions should include all-granted summary')

const pluginTypes = read('src/workspace/pluginTypes.ts')
assert.match(pluginTypes, /PluginSettingsHostApi/, 'Plugin settings props must expose a narrow host API')
assert.match(pluginTypes, /host:\s*PluginSettingsHostApi/, 'Plugin settings body must receive host API through SDK props')

const settingsDialog = read('src/components/PluginSettingsDialog.tsx')
assert.match(settingsDialog, /createPluginPrivateStorage/, 'Settings dialog must provide plugin private storage to settings body')
assert.match(settingsDialog, /getPluginPermissionSnapshot/, 'Settings dialog must provide permission snapshot to settings body')
assert.match(settingsDialog, /host=\{settingsHost\}/, 'Settings dialog must pass settings host API')
assert.match(settingsDialog, /data-launcher-scrollable/, 'Settings dialog scroll body must opt into launcher wheel scrolling')

console.log('clipboard-history settings tests passed')
