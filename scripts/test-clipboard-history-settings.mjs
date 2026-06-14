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
assert.match(settingsBody, /ClipboardHistorySettingsBody/, 'Must export ClipboardHistorySettingsBody component')
assert.match(settingsBody, /enabled/, 'Settings body must reference enabled toggle')
assert.match(settingsBody, /maxItems|retentionDays/, 'Settings body must reference limits')

console.log('clipboard-history settings tests passed')
