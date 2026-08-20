#!/usr/bin/env node
/**
 * Contract: position-variance induction — finding TEXT variables from browsing alone.
 *   src/workspace/learning/positionVariance.ts
 *
 * classifyPathSegment is deliberately conservative: from one URL you cannot tell
 * whether `merge_requests` is a constant and `claude-code` is a variable — both
 * are just text. So the shape heuristic only claims self-evident ids (digits,
 * hex, uuid), and `github.com/{owner}/{repo}` is invisible to it.
 *
 * Cross-sample evidence settles it: watch the same host+shape over several
 * visits and a position that takes many DIFFERENT values is a variable, whatever
 * it looks like; a position that never changes is part of the path.
 *
 * Privacy: works on salted hashes, never raw segments — distinct-counting needs
 * only equality.
 *
 * Run: node scripts/test-learning-position-variance.mjs
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

const P = loadModule('src/workspace/learning/positionVariance.ts')

const obs = (host, segments, ts = 0) => ({ host, segmentHashes: segments, ts })

// ─── 1. github.com/{owner}/{repo} — both positions vary, neither is id-shaped ─
{
  const observations = [
    obs('github.com', ['anthropics', 'claude-code'], 1),
    obs('github.com', ['facebook', 'react'], 2),
    obs('github.com', ['vuejs', 'core'], 3),
    obs('github.com', ['rust-lang', 'rust'], 4),
  ]
  const found = P.induceVariablePositions(observations)
  assert.equal(found.length, 1, 'one shape discovered')
  assert.equal(found[0].host, 'github.com')
  assert.equal(found[0].segmentCount, 2)
  assert.deepEqual(
    [...found[0].variableIndices],
    [0, 1],
    'both owner and repo are variables — the shape heuristic can see neither',
  )
}

// ─── 2. constants stay constant ──────────────────────────────────────────────
{
  const observations = [1, 2, 3, 4].map((n) =>
    obs('code.byted.org', ['lark', 'backend', '-', 'merge_requests', `h${n}`], n),
  )
  const found = P.induceVariablePositions(observations)
  assert.equal(found.length, 1)
  assert.deepEqual(
    [...found[0].variableIndices],
    [4],
    'only the trailing id varies; merge_requests and friends are path constants',
  )
}

// ─── 3. one page reloaded is not a template ──────────────────────────────────
{
  const observations = [1, 2, 3, 4, 5].map((n) => obs('example.org', ['docs', 'intro'], n))
  assert.equal(
    P.induceVariablePositions(observations).length,
    0,
    'nothing varies → no template',
  )
}

// ─── 4. evidence thresholds ──────────────────────────────────────────────────
{
  // Two distinct values is a coincidence, not a pattern.
  const thin = [
    obs('x.org', ['a', 'p1'], 1),
    obs('x.org', ['a', 'p2'], 2),
  ]
  assert.equal(P.induceVariablePositions(thin).length, 0, 'two samples is not enough')

  const enough = [
    obs('x.org', ['a', 'p1'], 1),
    obs('x.org', ['a', 'p2'], 2),
    obs('x.org', ['a', 'p3'], 3),
  ]
  assert.equal(P.induceVariablePositions(enough).length, 1, 'three distinct values qualifies')
  assert.equal(P.induceVariablePositions(enough, { minDistinct: 4 }).length, 0, 'threshold honored')
}

// ─── 5. different path lengths are different shapes ──────────────────────────
{
  const observations = [
    obs('x.org', ['a', 'p1'], 1),
    obs('x.org', ['a', 'p2'], 2),
    obs('x.org', ['a', 'p3'], 3),
    obs('x.org', ['a', 'b', 'q1'], 4),
    obs('x.org', ['a', 'b', 'q2'], 5),
    obs('x.org', ['a', 'b', 'q3'], 6),
  ]
  const found = P.induceVariablePositions(observations)
  assert.equal(found.length, 2, '/a/{x} and /a/b/{y} are separate shapes')
  // join, not deepEqual: sandbox arrays are cross-realm.
  assert.equal([...found].map((f) => f.segmentCount).sort().join(','), '2,3')
}

// ─── 6. GUARDRAIL: a path where everything varies is not a template ──────────
// `cdn.example.com/{a}/{b}/{c}` matches everything and means nothing.
{
  const observations = [1, 2, 3, 4].map((n) => obs('cdn.x.org', [`a${n}`, `b${n}`, `c${n}`], n))
  assert.equal(
    P.induceVariablePositions(observations).length,
    0,
    'all-variable paths are rejected as over-broad',
  )
}

// ─── 7. GUARDRAIL: too many variable slots is over-broad too ─────────────────
{
  const observations = [1, 2, 3, 4].map((n) =>
    obs('x.org', ['fixed', `a${n}`, `b${n}`, `c${n}`], n),
  )
  assert.equal(
    P.induceVariablePositions(observations).length,
    0,
    'three variable slots is too loose to be a useful rule',
  )
}

// ─── 8. hosts are independent ────────────────────────────────────────────────
{
  const observations = [
    ...[1, 2, 3].map((n) => obs('a.org', ['x', `v${n}`], n)),
    ...[1, 2, 3].map((n) => obs('b.org', ['x', 'same'], n + 10)),
  ]
  const found = P.induceVariablePositions(observations)
  assert.equal(found.length, 1, 'only a.org has a varying position')
  assert.equal(found[0].host, 'a.org')
}

// ─── 9. template building from a concrete path + known variable positions ────
// Induction runs on hashes; the template needs the literal constants, so it is
// built from ONE concrete observation once the variable positions are known.
{
  const template = P.buildTemplateFromPositions(
    'github.com',
    ['anthropics', 'claude-code'],
    [0, 1],
    ['slug', 'slug'],
  )
  assert.equal(template, 'github.com/{slug}/{slug}', 'variable positions become typed slots')

  const mr = P.buildTemplateFromPositions(
    'code.byted.org',
    ['lark', 'backend', '-', 'merge_requests', '9931'],
    [4],
    ['n'],
  )
  assert.equal(
    mr,
    'code.byted.org/lark/backend/-/merge_requests/{n}',
    'constants are preserved literally',
  )

  assert.equal(
    P.buildTemplateFromPositions('x.org', ['a', 'b'], [], []),
    null,
    'no variable positions → no template',
  )
  assert.equal(
    P.buildTemplateFromPositions('x.org', ['a', 'b'], [5], ['n']),
    null,
    'out-of-range index rejected',
  )
}

// ─── 10. purity: usable standalone, no imports, no raw-URL knowledge ─────────
{
  const src = read('src/workspace/learning/positionVariance.ts')
  assert.doesNotMatch(src, /^import .*from/m, 'pure core: no imports')
  assert.equal(src.includes('http'), false, 'operates on parsed pieces, not URLs')
}

console.log('test-learning-position-variance: ok')
