#!/usr/bin/env node
/**
 * Contract: two-level hybrid Intent engine
 *   evaluateAccepts(accepts, ctx) → boolean  (pure data filter; never calls match)
 *   runIntentMatchers(matchers, ctx, options?) → IntentHit[]
 *
 * evaluateAccepts pathway OR (content | alias | apps):
 *   - content path active when kinds and/or regex declared; active dimensions AND
 *   - alias path active when aliases declared; needs normalized query hit
 *   - apps path active when apps declared; needs foregroundApp hit
 *   - final true when at least one active path succeeds
 *   - no path declared: undefined/null → false; {} → vacuous true
 *
 * Expects:
 *   src/workspace/launcher/intentTypes.ts
 *   src/workspace/launcher/intentEngine.ts  exporting evaluateAccepts, runIntentMatchers
 *
 * Red-test strategy: missing entry / import / export → FAIL until implementation lands.
 *
 * Run: node scripts/test-intent-engine.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const INTENT_ENGINE = path.join(ROOT, 'src/workspace/launcher/intentEngine.ts')
const INTENT_TYPES = path.join(ROOT, 'src/workspace/launcher/intentTypes.ts')

/**
 * Transpile a TypeScript module graph rooted at `entryPath` with relative
 * `.ts` / extensionless imports resolved against the filesystem.
 * Type-only imports are stripped by transpile; value imports must resolve.
 */
function loadTsModule(entryPath) {
  const cache = new Map()

  function resolve(fromFile, specifier) {
    if (!specifier.startsWith('.')) {
      throw new Error(`Unexpected non-relative import "${specifier}" from ${fromFile}`)
    }
    const base = path.resolve(path.dirname(fromFile), specifier)
    const candidates = [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      path.join(base, 'index.ts'),
      path.join(base, 'index.tsx'),
    ]
    for (const candidate of candidates) {
      if (existsSync(candidate) && !candidate.endsWith(path.sep)) {
        return candidate
      }
    }
    throw new Error(`Cannot resolve "${specifier}" from ${fromFile} (looked under ${base})`)
  }

  function load(filePath) {
    const abs = path.resolve(filePath)
    if (cache.has(abs)) return cache.get(abs)

    if (!existsSync(abs)) {
      throw new Error(`module missing: ${abs}`)
    }

    const source = readFileSync(abs, 'utf8')
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2023,
        esModuleInterop: true,
      },
      fileName: abs,
    })

    const module = { exports: {} }
    const sandbox = {
      module,
      exports: module.exports,
      console,
      Date,
      JSON,
      Math,
      Number,
      String,
      RegExp,
      Array,
      Object,
      Boolean,
      Error,
      TypeError,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      Buffer,
      TextEncoder,
      TextDecoder,
      performance: globalThis.performance,
      setTimeout,
      clearTimeout,
      require(specifier) {
        const resolved = resolve(abs, specifier)
        return load(resolved)
      },
    }

    cache.set(abs, module.exports)
    vm.runInNewContext(outputText, sandbox, { filename: abs })
    const exported = sandbox.module.exports
    cache.set(abs, exported)
    return exported
  }

  return load(entryPath)
}

function detection(kind, overrides = {}) {
  return {
    kind,
    confidence: overrides.confidence ?? 0.95,
    normalized: overrides.normalized ?? kind,
    ...(overrides.captures ? { captures: overrides.captures } : {}),
  }
}

function baseCtx(overrides = {}) {
  return {
    query: '',
    locale: 'en',
    context: {},
    detections: [],
    ...overrides,
  }
}

function hit(id, confidence = 0.9, targetId = id) {
  return {
    id,
    confidence,
    target: { kind: 'command', id: targetId },
    reason: 'content',
  }
}

// ─── Load intent engine (expected FAIL until implementation lands) ───────────
assert.ok(existsSync(INTENT_TYPES), `intentTypes missing: ${INTENT_TYPES}`)
assert.ok(existsSync(INTENT_ENGINE), `intentEngine missing: ${INTENT_ENGINE}`)

const engine = loadTsModule(INTENT_ENGINE)
const { evaluateAccepts, runIntentMatchers } = engine
assert.equal(typeof evaluateAccepts, 'function', 'intentEngine must export evaluateAccepts')
assert.equal(typeof runIntentMatchers, 'function', 'intentEngine must export runIntentMatchers')

// ─── 1. evaluateAccepts(undefined) → false ───────────────────────────────────
{
  const ok = evaluateAccepts(undefined, baseCtx({ detections: [detection('jwt')] }))
  assert.equal(ok, false, 'evaluateAccepts(undefined) must be false (no accepts → no intent)')
}

// ─── 2. kinds match detections → true ────────────────────────────────────────
{
  const ok = evaluateAccepts(
    { kinds: ['jwt'] },
    baseCtx({ detections: [detection('jwt')], contentText: 'eyJhbGciOiJIUzI1NiJ9.e30.sig' }),
  )
  assert.equal(ok, true, 'kinds:jwt with detection jwt must accept')
}

// ─── 3. kinds mismatch → false ───────────────────────────────────────────────
{
  const ok = evaluateAccepts(
    { kinds: ['jwt'] },
    baseCtx({ detections: [detection('csv')], contentText: 'a,b\n1,2' }),
  )
  assert.equal(ok, false, 'kinds:jwt with only csv detection must reject')
}

// ─── 4. regex matches contentText ────────────────────────────────────────────
{
  const ok = evaluateAccepts(
    { regex: '^eyJ[A-Za-z0-9_-]+\\.' },
    baseCtx({
      contentText: 'eyJhbGciOiJIUzI1NiJ9.e30.sig',
      detections: [],
    }),
  )
  assert.equal(ok, true, 'regex must match against contentText')
}

{
  const ok = evaluateAccepts(
    { regex: '^eyJ[A-Za-z0-9_-]+\\.' },
    baseCtx({ contentText: 'not-a-jwt', detections: [] }),
  )
  assert.equal(ok, false, 'regex must reject non-matching contentText')
}

// ─── 5. aliases: normalized query hits (case-insensitive) ────────────────────
{
  const ok = evaluateAccepts(
    { aliases: ['jwt'] },
    baseCtx({ query: 'JWT', detections: [] }),
  )
  assert.equal(ok, true, 'aliases must hit after query normalization (JWT vs jwt)')
}

{
  const ok = evaluateAccepts(
    { aliases: ['jwt decode'] },
    baseCtx({ query: '  JWT   Decode  ', detections: [] }),
  )
  assert.equal(ok, true, 'aliases must tolerate whitespace normalization')
}

{
  const ok = evaluateAccepts(
    { aliases: ['jwt'] },
    baseCtx({ query: 'base64', detections: [] }),
  )
  assert.equal(ok, false, 'aliases must reject non-matching query')
}

// ─── 6. apps: foregroundApp hit ──────────────────────────────────────────────
{
  const ok = evaluateAccepts(
    { apps: ['Google Chrome', 'Safari'] },
    baseCtx({ foregroundApp: 'Google Chrome', detections: [] }),
  )
  assert.equal(ok, true, 'apps must accept matching foregroundApp')
}

{
  const ok = evaluateAccepts(
    { apps: ['Google Chrome'] },
    baseCtx({ foregroundApp: 'Terminal', detections: [] }),
  )
  assert.equal(ok, false, 'apps must reject non-matching foregroundApp')
}

// ─── 6b. multi-path accepts: pathway OR (content | alias | apps) ─────────────
// Final true when at least one *active* path succeeds. Paths do not AND together.
// content = kinds/regex (AND within path when both present)
// alias   = aliases
// apps    = apps
{
  // 1) kinds+aliases, query hits alias, no detections → alias path alone
  const ok = evaluateAccepts(
    { kinds: ['jwt'], aliases: ['jwt'] },
    baseCtx({ query: 'JWT', detections: [] }),
  )
  assert.equal(
    ok,
    true,
    'pathway OR: kinds+aliases with query JWT and empty detections must accept via alias only',
  )
}

{
  // 2) kinds+aliases, empty query, jwt detection → content path alone
  const ok = evaluateAccepts(
    { kinds: ['jwt'], aliases: ['jwt'] },
    baseCtx({ query: '', detections: [detection('jwt')] }),
  )
  assert.equal(
    ok,
    true,
    'pathway OR: kinds+aliases with empty query and jwt detection must accept via content only',
  )
}

{
  // 3) kinds+aliases, empty query, no jwt detection → no path succeeds
  const ok = evaluateAccepts(
    { kinds: ['jwt'], aliases: ['jwt'] },
    baseCtx({ query: '', detections: [detection('csv')] }),
  )
  assert.equal(
    ok,
    false,
    'pathway OR: kinds+aliases with empty query and non-jwt detections must reject',
  )
}

{
  // 4) kinds wants json, alias hits fmt, detections are jwt only → alias path
  const ok = evaluateAccepts(
    { kinds: ['json'], aliases: ['fmt'] },
    baseCtx({ query: 'fmt', detections: [detection('jwt')] }),
  )
  assert.equal(
    ok,
    true,
    'pathway OR: kinds:json + aliases:fmt with query fmt and jwt-only detections must accept via alias',
  )
}

{
  // 5) apps+kinds, Safari foreground, no detections → apps path alone
  const ok = evaluateAccepts(
    { apps: ['Safari'], kinds: ['url'] },
    baseCtx({ foregroundApp: 'Safari', detections: [] }),
  )
  assert.equal(
    ok,
    true,
    'pathway OR: apps+kinds with Safari foreground and empty detections must accept via apps only',
  )
}

{
  // 6) apps miss, url content hit → content path alone still succeeds
  const ok = evaluateAccepts(
    { apps: ['Safari'], kinds: ['url'] },
    baseCtx({
      foregroundApp: 'Terminal',
      detections: [detection('url')],
    }),
  )
  assert.equal(
    ok,
    true,
    'pathway OR: apps miss + url detection must still accept via content path',
  )
}

// ─── 7. accepts miss → match() MUST NOT be called ────────────────────────────
{
  let matchCalled = false
  const matchers = [
    {
      id: 'jwt-decode',
      pluginId: 'encode-decode',
      accepts: { kinds: ['jwt'] },
      match() {
        matchCalled = true
        return [hit('jwt-decode')]
      },
    },
  ]
  const hits = runIntentMatchers(
    matchers,
    baseCtx({ detections: [detection('csv')], contentText: 'a,b' }),
  )
  assert.equal(matchCalled, false, 'match must not run when accepts misses')
  assert.ok(Array.isArray(hits), 'runIntentMatchers must return an array')
  assert.equal(hits.length, 0, 'accepts miss yields no hits')
}

// ─── 8. accepts hit, no match → no auto hit (length 0) ───────────────────────
{
  const matchers = [
    {
      id: 'jwt-tool',
      pluginId: 'encode-decode',
      accepts: { kinds: ['jwt'] },
      // no match field
    },
  ]
  const hits = runIntentMatchers(
    matchers,
    baseCtx({ detections: [detection('jwt')] }),
  )
  assert.equal(
    hits.length,
    0,
    'accepts-only matcher must not auto-create hits (recommendation layer boosts separately)',
  )
}

// ─── 9. match returns hits → included ────────────────────────────────────────
{
  const expected = hit('jwt-decode', 0.92, 'plugin:encode-decode:jwt-decode')
  const matchers = [
    {
      id: 'jwt-decode',
      pluginId: 'encode-decode',
      accepts: { kinds: ['jwt'] },
      match() {
        return [expected]
      },
    },
  ]
  const hits = runIntentMatchers(
    matchers,
    baseCtx({ detections: [detection('jwt')] }),
  )
  assert.equal(hits.length, 1, 'match hits must be included')
  assert.equal(hits[0].id, expected.id)
  assert.equal(hits[0].confidence, expected.confidence)
  assert.deepEqual(hits[0].target, expected.target)
}

// ─── 10. match throws → isolated; other matchers still contribute ────────────
{
  const matchers = [
    {
      id: 'bad',
      pluginId: 'plugin-a',
      accepts: { kinds: ['jwt'] },
      match() {
        throw new Error('boom from matcher')
      },
    },
    {
      id: 'good',
      pluginId: 'plugin-b',
      accepts: { kinds: ['jwt'] },
      match() {
        return [hit('good-hit', 0.8)]
      },
    },
  ]
  const hits = runIntentMatchers(
    matchers,
    baseCtx({ detections: [detection('jwt')] }),
  )
  assert.ok(
    hits.some((h) => h.id === 'good-hit'),
    'throwing matcher must not block other matchers',
  )
  assert.ok(
    !hits.some((h) => h.id === 'bad'),
    'throwing matcher must contribute no hits',
  )
}

// ─── 11. match timeout → discarded ───────────────────────────────────────────
// Contract: options.matchTimeoutMs (default 8) + optional options.now() clock.
// After match returns, if elapsed > budget, that matcher's hits are dropped.
{
  let clock = 0
  const matchers = [
    {
      id: 'slow',
      pluginId: 'plugin-slow',
      accepts: { kinds: ['jwt'] },
      match() {
        // Advance injectable clock beyond budget while "running"
        clock += 50
        return [hit('slow-hit', 0.99)]
      },
    },
    {
      id: 'fast',
      pluginId: 'plugin-fast',
      accepts: { kinds: ['jwt'] },
      match() {
        // negligible advance
        clock += 1
        return [hit('fast-hit', 0.7)]
      },
    },
  ]
  const hits = runIntentMatchers(
    matchers,
    baseCtx({ detections: [detection('jwt')] }),
    {
      matchTimeoutMs: 8,
      now: () => clock,
    },
  )
  assert.ok(
    !hits.some((h) => h.id === 'slow-hit'),
    'timed-out matcher hits must be discarded',
  )
  assert.ok(
    hits.some((h) => h.id === 'fast-hit'),
    'non-timed-out matcher hits must remain',
  )
}

// ─── 12. maxHitsPerPlugin / maxHitsGlobal truncation ─────────────────────────
{
  const manyFromOnePlugin = Array.from({ length: 6 }, (_, i) => hit(`p1-${i}`, 0.9 - i * 0.01))
  const manyFromOther = Array.from({ length: 6 }, (_, i) => hit(`p2-${i}`, 0.85 - i * 0.01))
  const moreGlobal = Array.from({ length: 6 }, (_, i) => hit(`p3-${i}`, 0.8 - i * 0.01))

  const matchers = [
    {
      id: 'm1',
      pluginId: 'plugin-1',
      accepts: { kinds: ['jwt'] },
      match: () => manyFromOnePlugin,
    },
    {
      id: 'm2',
      pluginId: 'plugin-2',
      accepts: { kinds: ['jwt'] },
      match: () => manyFromOther,
    },
    {
      id: 'm3',
      pluginId: 'plugin-3',
      accepts: { kinds: ['jwt'] },
      match: () => moreGlobal,
    },
  ]

  // Per-plugin cap: default maxHitsPerPlugin = 3
  const perPlugin = runIntentMatchers(
    matchers.slice(0, 1),
    baseCtx({ detections: [detection('jwt')] }),
    { maxHitsPerPlugin: 3, maxHitsGlobal: 100 },
  )
  assert.ok(perPlugin.length <= 3, `maxHitsPerPlugin=3 must cap hits, got ${perPlugin.length}`)
  assert.equal(perPlugin.length, 3, 'exactly 3 hits kept per plugin when 6 returned')

  // Global cap: maxHitsGlobal = 5 across plugins (each may return more)
  const global = runIntentMatchers(
    matchers,
    baseCtx({ detections: [detection('jwt')] }),
    { maxHitsPerPlugin: 3, maxHitsGlobal: 5 },
  )
  assert.ok(global.length <= 5, `maxHitsGlobal=5 must cap total hits, got ${global.length}`)
  assert.equal(global.length, 5, 'exactly 5 global hits when plenty available')
}

// ─── Bonus: null match return treated as empty (not throw) ───────────────────
{
  const matchers = [
    {
      id: 'nullish',
      pluginId: 'plugin-null',
      accepts: { kinds: ['jwt'] },
      match: () => null,
    },
  ]
  const hits = runIntentMatchers(
    matchers,
    baseCtx({ detections: [detection('jwt')] }),
  )
  assert.equal(hits.length, 0, 'match returning null yields zero hits')
}

console.log('test-intent-engine: all contract assertions passed')
