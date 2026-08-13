#!/usr/bin/env node
/**
 * Contract: self-learning P1 pure core.
 *   src/workspace/learning/features.ts  — extractFeatures / featureSignature / token helpers
 *   src/workspace/learning/pairing.ts   — normalizeEq / verifyTransformPair / verifyTransformChain
 *
 * These modules must stay pure (no imports) so the learner core is testable and
 * boundary-safe. Verification is deterministic "can we reproduce B from A?".
 *
 * Run: node scripts/test-learning-pairing.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

function loadModule(path) {
  const out = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
  }).outputText
  const moduleExports = {}
  const sandbox = { exports: moduleExports, module: { exports: moduleExports }, console }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports
}

const features = loadModule('src/workspace/learning/features.ts')
const pairing = loadModule('src/workspace/learning/pairing.ts')

// ─── features ──────────────────────────────────────────────────────────────
{
  const f = features.extractFeatures('a1b2c3d4e5')
  assert.equal(f.charset, 'hex', 'hex charset')
  assert.equal(f.len, 10, 'trimmed length')
  assert.equal(f.hasSpace, false)
  assert.equal(f.hasNewline, false)

  assert.equal(features.extractFeatures('1754966400').charset, 'digits', 'all-digits → digits')
  assert.equal(features.extractFeatures('  hello world  ').hasSpace, true, 'inner space detected')
  assert.equal(features.extractFeatures('a\nb\nc').lineCount, 3, 'line count')
  assert.equal(features.extractFeatures('https://code.byted.org/x').looksUrl, true, 'url shape')

  // Same-shape inputs must share a signature (clustering key).
  const s1 = features.featureSignature(features.extractFeatures('a1b2c3d4e5'))
  const s2 = features.featureSignature(features.extractFeatures('f9e8d7c6b5'))
  assert.equal(s1, s2, 'two SHAs share a feature signature')
  const s3 = features.featureSignature(features.extractFeatures('1754966400'))
  assert.notEqual(s1, s3, 'hex vs digits differ in signature')

  // token classification (scenario A/D)
  assert.equal(features.classifyToken('a1b2c3d4e5'), 'hex')
  assert.equal(features.classifyToken('1234567890'), 'number', 'all-digits → number, not hex')
  assert.equal(features.classifyToken('toutiao.service.api'), 'psm')
  assert.equal(features.classifyToken('550e8400-e29b-41d4-a716-446655440000'), 'uuid')
  assert.equal(features.isPlausibleToken('ab'), false, 'too short')
  assert.equal(features.isPlausibleToken('multi\nline'), false, 'multiline not a token')
  assert.equal(features.isPlausibleToken('"a1b2c3d4e5"'), true, 'quotes stripped, plausible')
}

// ─── normalizeEq ───────────────────────────────────────────────────────────
{
  assert.equal(pairing.normalizeEq('x', 'x'), true)
  assert.equal(pairing.normalizeEq('a  b', 'a b'), true, 'whitespace collapse')
  assert.equal(pairing.normalizeEq('{"a":1}', '{\n  "a": 1\n}'), true, 'json formatting tolerant')
  assert.equal(pairing.normalizeEq('{"a":1,"b":2}', '{"b":2,"a":1}'), true, 'json key-order tolerant')
  assert.equal(pairing.normalizeEq('foo', 'bar'), false)
}

// ─── verifyTransformPair (T(A) ≈ B) ────────────────────────────────────────
const runners = [
  {
    id: 'json.prettify',
    textMatch: (t) => { const s = t.trim(); return s[0] === '{' || s[0] === '[' },
    run: (t) => { try { return JSON.stringify(JSON.parse(t), null, 2) } catch { return null } },
  },
  {
    id: 'base64.decode',
    run: (t) => {
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(t) || t.length % 4 !== 0) return null
      try {
        const decoded = Buffer.from(t, 'base64').toString('utf8')
        return Buffer.from(decoded, 'utf8').toString('base64') === t ? decoded : null
      } catch { return null }
    },
  },
  {
    id: 'url.decode',
    run: (t) => { try { const d = decodeURIComponent(t); return d !== t ? d : null } catch { return null } },
  },
]

{
  const compact = '{"a":1,"b":[2,3]}'
  const pretty = JSON.stringify(JSON.parse(compact), null, 4) // different indent than runner
  const hit = pairing.verifyTransformPair(compact, pretty, runners)
  assert.ok(hit && hit.toolId === 'json.prettify', 'prettify pair verified across indent diff')

  const b64 = pairing.verifyTransformPair('aGVsbG8sIGhpdmVu', 'hello, hiven', runners)
  assert.ok(b64 && b64.toolId === 'base64.decode', 'base64 decode pair verified')

  assert.equal(pairing.verifyTransformPair('{"a":1}', '{"a":1}', runners), null, 'no-op is not a pair')
  assert.equal(pairing.verifyTransformPair('random', 'unrelated', runners), null, 'unrelated → no pair')
}

// ─── verifyTransformChain (scenario B: multi-step collapse) ─────────────────
{
  const encoded = '%7B%22a%22%3A1%7D'          // {"a":1} url-encoded
  const decoded = decodeURIComponent(encoded)   // {"a":1}
  const pretty = JSON.stringify(JSON.parse(decoded), null, 2)
  const chain = pairing.verifyTransformChain([encoded, decoded, pretty], runners)
  assert.ok(chain && chain.toolIds.length === 2, 'two-hop chain detected')
  // Note: chain.toolIds is created inside the vm realm — compare by value, not deepEqual.
  assert.equal(chain.toolIds.join(','), 'url.decode,json.prettify', 'chain order preserved')

  assert.equal(pairing.verifyTransformChain([encoded, decoded], runners), null, 'single hop is not a chain')
  assert.equal(
    pairing.verifyTransformChain([encoded, decoded, 'garbage-unrelated'], runners),
    null,
    'broken final hop → no chain',
  )
}

// ─── runChainWith (scenario B reverse fire — the real sequencer) ─────────────
{
  const lookup = (id) => runners.find((r) => r.id === id)
  const encoded = '%7B%22a%22%3A1%7D' // {"a":1} url-encoded

  // url.decode → json.prettify collapses to the formatted JSON.
  const out = pairing.runChainWith(lookup, ['url.decode', 'json.prettify'], encoded)
  assert.equal(out, JSON.stringify({ a: 1 }, null, 2), 'chain replays url-decode → json-prettify')

  // Guards: missing tool, declined textMatch, and no-op all return null.
  assert.equal(pairing.runChainWith(lookup, ['nope.missing'], encoded), null, 'missing tool → null')
  assert.equal(
    pairing.runChainWith(lookup, ['json.prettify'], encoded),
    null,
    'json.prettify declines a url-encoded (non-JSON) input',
  )
  assert.equal(pairing.runChainWith(lookup, [], encoded), null, 'empty chain → null')
}

console.log('test-learning-pairing: ok')
