import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

const source = fs.readFileSync('src/plugins/web-open/queryHistory.ts', 'utf8')
const pluginSource = fs.readFileSync('src/plugins/web-open/index.tsx', 'utf8')
const extensionSource = fs.readFileSync('src/plugins/web-open/extension/background.js', 'utf8')
const bridgeSource = fs.readFileSync('src-tauri/src/desktop_bridge.rs', 'utf8')
const eventBusSource = fs.readFileSync('src/workspace/hostEventBus.ts', 'utf8')
const launcherSessionSource = fs.readFileSync('src/workspace/launcher/useLauncherSession.ts', 'utf8')
const browserProviderSource = fs.readFileSync('src/plugins/web-open/browserProvider.ts', 'utf8')
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const module = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)

assert.equal(
  module.queryFromBrowserUrl(
    'https://example.com/search?q={query}',
    'https://example.com/search?q=hello%20world&utm_source=tracker&trace_id=secret',
  ),
  'hello world',
)
assert.equal(
  module.queryFromBrowserUrl('https://example.com/issues/{query}', 'https://example.com/issues/ABC-123?from=feed'),
  'ABC-123',
)
assert.equal(
  module.queryFromBrowserUrl('https://example.com/search?q={query}', 'https://other.com/search?q=hello'),
  null,
)

let stored
const storage = {
  kv: {
    get: async () => stored,
    set: async (_key, value) => { stored = value },
    delete: async () => { stored = undefined },
  },
}
const imported = await module.importBrowserQueryHistory(
  storage,
  [{ id: 'search', urlTemplate: 'https://example.com/search?q={query}', recordQueryHistory: true, maxQueryHistory: 10 }],
  [
    { url: 'https://example.com/search?q=kept&utm_source=dropped', lastVisitTime: 1 },
    { url: 'https://example.com/search?q=kept&trace_id=dropped', lastVisitTime: 2 },
  ],
)
assert.equal(imported, 1)
assert.deepEqual(stored.queries.map((item) => item.text), ['kept'])
const backgroundSource = pluginSource.slice(pluginSource.indexOf('background:'), pluginSource.indexOf('hooks:'))
assert.match(backgroundSource, /browser\.opened[\s\S]*importBrowserQueryHistory/, 'new browser events should be learned incrementally')
assert.match(pluginSource, /kind:\s*'action'[\s\S]*importHistory\([\s\S]{0,120}CHROMIUM_SOURCE_ID[\s\S]*importBrowserQueryHistory/, 'learn button should request full existing browser history directly')
assert.match(pluginSource, /importBrowserQueryHistory\(host\.storage, value\.entries \?\? \[\], history\)/, 'manual import should learn across all quick-open rules')
assert.match(pluginSource, /count > 0[\s\S]*queryHistory\.noneLearned/, 'learn button should report learned and empty results')
assert.match(pluginSource, /queryHistory\.learnFailedDetail[\s\S]*error instanceof Error/, 'learn failures should expose their copyable cause')
assert.doesNotMatch(pluginSource, /QueryHistoryModal|modalId:\s*'query-history'/, 'browser learning should not open a modal')
assert.doesNotMatch(pluginSource, /BROWSER_EVENT_POLL|listEvents\(/, 'browser learning must not poll bridge events')
assert.match(extensionSource, /POLL_ALARM_MINUTES\s*=\s*0\.5/, 'extension command polling must respect Chromium\'s 30-second alarm floor')
assert.match(extensionSource, /HISTORY_IMPORT_BATCH_SIZE\s*=\s*500/, 'full history must be fetched in bounded batches')
assert.match(extensionSource, /requestId:[\s\S]*done/, 'each history batch must report completion state')
assert.match(bridgeSource, /history_import_status/, 'desktop bridge must expose incremental import progress')
assert.match(pluginSource, /reportProgress[\s\S]*queryHistory\.learningProgress/, 'learn button must display read and learned progress')
assert.match(eventBusSource, /publisher:[\s\S]{0,80}kind: 'host'[\s\S]{0,80}browser-bridge/, 'events should identify their host publisher')
assert.match(eventBusSource, /source:[\s\S]{0,80}kind: 'plugin'[\s\S]{0,80}web-open/, 'events should identify their plugin source')
assert.equal(Number(launcherSessionSource.match(/HOST_DYNAMIC_DEBOUNCE_MS\s*=\s*(\d+)/)?.[1]), 0, 'memory-backed host results should not debounce')
assert.doesNotMatch(pluginSource, /async function buildHistoryOutput/, 'opening a configured rule should render local history without waiting for favicon I/O')
const browserListBody = browserProviderSource.slice(browserProviderSource.indexOf('async list(ctx)'), browserProviderSource.indexOf('async activate(target)'))
assert.doesNotMatch(browserListBody, /bridge\.listTargets|bridge\.listHistory/, 'browser query should filter the in-memory index only')
const browserHealthBody = browserProviderSource.slice(browserProviderSource.indexOf('async health()'), browserProviderSource.indexOf('async list(ctx)'))
assert.doesNotMatch(browserHealthBody, /bridge\.|desktopTargets/, 'browser health should read cached connection state only')

console.log('web-open browser template learning checks passed')
