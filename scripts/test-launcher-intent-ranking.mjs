#!/usr/bin/env node
/**
 * test-launcher-intent-ranking.mjs
 * Contract for intentScore / contextBoost slots and accepts.aliases in filter.
 * Red until ranking.ts implements intent scoring + alias match in itemMatchesQuery.
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
  [/import\s+type\s*\{[^}]*\}\s*from\s*'[^']*'\s*;?\s*\n?/g, ''],
])

// ranking.ts — stub its imports with the already-loaded modules.
// (Implementation may later pull intentEngine helpers; strip type-only / local imports first.)
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
const moduleExports = {}
const sandbox = {
  exports: moduleExports,
  module: { exports: moduleExports },
  console,
  scoreSearchableFields: searchRanking.scoreSearchableFields,
  searchableFieldsMatch: searchRanking.searchableFieldsMatch,
  getUsageRecord: usage.getUsageRecord,
  localizedDisplay: display.localizedDisplay,
  navNearDuplicateDemotion: () => 0,
}
// Optional intent helpers if ranking inlines them via free names after strip
try {
  const engine = loadTs('src/workspace/launcher/intentEngine.ts', [
    [/import\s+type\s*\{[^}]*\}\s*from\s*'\.\/intentTypes'\s*;?\s*\n?/, ''],
  ])
  Object.assign(sandbox, {
    evaluateAccepts: engine.evaluateAccepts,
    isIntentEligible: engine.isIntentEligible,
    passesIntentMatchFilter: engine.passesIntentMatchFilter,
    normalizeIntentQuery: engine.normalizeIntentQuery,
  })
} catch {
  // intentEngine helpers required for intentScore match-filter path
}
vm.runInNewContext(rankingOut, sandbox)
const ranking = sandbox.module.exports

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

function baseCtx(over = {}) {
  return {
    query: '',
    locale: 'en',
    surfaceId: 'global-launcher',
    usage: emptyUsage,
    now,
    ...over,
  }
}

const JWT_SAMPLE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature'

// --- 1. content intent 抬分 (empty query + jwt detections) ---
{
  const jwtTool = item('plugin:encode-decode:launcher:jwt-decode', 'Decode JWT', {
    accepts: { kinds: ['jwt'] },
  })
  const plainTool = item('plugin:p:launcher:unrelated', 'Unrelated Tool')
  const ctx = baseCtx({
    query: '',
    contentText: JWT_SAMPLE,
    detections: [{ kind: 'jwt', confidence: 0.95, normalized: JWT_SAMPLE }],
  })
  const scoreA = ranking.scoreLauncherItem(ctx, jwtTool)
  const scoreB = ranking.scoreLauncherItem(ctx, plainTool)
  assert.ok(scoreA > scoreB, `content intent should rank jwt tool above unrelated: ${scoreA} > ${scoreB}`)
  // Strong intent ≈ 2000–2800; gap must include ~intent magnitude (not just tiny usage/textMatch)
  assert.ok(
    scoreA - scoreB >= 1500,
    `content intent delta should be intent-scale (>=1500), got ${scoreA - scoreB}`,
  )
}

// --- 2. alias 抬分 (query=jwt, scoreLauncherItem direct) ---
{
  const jwtAlias = item('plugin:encode-decode:launcher:jwt-alias', 'Decode JWT', {
    aliases: ['jwt'], // display.aliases so name filter would also pass if ranking
    accepts: { aliases: ['jwt'] },
  })
  const weakUsageItem = item('plugin:p:launcher:noise', 'Noise Tool')
  let uWeak = emptyUsage
  // weak usage only — must not overcome alias intent magnitude
  uWeak = usage.recordSelection(uWeak, 'global-launcher', weakUsageItem.systemKey, now)
  const ctx = baseCtx({
    query: 'jwt',
    usage: uWeak,
  })
  const scoreAlias = ranking.scoreLauncherItem(ctx, jwtAlias)
  const scoreNoise = ranking.scoreLauncherItem(ctx, weakUsageItem)
  assert.ok(
    scoreAlias > scoreNoise,
    `alias intent should beat weak-usage noise: ${scoreAlias} > ${scoreNoise}`,
  )
}

// --- 3. 精确 title 匹配仍赢强 intent ---
{
  const jwtTool = item('plugin:encode-decode:launcher:jwt-decode-2', 'Decode JWT', {
    accepts: { kinds: ['jwt'] },
  })
  const chromeApp = item('host:app-launcher:app:chrome', 'Chrome', { kind: 'host' })
  const ctx = baseCtx({
    query: 'chrome',
    contentText: JWT_SAMPLE,
    detections: [{ kind: 'jwt', confidence: 0.95, normalized: JWT_SAMPLE }],
  })
  const ranked = ranking.rankLauncherItems(ctx, [jwtTool, chromeApp])
  assert.ok(ranked.length >= 1, 'chrome should remain a candidate')
  assert.equal(
    ranked[0].systemKey,
    chromeApp.systemKey,
    'exact title match (Chrome) must rank above strong jwt intent',
  )
}

// --- 4. contextBoost: accepts.apps + foregroundApp ---
{
  const safariTool = item('plugin:web:launcher:for-safari', 'Safari Action', {
    accepts: { apps: ['Safari'] },
  })
  const scoreWith = ranking.scoreLauncherItem(
    baseCtx({ query: '', foregroundApp: 'Safari' }),
    safariTool,
  )
  const scoreWithout = ranking.scoreLauncherItem(
    baseCtx({ query: '', foregroundApp: undefined }),
    safariTool,
  )
  const delta = scoreWith - scoreWithout
  assert.ok(delta > 0, `contextBoost should raise score when foreground matches: delta=${delta}`)
  assert.ok(delta <= 400, `contextBoost must be ≤ 400, got ${delta}`)
}

// --- 5. itemMatchesQuery includes accepts.aliases ---
{
  const fmtTool = item('plugin:json-tools:launcher:format', 'Format JSON', {
    aliases: undefined, // display.aliases empty
    accepts: { aliases: ['fmt'] },
  })
  assert.equal(
    ranking.itemMatchesQuery(fmtTool, 'fmt', 'en'),
    true,
    'accepts.aliases alone must make itemMatchesQuery true for short alias query',
  )
}

console.log('✓ test-launcher-intent-ranking passed')
