#!/usr/bin/env node
/** Step 5 no-pin and CSV / encode-decode surface contract. */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

const srcFiles = files('src').filter((path) => /\.(ts|tsx)$/.test(path))
const checked = srcFiles
  .filter((path) => !path.includes('pinnedAction') && !path.includes('pinnedPlugin') && !path.endsWith('/store.ts'))
  .map((path) => [path, readFileSync(path, 'utf8')])

for (const [path, text] of checked) {
  assert.doesNotMatch(text, /launcher-item-pin-action|pinPluginCommand|onPinItem/, `${path} should not expose pin UI`)
  // Retired pin model fields must not remain in production source.
  if (path.includes('/workspace/launcher/') || path.includes('/plugins/')) {
    assert.doesNotMatch(text, /\bpinnable\b/, `${path} should not declare retired pinnable field`)
    assert.doesNotMatch(text, /\bpinned-actions\b/, `${path} should not declare pinned-actions capability`)
    assert.doesNotMatch(text, /\bPinnedLauncherRef\b/, `${path} should not declare PinnedLauncherRef`)
  }
}

const globalItems = readFileSync('src/components/launcher/GlobalLauncherItems.ts', 'utf8')
assert.doesNotMatch(globalItems, /buildPinnedItems|kind:\s*['"]pinned['"]|globalPinned/, 'global launcher should not mix pinned items into normal results')
assert.doesNotMatch(globalItems, /recentActionNames|actionUsageCounts|scoreSearchableFields/, 'global launcher items map must not re-score with legacy usage')

const ranking = readFileSync('src/workspace/launcher/ranking.ts', 'utf8')
assert.doesNotMatch(ranking, /PINNED_BOOST|pinnedKeys|pinnedBoost/, 'ranking must not apply pin boost')

const csvIndex = readFileSync('src/plugins/csv/index.ts', 'utf8')
const csvSurface = readFileSync('src/plugins/csv/CsvSurface.tsx', 'utf8')
assert.match(csvIndex, /ui:\s*{[\s\S]*surfaces:/, 'CSV Tools should expose a dedicated surface')
assert.match(csvIndex, /shortcutPresentation:\s*['"]window['"]/, 'CSV Tools surface should open as plugin window')
assert.match(csvSurface, /Table preview/, 'CSV surface should show table preview')
assert.match(csvSurface, /Output preview/, 'CSV surface should show output preview')
assert.match(csvSurface, /Delimiter[\s\S]*Header[\s\S]*Output/, 'CSV surface should expose params')

const encodeIndex = readFileSync('src/plugins/encode-decode/index.ts', 'utf8')
assert.match(encodeIndex, /encodeDecodePlugin|Encode|Decode/, 'Encode / Decode Tools plugin should exist')
assert.match(encodeIndex, /base64\.encode/, 'Encode / Decode should include base64 tools')
assert.match(encodeIndex, /url\.encode|URL/, 'Encode / Decode should include URL tools')

const regexIndex = readFileSync('src/plugins/regex-tester/index.tsx', 'utf8')
const regexViews = readFileSync('src/plugins/regex-tester/RegexTesterViews.tsx', 'utf8')
assert.match(regexIndex, /title:\s*['"]Regex Tester['"][\s\S]*entry:\s*{\s*launcher:\s*true/, 'Regex Tester should expose a global launcher surface')
assert.match(regexViews, /Pattern[\s\S]*flags[\s\S]*sample text/i, 'Regex Tester surface should expose pattern, flags, and sample text')

console.log('step5 no-pin, CSV, Encode / Decode, and Regex surface checks passed')
