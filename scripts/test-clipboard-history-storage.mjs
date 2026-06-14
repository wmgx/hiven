#!/usr/bin/env node

/**
 * Clipboard History Plugin — Storage Layer Tests
 *
 * Verifies:
 * 1. Data model types are correctly defined
 * 2. Repository: dedupe (same hash updates existing item)
 * 3. Repository: prune by maxItems
 * 4. Repository: prune by retentionDays
 * 5. Repository: prune by maxTotalCacheBytes
 * 6. Repository: CRUD operations (add, get, delete, clear)
 * 7. Repository: blob cleanup on image item deletion
 * 8. Settings model: default values
 */

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

// ─── 1. Data model types ─────────────────────────────────────────────────────

const typesFile = read('src/plugins/clipboard-history/storage/clipboardHistoryTypes.ts')

// Must define ClipboardHistoryItem union type
assert.match(typesFile, /ClipboardHistoryItem/, 'Must export ClipboardHistoryItem type')
assert.match(typesFile, /ClipboardHistoryBase/, 'Must define ClipboardHistoryBase type')
assert.match(typesFile, /ClipboardTextHistoryItem/, 'Must define ClipboardTextHistoryItem type')
assert.match(typesFile, /ClipboardImageHistoryItem/, 'Must define ClipboardImageHistoryItem type')
assert.match(typesFile, /ClipboardFilesHistoryItem/, 'Must define ClipboardFilesHistoryItem type')

// Base fields
assert.match(typesFile, /id:\s*string/, 'Base must have id field')
assert.match(typesFile, /hash:\s*string/, 'Base must have hash field')
assert.match(typesFile, /firstCopiedAt:\s*number/, 'Base must have firstCopiedAt field')
assert.match(typesFile, /lastCopiedAt:\s*number/, 'Base must have lastCopiedAt field')
assert.match(typesFile, /copyCount:\s*number/, 'Base must have copyCount field')
assert.match(typesFile, /byteSize:\s*number/, 'Base must have byteSize field')

// Text item fields
assert.match(typesFile, /text:\s*string/, 'TextItem must have text field')
assert.match(typesFile, /preview:\s*string/, 'TextItem must have preview field')

// Image item fields
assert.match(typesFile, /blobId:\s*string/, 'ImageItem must have blobId field')
assert.match(typesFile, /previewBlobId:\s*string/, 'ImageItem must have previewBlobId field')
assert.match(typesFile, /contentType:\s*string/, 'ImageItem must have contentType field')

// Files item fields
assert.match(typesFile, /paths:\s*string\[\]/, 'FilesItem must have paths field')
assert.match(typesFile, /fileNames:\s*string\[\]/, 'FilesItem must have fileNames field')

// ─── 2. Settings model ───────────────────────────────────────────────────────

const settingsModel = read('src/plugins/clipboard-history/settings/model.ts')

assert.match(settingsModel, /ClipboardHistorySettings/, 'Must export ClipboardHistorySettings type')
assert.match(settingsModel, /DEFAULT_CLIPBOARD_HISTORY_SETTINGS/, 'Must export DEFAULT_CLIPBOARD_HISTORY_SETTINGS')

// Check default values per design doc
assert.match(settingsModel, /enabled:\s*false/, 'Default enabled should be false')
assert.match(settingsModel, /recordText:\s*true/, 'Default recordText should be true')
assert.match(settingsModel, /recordImages:\s*true/, 'Default recordImages should be true')
assert.match(settingsModel, /recordFiles:\s*true/, 'Default recordFiles should be true')
assert.match(settingsModel, /maxItems:\s*500/, 'Default maxItems should be 500')
assert.match(settingsModel, /retentionDays:\s*30/, 'Default retentionDays should be 30')
assert.match(settingsModel, /maxTextBytes:\s*256\s*\*\s*1024/, 'Default maxTextBytes should be 256KB')
assert.match(settingsModel, /maxImageBytes:\s*10\s*\*\s*1024\s*\*\s*1024/, 'Default maxImageBytes should be 10MB')
assert.match(settingsModel, /maxTotalCacheBytes:\s*500\s*\*\s*1024\s*\*\s*1024/, 'Default maxTotalCacheBytes should be 500MB')

// ─── 3. Repository file structure ───────────────────────────────────────────

const repoFile = read('src/plugins/clipboard-history/storage/clipboardHistoryRepository.ts')

// Must export repository creation function
assert.match(repoFile, /createClipboardHistoryRepository/, 'Must export createClipboardHistoryRepository')
assert.match(repoFile, /getAllItems/, 'Must export getAllItems')
assert.match(repoFile, /deleteItem/, 'Must export deleteItem')
assert.match(repoFile, /clearAll/, 'Must export clearAll')
assert.match(repoFile, /pruneItems/, 'Must export pruneItems')
assert.match(repoFile, /findByHash/, 'Must handle deduplication via findByHash')
assert.match(repoFile, /addItem/, 'Must export addItem')

// ─── 4. Store file structure ─────────────────────────────────────────────────

const storeFile = read('src/plugins/clipboard-history/storage/clipboardHistoryStore.ts')
assert.match(storeFile, /PluginPrivateStorageApi/, 'Store must reference PluginPrivateStorageApi')
assert.match(storeFile, /createClipboardHistoryStore/, 'Store must export createClipboardHistoryStore')

// ─── 5. Functional logic tests (separate .mts file) ──────────────────────────

try {
  const result = execSync('node --experimental-strip-types scripts/test-clipboard-history-logic.mts', {
    cwd: root,
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  })
  assert.match(result, /functional logic tests passed/, 'Functional logic tests must pass')
} catch (err) {
  console.error('Functional logic test failed:')
  console.error(err.stdout || '')
  console.error(err.stderr || '')
  process.exit(1)
}

console.log('clipboard-history storage tests passed')

