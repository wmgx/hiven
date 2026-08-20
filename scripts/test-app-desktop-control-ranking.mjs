#!/usr/bin/env node
/**
 * Package ③ desktop-control ranking:
 *  - empty query: hostAppLauncher returns at most 5 apps (installedAt desc, then name)
 *  - strong jwt content detection: host app score < jwt tool score
 *  - buildWebQuickOpenUrl supports {clipboard} (falls back to query)
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function loadTs(path, importStubs = [], globals = {}) {
  let src = readFileSync(path, 'utf8')
  for (const [importMatch, replacement] of importStubs) {
    src = src.replace(importMatch, replacement)
  }
  const out = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
      esModuleInterop: true,
    },
  }).outputText
  const moduleExports = {}
  const requireShim = (id) => {
    if (id === 'pinyin-pro') return { pinyin: (t) => t }
    throw new Error('unexpected require: ' + id)
  }
  const sandbox = {
    exports: moduleExports,
    module: { exports: moduleExports },
    console,
    require: requireShim,
    ...globals,
  }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports
}

// ── ranking (same harness pattern as test-launcher-intent-ranking.mjs) ───────
const searchRanking = loadTs('src/workspace/searchRanking.ts', [])
const usage = loadTs('src/workspace/launcher/usage.ts', [
  [
    /import\s*\{[^}]*\}\s*from\s*'\.\/types'\s*;?\s*\n?/,
    "const LAUNCHER_SURFACE_IDS=['command-palette','editor-command-bar','global-launcher'];\nconst normalizeLauncherSurfaceId=(surfaceId)=>surfaceId==='command-palette'?'editor-command-bar':surfaceId;\n",
  ],
])
const display = loadTs('src/workspace/launcher/display.ts', [
  [/import\s+type\s*\{[^}]*\}\s*from\s*'[^']*'\s*;?\s*\n?/g, ''],
])

let rankingSrc = readFileSync('src/workspace/launcher/ranking.ts', 'utf8')
rankingSrc = rankingSrc
  .replace(/import\s+type\s*\{[^}]*\}\s*from\s*'\.\.\/\.\.\/i18n'\s*;?\s*\n?/, '')
  .replace(/import\s+type\s*\{[^}]*\}\s*from\s*'\.\.\/\.\.\/kits\/content'\s*;?\s*\n?/, '')
  .replace(/import\s*\{[^}]*\}\s*from\s*'\.\.\/searchRanking'\s*;?\s*\n?/, '')
  .replace(/import\s+type\s*\{[^}]*\}\s*from\s*'\.\/types'\s*;?\s*\n?/, '')
  .replace(/import\s*\{[^}]*\}\s*from\s*'\.\/usage'\s*;?\s*\n?/, '')
  .replace(/import\s*\{[^}]*\}\s*from\s*'\.\/display'\s*;?\s*\n?/, '')
  .replace(/import\s+type\s*\{[^}]*\}\s*from\s*'\.\/intentTypes'\s*;?\s*\n?/, '')
  .replace(/import\s*\{[^}]*\}\s*from\s*'\.\/intentEngine'\s*;?\s*\n?/, '')
  .replace(/import\s*\{[^}]*\}\s*from\s*'\.\/intentTypes'\s*;?\s*\n?/, '')
  .replace(/import\s*\{[^}]*\}\s*from\s*'\.\.\/desktopTargets\/browserWindowPolicy'\s*;?\s*\n?/, '')
const rankingOut = ts.transpileModule(rankingSrc, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
}).outputText
const rankingExports = {}
const rankingSandbox = {
  exports: rankingExports,
  module: { exports: rankingExports },
  console,
  scoreSearchableFields: searchRanking.scoreSearchableFields,
  searchableFieldsMatch: searchRanking.searchableFieldsMatch,
  getUsageRecord: usage.getUsageRecord,
  localizedDisplay: display.localizedDisplay,
  navNearDuplicateDemotion: () => 0,
}
try {
  const engine = loadTs('src/workspace/launcher/intentEngine.ts', [
    [/import\s+type\s*\{[^}]*\}\s*from\s*'\.\/intentTypes'\s*;?\s*\n?/, ''],
  ])
  Object.assign(rankingSandbox, {
    evaluateAccepts: engine.evaluateAccepts,
    isIntentEligible: engine.isIntentEligible,
    passesIntentMatchFilter: engine.passesIntentMatchFilter,
    normalizeIntentQuery: engine.normalizeIntentQuery,
  })
} catch {
  // optional
}
vm.runInNewContext(rankingOut, rankingSandbox)
const ranking = rankingSandbox.module.exports

function item(systemKey, title, opts = {}) {
  return {
    systemKey,
    kind: opts.kind ?? 'plugin',
    display: { title, aliases: opts.aliases },
    behavior: { type: 'perform' },
    staticPriority: opts.staticPriority,
    ranking: opts.ranking,
    legacyUsageKeys: opts.legacyUsageKeys,
    accepts: opts.accepts,
    textMatch: opts.textMatch,
    execute: () => ({ ok: true }),
  }
}

const now = 1_000_000_000_000
const emptyUsage = usage.emptyUsageBySurface()
const JWT_SAMPLE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature'

// --- 1. Strong jwt detection: app score < jwt tool score (even with heavy app usage) ---
{
  const jwtTool = item('plugin:encode-decode:launcher:jwt-decode', 'Decode JWT', {
    accepts: { kinds: ['jwt'] },
  })
  const notes = item('host:app-launcher:app:notes', 'Notes', { kind: 'host' })
  let uHeavy = emptyUsage
  for (let i = 0; i < 80; i++) {
    uHeavy = usage.recordSelection(uHeavy, 'global-launcher', notes.systemKey, now)
  }
  const ctx = {
    query: '',
    locale: 'en',
    surfaceId: 'global-launcher',
    usage: uHeavy,
    now,
    contentText: JWT_SAMPLE,
    detections: [{ kind: 'jwt', confidence: 0.95, normalized: JWT_SAMPLE }],
  }
  const scoreJwt = ranking.scoreLauncherItem(ctx, jwtTool)
  const scoreApp = ranking.scoreLauncherItem(ctx, notes)
  assert.ok(
    scoreApp < scoreJwt,
    `strong jwt detection must rank jwt tool above host app: app=${scoreApp} jwt=${scoreJwt}`,
  )
  // Pure url detection must NOT apply the strong-text app penalty (web still competes).
  const urlOnly = {
    ...ctx,
    detections: [{ kind: 'url', confidence: 0.99, normalized: 'https://example.com' }],
    contentText: 'https://example.com',
  }
  const scoreAppUrl = ranking.scoreLauncherItem(urlOnly, notes)
  assert.ok(
    scoreAppUrl > scoreApp,
    `url-only detections should not demote apps like strong text kinds: url=${scoreAppUrl} jwt-path=${scoreApp}`,
  )
}

// ── hostAppLauncher empty-query limit ────────────────────────────────────────
const hostAppIndex = loadTs('src/workspace/appLauncher/hostAppIndex.ts', [
  [/import\s+type\s*\{[^}]*\}\s*from\s*'[^']*'\s*;?\s*\n?/g, ''],
])

const store = new Map()
const apps = []
for (let i = 0; i < 12; i++) {
  apps.push({
    appId: `macos:bundle:com.example.app${i}`,
    name: `App${String.fromCharCode(65 + (11 - i))}`, // AppL … AppA names mixed
    platform: 'macos',
    source: 'applications',
    displayPath: `/Applications/App${i}.app`,
    // Higher installedAt for lower index → App0 newest among timed entries
    installedAt: i < 10 ? 10_000 - i * 100 : undefined,
  })
}
store.set(
  'hiven:host-app-launcher:index:v2',
  JSON.stringify({ version: 1, refreshedAt: Date.now(), apps }),
)

const localStorageMock = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => {
    store.set(k, String(v))
  },
  removeItem: (k) => {
    store.delete(k)
  },
}

let hostAppSrc = readFileSync('src/workspace/appLauncher/hostAppLauncher.ts', 'utf8')
hostAppSrc = hostAppSrc
  .replace(/import\s+type\s*\{[^}]*\}\s*from\s*'[^']*'\s*;?\s*\n?/g, '')
  .replace(/import\s*\{[^}]*\}\s*from\s*'\.\.\/searchRanking'\s*;?\s*\n?/, '')
  .replace(/import\s*\{[^}]*\}\s*from\s*'\.\.\/launcher\/perf'\s*;?\s*\n?/, '')
  .replace(/import\s*\{[^}]*\}\s*from\s*'\.\/hostAppIndex'\s*;?\s*\n?/, '')

const hostAppOut = ts.transpileModule(hostAppSrc, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
}).outputText
const hostAppExports = {}
const hostAppSandbox = {
  exports: hostAppExports,
  module: { exports: hostAppExports },
  console,
  window: {
    localStorage: localStorageMock,
    __TAURI_INTERNALS__: undefined,
  },
  searchableFieldsMatch: searchRanking.searchableFieldsMatch,
  logLauncherPerfDuration: () => {},
  launcherPerfNow: () => 0,
  normalizeHostAppEntries: hostAppIndex.normalizeHostAppEntries,
}
vm.runInNewContext(hostAppOut, hostAppSandbox)
const hostApp = hostAppSandbox.module.exports

{
  const emptyItems = await hostApp.getHostAppLauncherDynamicItems({
    query: '',
    surfaceId: 'global-launcher',
    locale: 'en',
  })
  assert.equal(emptyItems.length, 5, `empty query must return at most 5 apps, got ${emptyItems.length}`)
  // Newest installedAt first: App0 (10000), App1 (9900), …
  assert.equal(emptyItems[0].display.title, 'AppL') // name for i=0 is AppL (65+11)
  assert.equal(emptyItems[1].display.title, 'AppK')
  assert.ok(
    emptyItems.every((it) => String(it.systemKey).startsWith('host:app-launcher:app:')),
    'empty-query rows must be host app launcher items',
  )

  const withQuery = await hostApp.getHostAppLauncherDynamicItems({
    query: 'AppA',
    surfaceId: 'global-launcher',
    locale: 'en',
  })
  assert.ok(withQuery.length >= 1, 'query path still filters by name')
  assert.ok(withQuery.length <= 50, 'query path stays within QUERY_APP_LIMIT')
  assert.ok(
    withQuery.every((it) => String(it.display.title).toLowerCase().includes('appa') || String(it.display.title) === 'AppA'),
    'query path should prefer matching titles',
  )

  const wrongSurface = await hostApp.getHostAppLauncherDynamicItems({
    query: '',
    surfaceId: 'command-palette',
    locale: 'en',
  })
  assert.equal(wrongSurface.length, 0, 'apps only appear on global-launcher')
}

// ── web-open {clipboard} placeholder ─────────────────────────────────────────
const model = loadTs('src/plugins/web-open/settings/model.ts', [
  [/import\s+type\s*\{[^}]*\}\s*from\s*'[^']*'\s*;?\s*\n?/g, ''],
])
{
  const qOnly = model.buildWebQuickOpenUrl('https://x.test/q={query}', 'hello world', true)
  assert.equal(qOnly, 'https://x.test/q=hello%20world')

  const clipFallback = model.buildWebQuickOpenUrl('https://x.test/c={clipboard}', 'from-query', true)
  assert.equal(clipFallback, 'https://x.test/c=from-query', '{clipboard} falls back to query')

  const clipExtra = model.buildWebQuickOpenUrl(
    'https://x.test/q={query}&c={clipboard}',
    'typed',
    true,
    { clipboard: 'clip value' },
  )
  assert.equal(clipExtra, 'https://x.test/q=typed&c=clip%20value')

  const noEncode = model.buildWebQuickOpenUrl(
    'https://x.test/{clipboard}',
    'a b',
    false,
    { clipboard: 'c d' },
  )
  assert.equal(noEncode, 'https://x.test/c d')
}

// Source contracts: direct-url accepts + dynamic accepts passthrough
const webOpenIndex = readFileSync('src/plugins/web-open/index.tsx', 'utf8')
assert.match(webOpenIndex, /direct-url-open[\s\S]*accepts:\s*\{\s*kinds:\s*\[['"]url['"]\]/, 'direct-url-open must declare accepts.kinds url')
const registry = readFileSync('src/workspace/launcher/registry.ts', 'utf8')
assert.match(
  registry,
  /resolveDynamicItem[\s\S]*normalizeContribution/,
  'resolveDynamicItem must normalizeContribution (copies accepts/params/match protocol)',
)
assert.match(
  readFileSync('src/workspace/launcher/normalizeContribution.ts', 'utf8'),
  /accepts:\s*contribution\.accepts/,
  'normalizeContribution must pass through contribution.accepts',
)
const manifest = JSON.parse(readFileSync('src/plugins/web-open/manifest.json', 'utf8'))
// Floor, not equality: plugin versions must rise whenever behavior changes
// (CLAUDE.md), so pinning an exact version guarantees a false failure on the
// next legitimate bump — which is what happened when the browser-tabs merge
// shipped 1.5.0. Assert the package-3 bump happened and never regressed.
const [major, minor] = manifest.version.split('.').map(Number)
assert.ok(
  major > 1 || (major === 1 && minor >= 4),
  `web-open manifest version must be >= 1.4.0 (package 3 bump), got ${manifest.version}`,
)

console.log('✓ test-app-desktop-control-ranking passed')
