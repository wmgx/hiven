#!/usr/bin/env node
/**
 * Contract: self-learning P2 pure cores.
 *   src/workspace/learning/cluster.ts   — clusterPairs / isOverBroad / selectProposableCandidates
 *   src/workspace/learning/proposals.ts — describeCandidate / ruleFromCandidate / filterProposableCandidates
 *
 * Must stay pure (only `import type`, erased at runtime) so the induction core is
 * testable and boundary-safe. Verifies evidence thresholds, distinct-input guard,
 * conservative feature-sig matcher, over-broad rejection, descriptor parsing,
 * rule minting, and proposal filtering (dedup vs learned/suppressed, cap).
 *
 * Run: node scripts/test-learning-cluster.mjs
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

const cluster = loadModule('src/workspace/learning/cluster.ts')
const proposals = loadModule('src/workspace/learning/proposals.ts')
const coverage = loadModule('src/workspace/learning/coverage.ts')

const HEX = 'cs:hex|len:m'
const JSON_SIG = 'cs:mixed|len:l|ml'

// Build a pair with sensible defaults.
const pair = (over) => ({ ts: 1000, kind: 'transform', inSig: HEX, toolId: 'x.decode', ...over })

// ─── clusterPairs: evidence threshold ────────────────────────────────────────
{
  // 2 pairs (distinct) < default minSamples(3) → no candidate.
  const two = [pair({ inHash: 'a', ts: 1 }), pair({ inHash: 'b', ts: 2 })]
  assert.equal(cluster.clusterPairs(two).length, 0, 'below minSamples → no candidate')

  // 3 distinct inputs, same shape+tool → one candidate.
  const three = [
    pair({ inHash: 'a', ts: 1 }),
    pair({ inHash: 'b', ts: 2 }),
    pair({ inHash: 'c', ts: 3 }),
  ]
  const cands = cluster.clusterPairs(three)
  assert.equal(cands.length, 1, 'threshold met → one candidate')
  const c = cands[0]
  assert.equal(c.matcher.kind, 'feature-sig')
  assert.equal(c.matcher.sig, HEX, 'matcher reuses stored feature signature')
  assert.equal(c.transform.kind, 'tool')
  assert.equal(c.transform.toolId, 'x.decode')
  assert.equal(c.sampleCount, 3)
  assert.equal(c.distinctInputs, 3)
  assert.equal(c.firstTs, 1)
  assert.equal(c.lastTs, 3)
}

// ─── distinct-input guard: same blob repeated is NOT evidence ─────────────────
{
  // 3 samples but only 1 distinct input hash → below minDistinctInputs(2).
  const repeated = [
    pair({ inHash: 'same', ts: 1 }),
    pair({ inHash: 'same', ts: 2 }),
    pair({ inHash: 'same', ts: 3 }),
  ]
  assert.equal(cluster.clusterPairs(repeated).length, 0, 'one blob ×3 → no candidate')

  // Legacy pairs without a hash each count as distinct (can't de-dup).
  const legacy = [pair({ ts: 1 }), pair({ ts: 2 }), pair({ ts: 3 })]
  assert.equal(cluster.clusterPairs(legacy).length, 1, 'hashless pairs each count distinct')
}

// ─── separate clusters by shape and by transform ─────────────────────────────
{
  const mixed = [
    pair({ inHash: 'a', ts: 1 }),
    pair({ inHash: 'b', ts: 2 }),
    pair({ inHash: 'c', ts: 3 }),
    // different tool, same shape → different cluster (only 2, below threshold)
    pair({ inHash: 'd', ts: 4, toolId: 'y.encode' }),
    pair({ inHash: 'e', ts: 5, toolId: 'y.encode' }),
    // different shape, same tool → different cluster (only 1)
    pair({ inHash: 'f', ts: 6, inSig: JSON_SIG }),
  ]
  const cands = cluster.clusterPairs(mixed)
  assert.equal(cands.length, 1, 'only the ≥3 cluster survives')
  assert.equal(cands[0].transform.toolId, 'x.decode')
}

// ─── chain clusters (scenario B forward-compat) ──────────────────────────────
{
  const chains = [
    { ts: 1, kind: 'chain', inSig: JSON_SIG, toolIds: ['url.decode', 'json.prettify'], inHash: 'a' },
    { ts: 2, kind: 'chain', inSig: JSON_SIG, toolIds: ['url.decode', 'json.prettify'], inHash: 'b' },
    { ts: 3, kind: 'chain', inSig: JSON_SIG, toolIds: ['url.decode', 'json.prettify'], inHash: 'c' },
  ]
  const cands = cluster.clusterPairs(chains)
  assert.equal(cands.length, 1, 'chain cluster forms a candidate')
  assert.equal(cands[0].transform.kind, 'chain')
  assert.equal(cands[0].transform.toolIds.join('>'), 'url.decode>json.prettify', 'chain order kept')

  // A single-tool "chain" is malformed → ignored.
  const bad = [
    { ts: 1, kind: 'chain', inSig: JSON_SIG, toolIds: ['only'], inHash: 'a' },
    { ts: 2, kind: 'chain', inSig: JSON_SIG, toolIds: ['only'], inHash: 'b' },
    { ts: 3, kind: 'chain', inSig: JSON_SIG, toolIds: ['only'], inHash: 'c' },
  ]
  assert.equal(cluster.clusterPairs(bad).length, 0, 'malformed chain → no candidate')
}

// ─── isOverBroad ─────────────────────────────────────────────────────────────
{
  // 3 pairs but the sig appears in 100 recent events → pair rate 0.03 → over-broad.
  assert.equal(
    cluster.isOverBroad({ sampleCount: 3, matchingEventCount: 100 }),
    true,
    'rare-pair, common-sig → over-broad',
  )
  // 3 pairs, sig appears 4 times → rate 0.75 → keep.
  assert.equal(
    cluster.isOverBroad({ sampleCount: 3, matchingEventCount: 4 }),
    false,
    'high pair rate → not over-broad',
  )
  // Truncated denominator (fewer events than samples) must not spuriously reject.
  assert.equal(
    cluster.isOverBroad({ sampleCount: 5, matchingEventCount: 2 }),
    false,
    'clamped denominator → not over-broad',
  )
  // No matching events yet → cannot judge → not over-broad.
  assert.equal(
    cluster.isOverBroad({ sampleCount: 3, matchingEventCount: 0 }),
    false,
    'no evidence → not over-broad',
  )
}

// ─── selectProposableCandidates: cluster then reject over-broad ───────────────
{
  const pairs = [
    pair({ inHash: 'a', ts: 1 }),
    pair({ inHash: 'b', ts: 2 }),
    pair({ inHash: 'c', ts: 3 }),
  ]
  // sig common (50 events) → over-broad → dropped.
  assert.equal(
    cluster.selectProposableCandidates(pairs, { [HEX]: 50 }).length,
    0,
    'over-broad candidate filtered out',
  )
  // sig rare (3 events) → survives.
  const kept = cluster.selectProposableCandidates(pairs, { [HEX]: 3 })
  assert.equal(kept.length, 1, 'focused candidate proposable')
  assert.equal(kept[0].matcher.sig, HEX)
}

// ─── proposals.describeCandidate: sig → structured (locale-safe) ─────────────
{
  const cand = {
    clusterKey: `${HEX}#tool:x.decode`,
    matcher: { kind: 'feature-sig', sig: 'cs:hex|len:m|ml' },
    transform: { kind: 'tool', toolId: 'x.decode' },
    sampleCount: 3,
    distinctInputs: 3,
    firstTs: 1,
    lastTs: 3,
  }
  const d = proposals.describeCandidate(cand)
  assert.equal(d.charset, 'hex', 'charset parsed from sig')
  assert.equal(d.lenBucket, 'm', 'length bucket parsed from sig')
  assert.equal(d.flags.join(','), 'ml', 'flags parsed from sig')
  assert.equal(d.transform.toolId, 'x.decode', 'transform carried onto descriptor')
}

// ─── proposals.ruleFromCandidate: mint persistable rule ──────────────────────
{
  const cand = {
    clusterKey: `${HEX}#tool:x.decode`,
    matcher: { kind: 'feature-sig', sig: HEX },
    transform: { kind: 'tool', toolId: 'x.decode' },
    sampleCount: 4,
    distinctInputs: 3,
    firstTs: 1,
    lastTs: 9,
  }
  const rule = proposals.ruleFromCandidate(cand, 12345)
  assert.equal(rule.clusterKey, cand.clusterKey)
  assert.equal(rule.matcherSig, HEX, 'denormalized matcher sig for fire index')
  assert.equal(rule.origin, 'learned')
  assert.equal(rule.strength, 3, 'strength seeded from distinct inputs')
  assert.equal(rule.sampleCount, 4)
  assert.equal(rule.createdAt, 12345, 'createdAt uses injected clock')
  assert.equal(rule.descriptor.charset, 'hex', 'descriptor embedded')
}

// ─── proposals.filterProposableCandidates: dedup + cap ───────────────────────
{
  const mk = (key) => ({
    clusterKey: key,
    matcher: { kind: 'feature-sig', sig: HEX },
    transform: { kind: 'tool', toolId: 'x' },
    sampleCount: 3,
    distinctInputs: 3,
    firstTs: 1,
    lastTs: 3,
  })
  const cands = [mk('k1'), mk('k2'), mk('k3')]

  // Default cap = 1 → only the first (strongest) survives.
  assert.equal(proposals.filterProposableCandidates(cands).length, 1, 'default cap 1')
  assert.equal(proposals.filterProposableCandidates(cands)[0].clusterKey, 'k1', 'keeps strongest')

  // Already-learned k1 → skip to k2.
  const afterLearned = proposals.filterProposableCandidates(cands, { learnedKeys: ['k1'] })
  assert.equal(afterLearned[0].clusterKey, 'k2', 'learned cluster skipped')

  // Suppressed k1+k2 → k3.
  const afterSuppress = proposals.filterProposableCandidates(cands, { suppressedKeys: ['k1', 'k2'] })
  assert.equal(afterSuppress[0].clusterKey, 'k3', 'suppressed clusters skipped')

  // Raise cap → multiple.
  assert.equal(
    proposals.filterProposableCandidates(cands, { maxConcurrent: 2 }).length,
    2,
    'cap honored',
  )

  // All learned/suppressed → none.
  assert.equal(
    proposals.filterProposableCandidates(cands, { learnedKeys: ['k1', 'k2', 'k3'] }).length,
    0,
    'nothing proposable',
  )
}

// ─── proposals.templateToCandidate (scenario D) ──────────────────────────────
{
  const discovered = {
    template: 'code.byted.org/lark/-/merge_requests/{n}',
    host: 'code.byted.org',
    slotKind: 'n',
    distinctValues: 4,
    visits: 9,
    firstTs: 1,
    lastTs: 9,
  }
  const c = proposals.templateToCandidate(discovered)
  assert.equal(c.clusterKey, 'url:code.byted.org/lark/-/merge_requests/{n}')
  assert.equal(c.matcher.kind, 'token')
  assert.equal(c.matcher.tokenKind, 'n')
  assert.equal(c.transform.kind, 'url-template')
  assert.equal(c.transform.template, discovered.template)
  assert.equal(c.transform.slotKind, 'n')
  assert.equal(c.sampleCount, 9, 'visits → sampleCount')
  assert.equal(c.distinctInputs, 4, 'distinct values → distinctInputs')

  // describeCandidate on a token matcher → slot kind as charset, no length.
  const d = proposals.describeCandidate(c)
  assert.equal(d.charset, 'n', 'token slot kind surfaced as charset')
  assert.equal(d.lenBucket, '')
  assert.equal(d.transform.kind, 'url-template')

  // ruleFromCandidate mints a url-template rule with a token matcherSig.
  const rule = proposals.ruleFromCandidate(c, 999)
  assert.equal(rule.matcherSig, 'token:n', 'token matcher denormalized sig')
  assert.equal(rule.transform.kind, 'url-template')
  assert.equal(rule.strength, 4)
}

// ─── coverage: novelty guard registry ────────────────────────────────────────
{
  assert.equal(coverage.isTokenCovered('12345'), false, 'no providers → nothing covered')
  assert.equal(coverage.representativeToken('n'), '12345')
  assert.equal(coverage.representativeToken('uuid'), '550e8400-e29b-41d4-a716-446655440000')

  // A web-open-like provider that claims all-digit tokens.
  coverage.registerCoverageProvider('web-open', (token) => /^\d+$/.test(token))
  assert.equal(coverage.isTokenCovered('12345'), true, 'registered provider covers numbers')
  assert.equal(coverage.isTokenCovered('a1b2c3d4e5f6'), false, 'hex not covered by digit provider')

  // A throwing provider must not break the check.
  coverage.registerCoverageProvider('broken', () => { throw new Error('boom') })
  assert.equal(coverage.isTokenCovered('a1b2c3d4e5f6'), false, 'throwing provider isolated')

  coverage.unregisterCoverageProvider('web-open')
  coverage.unregisterCoverageProvider('broken')
  assert.equal(coverage.isTokenCovered('12345'), false, 'unregister clears coverage')
}

console.log('test-learning-cluster: ok')
