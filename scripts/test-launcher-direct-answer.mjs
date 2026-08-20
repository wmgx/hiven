#!/usr/bin/env node
/**
 * Contract: direct-answer items are first-class in ranking.
 *   src/workspace/launcher/ranking.ts — itemMatchesQuery / staticPriority / shouldKeepOnEmptyQuery
 *
 * A direct answer IS the answer to what the user typed — its title is the RESULT
 * ("1,234" for "1000+234", a decoded payload for a JWT), which by construction
 * does not contain the query text. The query-present filter would therefore drop
 * exactly the items that answered.
 *
 * Learned rules used to work around this by claiming `kind:'dynamic'` and
 * self-matching via `aliases:[query]`. That silently cost them their priority:
 * staticPriority() only honored `kind==='host'`, so frecency weighting (P3) and
 * fire-time host disambiguation never affected the order. This contract pins the
 * first-class behavior so neither workaround is needed again.
 *
 * Run: node scripts/test-launcher-direct-answer.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function loadTs(path, importStubs = []) {
  let src = readFileSync(path, 'utf8')
  for (const [importMatch, replacement] of importStubs) {
    src = src.replace(importMatch, replacement)
  }
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
  }).outputText
  const moduleExports = {}
  const requireShim = (id) => {
    if (id === 'pinyin-pro') return { pinyin: (t) => t }
    throw new Error('unexpected require: ' + id)
  }
  const sandbox = { exports: moduleExports, module: { exports: moduleExports }, console, require: requireShim }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports
}

const searchRanking = loadTs('src/workspace/searchRanking.ts')
const usage = loadTs('src/workspace/launcher/usage.ts', [
  [/import\s*\{[^}]*\}\s*from\s*'\.\/types'\s*;?\s*\n?/, "const LAUNCHER_SURFACE_IDS=['command-palette','editor-command-bar','global-launcher'];\nconst normalizeLauncherSurfaceId=(surfaceId)=>surfaceId==='command-palette'?'editor-command-bar':surfaceId;\n"],
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
  // intentEngine helpers are optional for these assertions
}
vm.runInNewContext(rankingOut, sandbox)
const ranking = sandbox.module.exports

function item(systemKey, title, opts = {}) {
  return {
    systemKey,
    kind: opts.kind ?? 'plugin',
    display: { title, subtitle: opts.subtitle, aliases: opts.aliases },
    behavior: { type: 'perform' },
    staticPriority: opts.staticPriority,
    directAnswer: opts.directAnswer,
    accepts: opts.accepts,
    execute: () => ({ ok: true }),
  }
}

const now = 1_000_000_000_000
const emptyUsage = usage.emptyUsageBySurface()
const baseCtx = (over = {}) => ({
  query: '',
  locale: 'en',
  surfaceId: 'global-launcher',
  usage: emptyUsage,
  now,
  ...over,
})

// ─── 1. a direct answer survives the query-present filter ────────────────────
// The user typed an MR id; the answer's title is the destination, not the id.
{
  const query = 'PROJ-1234'
  const answer = item('learned-url:abc', 'Open on code.byted.org', {
    kind: 'dynamic',
    subtitle: 'https://code.byted.org/x/-/issues/PROJ-1234',
    directAnswer: { priority: 120, origin: 'learned' },
  })
  assert.equal(
    ranking.itemMatchesQuery(answer, query, 'en'),
    true,
    'direct answer must survive the query-present filter without self-matching aliases',
  )

  // And it must do so WITHOUT the alias workaround.
  assert.equal(
    answer.display.aliases,
    undefined,
    'the contract is that no aliases:[query] hack is needed',
  )
}

// ─── 2. a non-answer item still has to match ─────────────────────────────────
{
  const unrelated = item('plugin:p:tool', 'Unrelated Tool', { kind: 'dynamic' })
  assert.equal(
    ranking.itemMatchesQuery(unrelated, 'PROJ-1234', 'en'),
    false,
    'ordinary items still require a text match — the exemption is only for answers',
  )
}

// ─── 3. direct-answer priority actually affects the score ────────────────────
// This is the regression that silently broke: staticPriority() only honored
// kind==='host', so learned items (kind:'dynamic') always scored priority 0 and
// frecency/host-disambiguation could not reorder them.
{
  const ctx = baseCtx({ query: 'PROJ-1234' })
  const strong = item('learned-url:strong', 'Open on a.org', {
    kind: 'dynamic',
    directAnswer: { priority: 200, origin: 'learned' },
  })
  const weak = item('learned-url:weak', 'Open on b.org', {
    kind: 'dynamic',
    directAnswer: { priority: 10, origin: 'learned' },
  })
  const strongScore = ranking.scoreLauncherItem(ctx, strong)
  const weakScore = ranking.scoreLauncherItem(ctx, weak)
  assert.ok(
    strongScore > weakScore,
    `higher direct-answer priority must rank higher: ${strongScore} > ${weakScore}`,
  )
  assert.equal(
    strongScore - weakScore,
    190,
    'the full priority delta is applied (not clamped away or ignored)',
  )
}

// ─── 4. priority is clamped like staticPriority (no score takeover) ──────────
{
  const ctx = baseCtx({ query: 'x' })
  const sane = item('learned:sane', 'A', { kind: 'dynamic', directAnswer: { priority: 300 } })
  const absurd = item('learned:absurd', 'A', { kind: 'dynamic', directAnswer: { priority: 999999 } })
  assert.equal(
    ranking.scoreLauncherItem(ctx, absurd),
    ranking.scoreLauncherItem(ctx, sane),
    'direct-answer priority is clamped to the same ceiling as staticPriority (300)',
  )

  const negative = item('learned:neg', 'A', { kind: 'dynamic', directAnswer: { priority: -500 } })
  const zero = item('learned:zero', 'A', { kind: 'dynamic', directAnswer: { priority: 0 } })
  assert.equal(
    ranking.scoreLauncherItem(ctx, negative),
    ranking.scoreLauncherItem(ctx, zero),
    'negative priority floors at 0 — a direct answer cannot be pushed below baseline',
  )
}

// ─── 5. regression: host staticPriority still works ──────────────────────────
{
  const ctx = baseCtx({ query: 'settings' })
  const hostHigh = item('host:a', 'Settings', { kind: 'host', staticPriority: 200 })
  const hostLow = item('host:b', 'Settings', { kind: 'host', staticPriority: 10 })
  assert.equal(
    ranking.scoreLauncherItem(ctx, hostHigh) - ranking.scoreLauncherItem(ctx, hostLow),
    190,
    'existing host staticPriority behavior is unchanged',
  )

  // A plugin item's staticPriority is still ignored (host-only, as before).
  const pluginWithPriority = item('plugin:x', 'Settings', { kind: 'plugin', staticPriority: 300 })
  const pluginPlain = item('plugin:y', 'Settings', { kind: 'plugin' })
  assert.equal(
    ranking.scoreLauncherItem(ctx, pluginWithPriority),
    ranking.scoreLauncherItem(ctx, pluginPlain),
    'plugin-declared staticPriority is still ignored',
  )
}

// ─── 6. direct answers are kept on empty open (zero-query answers) ───────────
{
  const ctx = baseCtx({ query: '' })
  const answer = item('learned:clip', '1,234', { kind: 'plugin', directAnswer: { priority: 50 } })
  assert.equal(
    ranking.shouldKeepOnEmptyQuery(answer, 0, ctx),
    true,
    'a zero-query direct answer (clipboard content already computed) is kept',
  )
}

// ─── 7. plugins may DECLARE answer semantics, but not their own priority ─────
// Otherwise every plugin would claim to be a direct answer with priority 300 and
// the answer area becomes another ranking brawl. Same host/plugin split that
// already applies to staticPriority.
{
  const normalize = loadTs('src/workspace/launcher/normalizeContribution.ts', [
    [/import\s+type\s*\{[\s\S]*?\}\s*from\s*'\.\/types'\s*;?\s*\n?/, ''],
    [/import\s+type\s*\{[^}]*\}\s*from\s*'\.\.\/pluginTypes'\s*;?\s*\n?/, ''],
    [/import\s*\{[^}]*\}\s*from\s*'\.\/identity'\s*;?\s*\n?/, 'const sanitizeSurfaces=(s)=>s;\n'],
    [/import\s*\{[^}]*\}\s*from\s*'\.\/pluginSource'\s*;?\s*\n?/, 'const resolvePluginSettingsSource=(_p,s)=>s;\n'],
  ])
  const opts = { systemKey: 'plugin:calc:x', kind: 'dynamic', pluginId: 'calc', source: 'builtin' }

  const declared = normalize.normalizeContribution(
    { id: 'x', display: { title: '1,234' }, directAnswer: true, execute: () => ({ ok: true }) },
    opts,
  )
  assert.ok(declared.directAnswer, 'a plugin can declare itself a direct answer')
  assert.equal(declared.directAnswer.origin, 'builtin', 'plugin-declared answers are builtin-origin')
  assert.ok(
    declared.directAnswer.priority > 0 && declared.directAnswer.priority < 45,
    `plugin answer priority is host-assigned and below the learned baseline (45), got ${declared.directAnswer.priority}`,
  )

  const notDeclared = normalize.normalizeContribution(
    { id: 'y', display: { title: 'Some Command' }, execute: () => ({ ok: true }) },
    opts,
  )
  assert.equal(notDeclared.directAnswer, undefined, 'ordinary contributions are not answers')

  // A plugin passing an object (trying to set its own priority) gets the host
  // value anyway — the field is boolean-only in the authoring protocol.
  const sneaky = normalize.normalizeContribution(
    { id: 'z', display: { title: 'x' }, directAnswer: { priority: 300 }, execute: () => ({ ok: true }) },
    opts,
  )
  assert.ok(
    sneaky.directAnswer.priority < 45,
    'a plugin cannot smuggle its own priority through the directAnswer field',
  )
}

console.log('test-launcher-direct-answer: ok')
