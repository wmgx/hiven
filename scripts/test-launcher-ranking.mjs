#!/usr/bin/env node
/**
 * test-launcher-ranking.mjs
 * Verifies mixed ranking: match dominates, usage is per-surface, pinned is mild.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function loadTs(path, importStubs) {
  let src = readFileSync(path, 'utf8')
  for (const [importMatch, replacement] of importStubs) {
    src = src.replace(importMatch, replacement)
  }
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
  }).outputText
  const moduleExports = {}
  const requireShim = (id) => {
    if (id === 'pinyin-pro') return { pinyin: (t) => t } // identity stub; tests use ascii
    throw new Error('unexpected require: ' + id)
  }
  const sandbox = { exports: moduleExports, module: { exports: moduleExports }, console, require: requireShim }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports
}

// searchRanking.ts (real) — needs pinyin-pro stub.
const searchRanking = loadTs('src/workspace/searchRanking.ts', [])
// usage.ts
const usage = loadTs('src/workspace/launcher/usage.ts', [
  [/import\s*\{[^}]*\}\s*from\s*'\.\/types'\s*;?\s*\n?/, "const LAUNCHER_SURFACE_IDS=['command-palette','global-launcher'];\n"],
])
// display.ts
const display = loadTs('src/workspace/launcher/display.ts', [
  [/import\s*type\s*\{[^}]*\}\s*from\s*'[^']*'\s*;?\s*\n?/g, ''],
])

// ranking.ts — stub its imports with the already-loaded modules.
let rankingSrc = readFileSync('src/workspace/launcher/ranking.ts', 'utf8')
rankingSrc = rankingSrc
  .replace(/import\s+type\s*\{[^}]*\}\s*from\s*'\.\.\/\.\.\/i18n'\s*;?\s*\n?/, '')
  .replace(/import\s*\{[^}]*\}\s*from\s*'\.\.\/searchRanking'\s*;?\s*\n?/, '')
  .replace(/import\s+type\s*\{[^}]*\}\s*from\s*'\.\/types'\s*;?\s*\n?/, '')
  .replace(/import\s*\{[^}]*\}\s*from\s*'\.\/usage'\s*;?\s*\n?/, '')
  .replace(/import\s*\{[^}]*\}\s*from\s*'\.\/display'\s*;?\s*\n?/, '')
const rankingOut = ts.transpileModule(rankingSrc, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
}).outputText
const moduleExports = {}
const sandbox = {
  exports: moduleExports,
  module: { exports: moduleExports },
  console,
  scoreSearchableFields: searchRanking.scoreSearchableFields,
  searchableFieldsMatch: searchRanking.searchableFieldsMatch,
  getUsageRecord: usage.getUsageRecord,
  localizedDisplay: display.localizedDisplay,
}
vm.runInNewContext(rankingOut, sandbox)
const ranking = sandbox.module.exports

function item(systemKey, title, opts = {}) {
  return {
    systemKey,
    kind: opts.kind ?? 'plugin',
    display: { title, aliases: opts.aliases },
    behavior: { type: 'perform' },
    pinnable: true,
    staticPriority: opts.staticPriority,
    ranking: opts.ranking,
    legacyUsageKeys: opts.legacyUsageKeys,
    execute: () => ({ ok: true }),
  }
}

const now = 1_000_000_000_000

// --- 1. Strong query match beats high-usage weak match ---
const reverse = item('plugin:lt:launcher:reverse', 'Reverse')
const base64 = item('plugin:b64:launcher:base64', 'Base64')
let u = usage.emptyUsageBySurface()
// base64 used a lot in command-palette; reverse never used
for (let i = 0; i < 50; i++) u = usage.recordSelection(u, 'command-palette', base64.systemKey, now)
const ctxQ = { query: 'reverse', locale: 'en', surfaceId: 'command-palette', usage: u, now }
const ranked = ranking.rankLauncherItems(ctxQ, [base64, reverse])
assert.equal(ranked[0].systemKey, reverse.systemKey, 'exact match beats heavy-usage non-match')

// --- 2. Usage is per surface ---
const a = item('plugin:p:launcher:a', 'Alpha')
const b = item('plugin:p:launcher:b', 'Beta')
let u2 = usage.emptyUsageBySurface()
for (let i = 0; i < 10; i++) u2 = usage.recordSelection(u2, 'global-launcher', b.systemKey, now)
// query empty in command-palette: b has no cp usage, so order is input order (stable)
const cpEmpty = ranking.rankLauncherItems({ query: '', locale: 'en', surfaceId: 'command-palette', usage: u2, now }, [a, b])
assert.equal(cpEmpty[0].systemKey, a.systemKey, 'global-launcher usage does not affect command-palette order')
// query empty in global-launcher: b should rank first
const glEmpty = ranking.rankLauncherItems({ query: '', locale: 'en', surfaceId: 'global-launcher', usage: u2, now }, [a, b])
assert.equal(glEmpty[0].systemKey, b.systemKey, 'global-launcher usage influences global-launcher order')

// --- 3. Pinned boost is mild, not absolute top placement ---
// Two items both matching weakly by query; pinned one should win on equal match,
// but a strictly better match must still beat a pinned weaker match.
const exactWin = item('plugin:p:launcher:format', 'Format')          // matches "format" exactly
const pinnedWeak = item('plugin:p:launcher:fmtother', 'Formatter X') // prefix match, weaker tier
const pinnedKeys = new Set([pinnedWeak.systemKey])
const ctxPin = { query: 'format', locale: 'en', surfaceId: 'command-palette', usage: usage.emptyUsageBySurface(), now, pinnedKeys }
const rankedPin = ranking.rankLauncherItems(ctxPin, [pinnedWeak, exactWin])
assert.equal(rankedPin[0].systemKey, exactWin.systemKey, 'exact match beats pinned weaker match (pinned is mild)')

// Equal match → pinned wins
const eqA = item('plugin:p:launcher:samea', 'Same')
const eqB = item('plugin:p:launcher:sameb', 'Same')
const pinB = new Set([eqB.systemKey])
const rankedEq = ranking.rankLauncherItems(
  { query: 'same', locale: 'en', surfaceId: 'command-palette', usage: usage.emptyUsageBySurface(), now, pinnedKeys: pinB },
  [eqA, eqB],
)
assert.equal(rankedEq[0].systemKey, eqB.systemKey, 'on equal match, pinned item gets the mild boost')

// --- 4. Plugins cannot set static priority (only host items honored) ---
const pluginWithPriority = item('plugin:p:launcher:x', 'XX', { kind: 'plugin', staticPriority: 999 })
const hostPlain = item('host:view:y', 'XX', { kind: 'host' })
const rankedStatic = ranking.rankLauncherItems(
  { query: '', locale: 'en', surfaceId: 'command-palette', usage: usage.emptyUsageBySurface(), now },
  [pluginWithPriority, hostPlain],
)
// plugin static priority ignored → stable input order, pluginWithPriority stays first only by index, not by score
const scorePlugin = ranking.scoreLauncherItem({ query: '', locale: 'en', surfaceId: 'command-palette', usage: usage.emptyUsageBySurface(), now }, pluginWithPriority)
const scoreHost = ranking.scoreLauncherItem({ query: '', locale: 'en', surfaceId: 'command-palette', usage: usage.emptyUsageBySurface(), now }, hostPlain)
assert.equal(scorePlugin, scoreHost, 'plugin staticPriority is ignored in scoring')

// --- 5. legacyUsageKeys fallback feeds usage ---
const migratedItem = item('plugin:p:launcher:new', 'NewName', { legacyUsageKeys: ['old.command.id'] })
let uLegacy = usage.emptyUsageBySurface()
for (let i = 0; i < 8; i++) uLegacy = usage.recordSelection(uLegacy, 'command-palette', 'old.command.id', now)
const scoreLegacy = ranking.usageScore({ query: '', locale: 'en', surfaceId: 'command-palette', usage: uLegacy, now }, migratedItem)
assert.ok(scoreLegacy > 0, 'legacy usage key contributes usage score')

// --- 6. Host app selections use the same usage score ---
const notes = item('host:app-launcher:app:notes', 'Notes', { kind: 'host' })
const calendar = item('host:app-launcher:app:calendar', 'Calendar', { kind: 'host' })
let uApps = usage.emptyUsageBySurface()
for (let i = 0; i < 3; i++) uApps = usage.recordSelection(uApps, 'global-launcher', calendar.systemKey, now)
const rankedAppsByUsage = ranking.rankLauncherItems(
  { query: '', locale: 'en', surfaceId: 'global-launcher', usage: uApps, now },
  [notes, calendar],
)
assert.equal(rankedAppsByUsage[0].systemKey, calendar.systemKey, 'selected app count influences global launcher ranking')

// --- 7. Recently installed apps get a bounded freshness boost ---
const oldApp = item('host:app-launcher:app:old', 'Same App', {
  kind: 'host',
  ranking: { installedAt: now - 90 * 24 * 60 * 60 * 1000 },
})
const newApp = item('host:app-launcher:app:new', 'Same App', {
  kind: 'host',
  ranking: { installedAt: now - 2 * 24 * 60 * 60 * 1000 },
})
const rankedFreshApps = ranking.rankLauncherItems(
  { query: '', locale: 'en', surfaceId: 'global-launcher', usage: usage.emptyUsageBySurface(), now },
  [oldApp, newApp],
)
assert.equal(rankedFreshApps[0].systemKey, newApp.systemKey, 'recently installed app receives freshness boost')
assert.ok(
  ranking.installFreshnessScore({ query: '', locale: 'en', surfaceId: 'global-launcher', usage: usage.emptyUsageBySurface(), now }, newApp) < 1000,
  'install freshness boost stays below one match tier',
)

console.log('✓ test-launcher-ranking passed')
