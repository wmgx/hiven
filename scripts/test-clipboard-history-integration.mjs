#!/usr/bin/env node

/**
 * Clipboard History Plugin — locale completeness and manifest checks
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

// ─── 4. i18n completeness ───────────────────────────────────────────────────

const enLocale = JSON.parse(read('src/plugins/clipboard-history/locales/en.json'))
const zhLocale = JSON.parse(read('src/plugins/clipboard-history/locales/zh.json'))

const requiredKeys = [
  'surface.main.title',
  'search.placeholder',
  'filter.all',
  'filter.text',
  'filter.image',
  'filter.files',
  'filter.label',
  'group.today',
  'group.yesterday',
  'state.empty',
  'hint.paste',
  'hint.delete',
  'action.back',
  'action.paste',
  'action.copy',
  'action.close',
  'message.copied',
  'meta.contentType',
  'meta.characters',
  'meta.words',
  'meta.byteSize',
  'meta.dimensions',
  'meta.files',
  'meta.firstCopied',
  'meta.lastCopied',
  'error.loadFailed',
  'error.pasteFailed',
  'error.copyFailed',
]

for (const key of requiredKeys) {
  assert.ok(key in enLocale, `en.json missing key: "${key}"`)
  assert.ok(key in zhLocale, `zh.json missing key: "${key}"`)
  assert.ok(enLocale[key].length > 0, `en.json key "${key}" is empty`)
  assert.ok(zhLocale[key].length > 0, `zh.json key "${key}" is empty`)
}

// ─── 7. Manifest correctness ────────────────────────────────────────────────

const manifest = JSON.parse(read('src/plugins/clipboard-history/manifest.json'))

assert.equal(manifest.pluginId, 'clipboard-history')
// Floor, not equality: plugin versions rise whenever behavior changes
// (CLAUDE.md), so pinning an exact version guarantees a false failure on the
// next legitimate bump — the same trap already hit in web-open twice.
{
  const [major, minor] = manifest.version.split('.').map(Number)
  assert.ok(
    major > 1 || (major === 1 && minor >= 2),
    `clipboard-history version must be >= 1.2, got ${manifest.version}`,
  )
}
assert.ok(manifest.capabilities.includes('settings'))
assert.ok(manifest.capabilities.includes('ui'))
assert.ok(manifest.capabilities.includes('background'))
assert.ok(manifest.permissions.includes('clipboard.read'))
assert.ok(manifest.permissions.includes('clipboard.write'))
assert.ok(manifest.permissions.includes('clipboard.watch'))
assert.ok(manifest.permissions.includes('storage.private'))
assert.ok(manifest.permissions.includes('accessibility.paste'))

console.log('clipboard-history integration tests passed')
