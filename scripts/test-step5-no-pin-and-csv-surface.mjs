#!/usr/bin/env node
/** Step 5 no-pin and CSV surface contract. */
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
  assert.doesNotMatch(text, /launcher-item-pin-action|pinPluginCommand|onPinItem|pinnable:\s*true/, `${path} should not expose pin UI or pinnable tools`)
}

const globalItems = readFileSync('src/components/launcher/GlobalLauncherItems.ts', 'utf8')
assert.doesNotMatch(globalItems, /buildPinnedItems|kind:\s*['"]pinned['"]|globalPinned/, 'global launcher should not mix pinned items into normal results')

const csvIndex = readFileSync('src/plugins/csv/index.ts', 'utf8')
const csvSurface = readFileSync('src/plugins/csv/CsvSurface.tsx', 'utf8')
assert.match(csvIndex, /ui:\s*{[\s\S]*surfaces:/, 'CSV Tools should expose a dedicated surface')
assert.match(csvIndex, /shortcutPresentation:\s*['"]window['"]/, 'CSV Tools surface should open as plugin window')
assert.match(csvIndex, /launcher:\s*false/, 'CSV converter should not be a pure launcher formatter')
assert.match(csvSurface, /Table preview/, 'CSV surface should show table preview')
assert.match(csvSurface, /Output preview/, 'CSV surface should show output preview')
assert.match(csvSurface, /Delimiter[\s\S]*Header[\s\S]*Output/, 'CSV surface should expose params')

const encodeIndex = readFileSync('src/plugins/base64/index.ts', 'utf8')
const encodeSurface = readFileSync('src/plugins/base64/EncodeDecodeSurface.tsx', 'utf8')
const urlIndex = readFileSync('src/plugins/url/index.ts', 'utf8')
const htmlIndex = readFileSync('src/plugins/html/index.ts', 'utf8')
const slashesIndex = readFileSync('src/plugins/slashes/index.ts', 'utf8')
const regexIndex = readFileSync('src/plugins/regex-tester/index.tsx', 'utf8')
const regexViews = readFileSync('src/plugins/regex-tester/RegexTesterViews.tsx', 'utf8')
assert.match(encodeIndex, /title:\s*['"]Encode \/ Decode Tools['"]/, 'Encode / Decode Tools should expose one product surface')
assert.match(encodeSurface, /Base64[\s\S]*URL[\s\S]*HTML[\s\S]*Slashes/, 'Encode / Decode surface should group all legacy methods')
assert.match(encodeSurface, /Source[\s\S]*Preview/, 'Encode / Decode surface should show source and preview')
for (const [name, text] of [
  ['base64', encodeIndex],
  ['url', urlIndex],
  ['html', htmlIndex],
  ['slashes', slashesIndex],
]) {
assert.match(text, /surfaces:\s*{\s*launcher:\s*false,\s*panel:\s*true,\s*pinnable:\s*false\s*}/, `${name} legacy formatter should not be a flat global launcher entry`)
}
assert.match(regexIndex, /title:\s*['"]Regex Tester['"][\s\S]*entry:\s*{\s*launcher:\s*true/, 'Regex Tester should expose a global launcher surface')
assert.match(regexViews, /Pattern[\s\S]*flags[\s\S]*sample text/i, 'Regex Tester surface should expose pattern, flags, and sample text')

console.log('step5 no-pin, CSV, Encode / Decode, and Regex surface checks passed')
