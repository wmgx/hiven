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
const csvCore = readFileSync('src/plugins/csv/csvCore.ts', 'utf8')
assert.match(csvIndex, /ui:\s*{[\s\S]*surfaces:/, 'CSV Tools should expose a dedicated surface')
assert.match(csvIndex, /textMatch/, 'CSV surface should declare textMatch for clipboard / path recommendations')
assert.doesNotMatch(csvIndex, /contentKinds/, 'CSV surface should not declare contentKinds after kind-filter rollback')
assert.doesNotMatch(csvIndex, /shortcutPresentation:\s*['"]window['"]/, 'CSV Tools should open in launcher, not detached window')
assert.doesNotMatch(csvIndex, /csv\.toJson|tools:\s*\[/, 'CSV plugin should be surface-only without tools')
assert.doesNotMatch(csvSurface, /Alice,30,Shanghai|const SAMPLE\s*=/, 'CSV surface must not ship a default sample table')
assert.match(csvSurface, /pane\.table|Table/, 'CSV surface should show table view')
assert.match(csvSurface, /pane\.output|Output/, 'CSV surface should show output view')
assert.match(csvSurface, /pane\.source|Source/, 'CSV surface should show source view')
assert.match(csvSurface, /Delimiter[\s\S]*Header[\s\S]*Output/, 'CSV surface should expose params')
assert.match(csvSurface, /requestBack|action\.back/, 'CSV surface should expose back action')
assert.match(csvSurface, /detachToWindow|action\.detach/, 'CSV surface should expose detach-to-window action')
assert.match(csvSurface, /react-data-grid|DataGrid/, 'CSV surface should use react-data-grid for table')
assert.match(csvSurface, /@hiven\/plugin-ui/, 'CSV surface should use shared plugin-ui components')
assert.match(csvSurface, /\bSelect\b/, 'CSV surface should use plugin-ui Select')
assert.match(csvSurface, /body--single|MainView|mainView/, 'CSV surface should use single-pane layout with view switch')
assert.match(csvSurface, /useDeferredValue|PARSE_MAX_ROWS|maxRows/, 'CSV surface should guard large-file parse cost')
assert.match(csvSurface, /processFullSource|runFullProcess|job\.runFull/, 'CSV surface should offer full-file process job')
assert.match(csvSurface, /downloadTextFile|job\.download/, 'CSV surface should support downloading full result')
assert.match(csvSurface, /cycleSort|col-sort|IconSort/, 'CSV table should expose sort icons on headers')
assert.match(csvSurface, /SearchField|globalFilter|table\.filterPlaceholder/, 'CSV table should support text filter')
assert.match(csvSurface, /filterMode.*sql|sqlFilter|filterRowsBySql/, 'CSV table should support SQL query filter')
assert.match(csvSurface, /getSqlCompletions|sql-suggest|applySqlCompletion/, 'CSV SQL mode should offer completions')
assert.match(csvSurface, /defaultSqlTemplate|SELECT \*/, 'CSV SQL mode should start from SELECT template')
assert.match(csvSurface, /dragSelectRef|onCellMouseDown|selectedColumns/, 'CSV table should support mouse drag block and column selection')
assert.doesNotMatch(csvCore, /from ['"]papaparse['"]/, 'CSV core must not depend on papaparse (disk-release safe)')
assert.match(csvCore, /parseDelimited|Quoted field/, 'CSV core should implement delimited parsing')
assert.match(csvCore, /sql|INSERT/, 'CSV core should support SQL INSERT output')
assert.match(csvCore, /maxRows/, 'CSV core should support maxRows parse limit')
assert.match(csvCore, /processFullSource|parseDelimitedAsync/, 'CSV core should support async full-file pipeline')

const launcherRegistry = readFileSync('src/workspace/launcher/registry.ts', 'utf8')
assert.match(
  launcherRegistry,
  /textMatch:\s*typeof surface\.textMatch/,
  'launcher registry should wire surface textMatch into launcher items',
)
const selectionController = readFileSync('src/components/launcher/useGlobalLauncherSelectionController.ts', 'utf8')
assert.match(
  selectionController,
  /resolveSurfaceInitialText|detectClipboardFilePath|read_file/,
  'selecting a plugin surface should resolve clipboard file paths into initialText',
)
assert.match(
  selectionController,
  /initialText/,
  'plugin surface open target should carry initialText from Object Block',
)

const encodeIndex = readFileSync('src/plugins/encode-decode/index.ts', 'utf8')
assert.match(encodeIndex, /encodeDecodePlugin|Encode|Decode/, 'Encode / Decode Tools plugin should exist')
assert.match(encodeIndex, /base64\.encode/, 'Encode / Decode should include base64 tools')
assert.match(encodeIndex, /url\.encode|URL/, 'Encode / Decode should include URL tools')

const regexIndex = readFileSync('src/plugins/regex-tester/index.tsx', 'utf8')
const regexViews = readFileSync('src/plugins/regex-tester/RegexTesterViews.tsx', 'utf8')
assert.match(regexIndex, /title:\s*['"]Regex Tester['"][\s\S]*entry:\s*{\s*launcher:\s*true/, 'Regex Tester should expose a global launcher surface')
assert.match(regexViews, /Pattern[\s\S]*flags[\s\S]*sample text/i, 'Regex Tester surface should expose pattern, flags, and sample text')

console.log('step5 no-pin, CSV, Encode / Decode, and Regex surface checks passed')
