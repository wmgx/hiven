#!/usr/bin/env node
/**
 * Contract: silent auto-learn policy (replaces the proposal card).
 *   src/workspace/learning/proposals.ts — ruleFromCandidate / selectAutoLearnable / isNewlyLearned
 *
 * Why this exists: telemetry showed 216 proposals / 7 unique signatures / 0
 * accepted — the same suggestion re-asked up to 64 times, because
 * filterProposableCandidates only recognized two terminal states (learned,
 * suppressed) and "ignored" was not one of them. Silently learning removes the
 * ask entirely; these assertions pin the safety properties that replace the
 * user's confirmation:
 *   - a silent rule starts WEAKER than a confirmed one (no endorsement behind it)
 *   - it decays to forgettable on its own if never used
 *   - learning it once removes it from the candidate pool (no repeats)
 *   - it stays visibly marked + undoable for its first few fires
 *
 * Run: node scripts/test-learning-autolearn.mjs
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

const P = loadModule('src/workspace/learning/proposals.ts')
const F = loadModule('src/workspace/learning/frecency.ts')
const controllerSource = read('src/workspace/learning/learningController.ts')
assert.match(
  controllerSource,
  /autoLearnNow[\s\S]*?await refreshLearnedUrlRules\(\)[\s\S]*?collectCandidates\(\)/,
  'periodic auto-learn must prune persisted forgotten rules before an empty-candidate early return',
)

const DAY = 24 * 60 * 60 * 1000
const now = 1_700_000_000_000

const candidate = (over = {}) => ({
  clusterKey: 'url:code.byted.org/x/-/merge_requests/{n}',
  matcher: { kind: 'token', tokenKind: 'n' },
  transform: { kind: 'url-template', template: 'code.byted.org/x/-/merge_requests/{n}', slotKind: 'n' },
  sampleCount: 27,
  distinctInputs: 7,
  firstTs: now - 10 * DAY,
  lastTs: now,
  ...over,
})

// ─── 1. silent rules start weaker than user-confirmed ones ───────────────────
{
  const silent = P.ruleFromCandidate(candidate(), now, { silent: true })
  const confirmed = P.ruleFromCandidate(candidate(), now)

  assert.ok(
    silent.strength < confirmed.strength,
    `silent rule must start weaker (no user endorsement): ${silent.strength} < ${confirmed.strength}`,
  )
  assert.equal(silent.autoLearned, true, 'silent rules are flagged as auto-learned')
  assert.equal(confirmed.autoLearned, undefined, 'explicitly-taught rules are not flagged')
  assert.equal(silent.fireCount, 0, 'a fresh rule has not fired yet')
}

// ─── 2. an unused silent rule forgets itself (this replaces "reject") ────────
// The user never has to decline: not using it IS declining.
{
  const silent = P.ruleFromCandidate(candidate(), now, { silent: true })
  assert.equal(
    F.isForgettable(silent, now),
    false,
    'a just-learned rule is not immediately forgotten',
  )
  assert.equal(
    F.isForgettable(silent, now + 30 * DAY),
    false,
    'still alive after one half-life — a slow week should not erase it',
  )
  assert.equal(
    F.isForgettable(silent, now + 60 * DAY),
    true,
    'an unused silent rule decays to forgettable on its own',
  )

  // A rule the user actually used survives much longer.
  const used = { ...silent, strength: silent.strength + 4, lastUsedAt: now }
  assert.equal(
    F.isForgettable(used, now + 60 * DAY),
    false,
    'a used rule outlives an unused one',
  )
}

// ─── 3. learning once removes it from the pool — the 64× repeat cannot recur ──
{
  const c = candidate()
  const pool = [c, candidate({ clusterKey: 'url:other/{n}' })]

  const first = P.selectAutoLearnable(pool, { learnedKeys: [], suppressedKeys: [] })
  assert.ok(first.length > 0, 'fresh candidates are learnable')

  const afterLearning = P.selectAutoLearnable(pool, {
    learnedKeys: first.map((x) => x.clusterKey),
    suppressedKeys: [],
  })
  assert.equal(
    afterLearning.some((x) => first.some((f) => f.clusterKey === x.clusterKey)),
    false,
    'an already-learned cluster is never re-learned (this is the 216× bug)',
  )

  // Explicit "never this one" still wins.
  assert.equal(
    P.selectAutoLearnable(pool, { learnedKeys: [], suppressedKeys: [c.clusterKey] })
      .some((x) => x.clusterKey === c.clusterKey),
    false,
    'a suppressed cluster is never auto-learned',
  )
}

// ─── 4. bounded intake — no flooding the answer area in one go ───────────────
{
  const many = Array.from({ length: 20 }, (_, i) => candidate({ clusterKey: `url:site${i}/{n}` }))
  const picked = P.selectAutoLearnable(many, {})
  assert.ok(picked.length > 0, 'learns something')
  assert.ok(
    picked.length <= 3,
    `auto-learn intake is bounded per pass, got ${picked.length}`,
  )
  // Strongest evidence first (input order is strongest-first from clustering).
  assert.equal(picked[0].clusterKey, 'url:site0/{n}', 'keeps the strongest candidates')
}

// ─── 5. the "newly learned" badge shows for the first few fires, then stops ──
// This is what replaces the up-front question: the rule announces itself when it
// actually does something, where the undo is one keystroke away.
{
  const fresh = P.ruleFromCandidate(candidate(), now, { silent: true })
  assert.equal(P.isNewlyLearned(fresh), true, 'a rule that never fired is marked new')
  assert.equal(P.isNewlyLearned({ ...fresh, fireCount: 1 }), true, 'still new on first fire')
  assert.equal(P.isNewlyLearned({ ...fresh, fireCount: 2 }), true, 'still new on second fire')
  assert.equal(P.isNewlyLearned({ ...fresh, fireCount: 3 }), false, 'blends in after 3 fires')
  assert.equal(P.isNewlyLearned({ ...fresh, fireCount: 99 }), false, 'long-established rule is not new')

  // Explicitly-taught rules are never badged — the user already knows.
  const confirmed = P.ruleFromCandidate(candidate(), now)
  assert.equal(
    P.isNewlyLearned(confirmed),
    false,
    'a rule the user taught on purpose needs no "newly learned" badge',
  )

  // Legacy rules stored before fireCount existed must not all look brand new.
  const legacy = { ...P.ruleFromCandidate(candidate(), now, { silent: true }), fireCount: undefined, lastUsedAt: now }
  assert.equal(
    P.isNewlyLearned(legacy),
    false,
    'a pre-existing rule with usage history is not treated as newly learned',
  )
}

console.log('test-learning-autolearn: ok')
