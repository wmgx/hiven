#!/usr/bin/env node
/**
 * test-launcher-ranking.mjs
 * Verifies mixed ranking: match dominates, usage is per-surface.
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
  [/import\s*\{[^}]*\}\s*from\s*'\.\/types'\s*;?\s*\n?/, "const LAUNCHER_SURFACE_IDS=['command-palette','editor-command-bar','global-launcher'];\nconst normalizeLauncherSurfaceId=(surfaceId)=>surfaceId==='command-palette'?'editor-command-bar':surfaceId;\n"],
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
  .replace(/import\s*\{[^}]*\}\s*from\s*'\.\.\/desktopTargets\/browserWindowPolicy'\s*;?\s*\n?/, '')
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
  // Soft nav demotion optional in ranking; stub for harness.
  navNearDuplicateDemotion: () => 0,
}
vm.runInNewContext(rankingOut, sandbox)
const ranking = sandbox.module.exports

function item(systemKey, title, opts = {}) {
  return {
    systemKey,
    kind: opts.kind ?? 'plugin',
    display: {
      title,
      aliases: opts.aliases,
      kindLabel: opts.kindLabel,
      kindLabelI18n: opts.kindLabelI18n,
    },
    behavior: { type: 'perform' },
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

// --- 3. Equal match is stable by input order (no pin boost) ---
const eqA = item('plugin:p:launcher:samea', 'Same')
const eqB = item('plugin:p:launcher:sameb', 'Same')
const rankedEq = ranking.rankLauncherItems(
  { query: 'same', locale: 'en', surfaceId: 'command-palette', usage: usage.emptyUsageBySurface(), now },
  [eqA, eqB],
)
assert.equal(rankedEq[0].systemKey, eqA.systemKey, 'on equal match, input order is preserved')

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

// --- 8. Dynamic items participate in usageScore via systemKey (once recorded) ---
const dynA = item('plugin:web-open:dynamic:site-a-quick', 'Open A', { kind: 'dynamic' })
const dynB = item('plugin:web-open:dynamic:site-b-quick', 'Open B', { kind: 'dynamic' })
let uDyn = usage.emptyUsageBySurface()
for (let i = 0; i < 5; i++) uDyn = usage.recordSelection(uDyn, 'global-launcher', dynB.systemKey, now)
const rankedDyn = ranking.rankLauncherItems(
  { query: '', locale: 'en', surfaceId: 'global-launcher', usage: uDyn, now },
  [dynA, dynB],
)
assert.equal(rankedDyn[0].systemKey, dynB.systemKey, 'recorded dynamic usage ranks that dynamic item higher')

// --- 9. Plugin dynamic pattern hits survive query filter without title match ---
// web-open matchPattern items use site title; query only appears in URL subtitle.
// searchableFieldsMatch ignores subtitle — dynamic kind must not be dropped.
const patternHit = item('plugin:web-open:dynamic:meego-quick', 'Meego 工单', {
  kind: 'dynamic',
  aliases: [],
})
const rankedPattern = ranking.rankLauncherItems(
  {
    query: '202607181649026C0B034AEF46D9FBA2C7',
    locale: 'zh',
    surfaceId: 'global-launcher',
    usage: usage.emptyUsageBySurface(),
    now,
  },
  [patternHit, reverse],
)
assert.ok(
  rankedPattern.some((row) => row.systemKey === patternHit.systemKey),
  'dynamic matchPattern item must remain after ranking filter even when title lacks the query',
)

// --- 10. Provider-declared scoreBias (product policy), host only clamps/applies ---
const createDocCmd = item('plugin:feishu:launcher:feishu.create-doc', 'Create Document', {
  kind: 'plugin',
  aliases: ['创建文档', '建文档'],
})
// Feishu docs provider sets scoreBias: -180; host must not hardcode feishu.
const hostDoc = item('feishu.docs:document:tok_abc', 'Create Document', {
  kind: 'host',
  kindLabel: 'Document',
  kindLabelI18n: { en: 'Document', zh: '文档' },
  ranking: { providerPriorityBoost: 50, scoreBias: -180 },
})
let uDocs = usage.emptyUsageBySurface()
for (let i = 0; i < 30; i++) uDocs = usage.recordSelection(uDocs, 'global-launcher', hostDoc.systemKey, now)
const rankedPluginOverDoc = ranking.rankLauncherItems(
  {
    query: 'Create Document',
    locale: 'en',
    surfaceId: 'global-launcher',
    usage: uDocs,
    now,
  },
  [hostDoc, createDocCmd],
)
assert.equal(
  rankedPluginOverDoc[0].systemKey,
  createDocCmd.systemKey,
  'provider scoreBias demotes doc mix-in under same match tier',
)
assert.equal(ranking.clampScoreBias(-180), -180, 'scoreBias within cap is preserved')
assert.equal(ranking.clampScoreBias(-9999), -500, 'scoreBias is clamped below one match tier')

// Stronger title match on the doc still wins (higher match tier beats bias < 1000).
const exactDoc = item('feishu.docs:document:tok_exact', 'UniqueDocTitleXYZ', {
  kind: 'host',
  kindLabel: 'Document',
  ranking: { scoreBias: -180 },
})
const weakCmd = item('plugin:feishu:launcher:feishu.other', 'Other command', {
  kind: 'plugin',
  aliases: ['other'],
})
const rankedDocWins = ranking.rankLauncherItems(
  {
    query: 'UniqueDocTitleXYZ',
    locale: 'en',
    surfaceId: 'global-launcher',
    usage: usage.emptyUsageBySurface(),
    now,
  },
  [weakCmd, exactDoc],
)
assert.equal(
  rankedDocWins[0].systemKey,
  exactDoc.systemKey,
  'stronger document title match still outranks weaker plugin',
)

console.log('✓ test-launcher-ranking passed')
