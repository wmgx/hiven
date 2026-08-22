#!/usr/bin/env node
/**
 * Contract: scenario L1/L2 fire — source-scoped disambiguation symmetry.
 *   src/workspace/learning/fire.ts — sourceHostForQuery, learnedLauncherItems
 *
 * The exact failure class §3.6 of the design doc warns about: a rule that
 * LEARNS with one notion of "matches" and FIRES with another looks learned
 * (it's in the store, the management page shows it) but silently never
 * fires right. Here the two notions are "which site was this token copied
 * on" (learn time, urlTemplate.induceSourceScopedTemplates) and "which site
 * is this query's token associated with right now" (fire time). This test
 * locks that a scoped rule fires ONLY on a confirmed source match, and
 * — critically — that the SAME token shape learned on two different sites
 * disambiguates to the right one instead of firing both or picking blindly.
 *
 * fire.ts has many impure imports; strip + stub them all so we can load the
 * real module and call the real exported functions.
 *
 * Run: node scripts/test-learning-source-scope-fire.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

function loadModule(path, { stripImports = [], globals = {} } = {}) {
  let src = read(path)
  for (const re of stripImports) src = src.replace(re, '')
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
  }).outputText
  const moduleExports = {}
  const sandbox = { exports: moduleExports, module: { exports: moduleExports }, console, ...globals }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports
}

let clipboardTokens = [] // Array<{ token, sourceHost }>
let storedRules = [] // LearnedRule[]

const fire = loadModule('src/workspace/learning/fire.ts', {
  // One pattern per import path — a shared catch-all here would let one
  // pattern's non-greedy match swallow whichever import sits between two
  // matched paths (see test-learning-history-recall.mjs's note on this).
  stripImports: [
    /import\s+type\s*\{[\s\S]*?\}\s*from\s*'[^']*'\s*;?\s*\n?/g,
    /import\s*\{[\s\S]*?\}\s*from\s*'\.\.\/\.\.\/i18n'\s*;?\s*\n?/g,
    /import\s*\{[\s\S]*?\}\s*from\s*'\.\.\/effectRunner'\s*;?\s*\n?/g,
    /import\s*\{[\s\S]*?\}\s*from\s*'\.\.\/telemetry'\s*;?\s*\n?/g,
    /import\s*\{[\s\S]*?\}\s*from\s*'\.\/clipboardBrowserLink'\s*;?\s*\n?/g,
    /import\s*\{[\s\S]*?\}\s*from\s*'\.\/features'\s*;?\s*\n?/g,
    /import\s*\{[\s\S]*?\}\s*from\s*'\.\/frecency'\s*;?\s*\n?/g,
    /import\s*\{[\s\S]*?\}\s*from\s*'\.\/navigationSensor'\s*;?\s*\n?/g,
    /import\s*\{[\s\S]*?\}\s*from\s*'\.\/observer'\s*;?\s*\n?/g,
    /import\s*\{[\s\S]*?\}\s*from\s*'\.\/proposals'\s*;?\s*\n?/g,
    /import\s*\{[\s\S]*?\}\s*from\s*'\.\/registryRunners'\s*;?\s*\n?/g,
    /import\s*\{[\s\S]*?\}\s*from\s*'\.\/store'\s*;?\s*\n?/g,
    /import\s*\{[\s\S]*?\}\s*from\s*'\.\/urlTemplate'\s*;?\s*\n?/g,
  ],
  globals: {
    t: (_l, key) => key,
    openExternalUrl: async () => {},
    TelemetryEvents: { learningRuleFired: 'learningRuleFired' },
    trackBehavior: () => {},
    findHistoryRecall: () => [],
    extractFeatures: () => ({}),
    featureSignature: () => '',
    isPlausibleToken: (s) => typeof s === 'string' && s.trim().length >= 3 && !/\s/.test(s.trim()),
    normalizeToken: (s) => (s ?? '').trim(),
    FIRE_STRENGTH_BONUS: 1,
    firePriority: () => 50,
    getCurrentActiveHost: () => null,
    getRecentHistoryForRecall: () => [],
    getRecentClipboardTokensWithSource: () => clipboardTokens,
    isNewlyLearned: () => false,
    runLearnedChain: () => null,
    bumpRuleStrength: async () => {},
    pruneForgottenRules: async () => {},
    queryAllRules: async () => storedRules,
    fillTemplate: (template, value) => template.replace(/\{[^}]+\}/, value),
    // Real-enough stand-in covering this test's two shapes.
    queryMatchesSlot: (q, kind) => {
      const v = (q ?? '').trim()
      if (kind === 'hex') return /^[0-9a-f]{7,40}$/i.test(v)
      if (kind === 'n') return /^\d+$/.test(v)
      return false
    },
  },
})

function scopedRule(sourceHost, template) {
  return {
    clusterKey: `url-scoped:${sourceHost}:${template}`,
    matcherSig: `token:hex@${sourceHost}`,
    matcher: { kind: 'token', tokenKind: 'hex', sourceHost },
    transform: { kind: 'url-template', template, slotKind: 'hex' },
    descriptor: { charset: 'hex', lenBucket: '', flags: [], transform: { kind: 'url-template', template, slotKind: 'hex' } },
    strength: 5,
    origin: 'learned',
    createdAt: 0,
    sampleCount: 3,
    fireCount: 10, // established, not "newly learned" — keeps assertions to one item
  }
}

const TOKEN = 'a1b2c3d4e5'

// ─── unknown source (typed by hand, or stale) → scoped rule never fires ───────
storedRules = [scopedRule('grafana.byted.org', 'grafana.byted.org/d/{hex}')]
clipboardTokens = [] // no recent copy at all
await fire.refreshLearnedUrlRules()
assert.equal(fire.sourceHostForQuery(TOKEN), null, 'no recent copy → no known source')
assert.equal(fire.learnedLauncherItems(TOKEN, 'en').length, 0, 'unknown source → scoped rule skipped, not guessed')

// ─── confirmed match → fires, with the right destination ──────────────────────
clipboardTokens = [{ token: TOKEN, sourceHost: 'grafana.byted.org' }]
await fire.refreshLearnedUrlRules()
assert.equal(fire.sourceHostForQuery(TOKEN), 'grafana.byted.org')
{
  const items = fire.learnedLauncherItems(TOKEN, 'en')
  assert.equal(items.length, 1, 'confirmed source match → fires')
  assert.equal(items[0].display.subtitle, `https://grafana.byted.org/d/${TOKEN}`)
}

// ─── the disambiguation itself: same shape, two sites, only the right one fires ─
storedRules = [
  scopedRule('grafana.byted.org', 'grafana.byted.org/d/{hex}'),
  scopedRule('code.byted.org', 'code.byted.org/commit/{hex}'),
]
await fire.refreshLearnedUrlRules()

clipboardTokens = [{ token: TOKEN, sourceHost: 'code.byted.org' }]
{
  const items = fire.learnedLauncherItems(TOKEN, 'en')
  assert.equal(items.length, 1, 'copied on code.byted.org → exactly one item, not both candidates')
  assert.equal(items[0].display.subtitle, `https://code.byted.org/commit/${TOKEN}`, 'the RIGHT destination, not a guess')
}

clipboardTokens = [{ token: TOKEN, sourceHost: 'grafana.byted.org' }]
{
  const items = fire.learnedLauncherItems(TOKEN, 'en')
  assert.equal(items.length, 1, 'same shape, copied on grafana instead → the OTHER destination')
  assert.equal(items[0].display.subtitle, `https://grafana.byted.org/d/${TOKEN}`)
}

// ─── unscoped (plain scenario D) rule is unaffected by any of this ────────────
storedRules = [
  {
    clusterKey: 'url:x.org/mr/{n}',
    matcherSig: 'token:n',
    matcher: { kind: 'token', tokenKind: 'n' },
    transform: { kind: 'url-template', template: 'x.org/mr/{n}', slotKind: 'n' },
    descriptor: { charset: 'n', lenBucket: '', flags: [], transform: { kind: 'url-template', template: 'x.org/mr/{n}', slotKind: 'n' } },
    strength: 5,
    origin: 'learned',
    createdAt: 0,
    sampleCount: 3,
    fireCount: 10,
  },
]
clipboardTokens = [] // no source context at all — must not matter for an unscoped rule
await fire.refreshLearnedUrlRules()
{
  const items = fire.learnedLauncherItems('123456', 'en')
  assert.equal(items.length, 1, 'unscoped (plain scenario D) rule fires regardless of clipboard source context')
  assert.equal(items[0].display.subtitle, 'https://x.org/mr/123456')
}

console.log('test-learning-source-scope-fire: ok')
