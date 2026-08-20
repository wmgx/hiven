#!/usr/bin/env node
/**
 * Contract: learned-rule sinks — learning results land in the plugin that already
 * owns the concept, instead of a second private list.
 *   src/workspace/learning/ruleSink.ts
 *
 * A learned url-template and a hand-written web-open quick-open rule are the
 * same thing ("type this shape → open that page"). Two stores means two lists
 * doing one job, and the learned one can only be deleted, never corrected.
 *
 * Also asserts the dependency direction stays legal: the host offers a purely
 * structural description and must not know anything about quick-open entries.
 *
 * Run: node scripts/test-learning-rule-sink.mjs
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

const S = loadModule('src/workspace/learning/ruleSink.ts')

const offer = (over = {}) => ({
  kind: 'url-template',
  template: 'code.byted.org/lark/-/merge_requests/{n}',
  slotKind: 'n',
  clusterKey: 'url:code.byted.org/lark/-/merge_requests/{n}',
  evidence: { sampleCount: 27, distinctInputs: 7 },
  ...over,
})

const reset = () => {
  for (const id of S.listLearnedRuleSinks()) S.unregisterLearnedRuleSink(id)
}

// ─── 1. nobody registered → host keeps the rule itself ───────────────────────
{
  reset()
  assert.equal(await S.offerLearnedRule(offer()), null, 'no sinks → unclaimed')
}

// ─── 2. a sink can claim, and gets the full offer ────────────────────────────
{
  reset()
  let seen = null
  S.registerLearnedRuleSink('web-open', (o) => {
    seen = o
    return o.kind === 'url-template'
  })
  assert.equal(await S.offerLearnedRule(offer()), 'web-open', 'claiming sink is reported')
  assert.equal(seen.template, 'code.byted.org/lark/-/merge_requests/{n}')
  assert.equal(seen.slotKind, 'n')
  assert.equal(seen.evidence.distinctInputs, 7, 'evidence travels with the offer')
}

// ─── 3. declining sinks fall through to the host ─────────────────────────────
{
  reset()
  S.registerLearnedRuleSink('not-mine', () => false)
  assert.equal(await S.offerLearnedRule(offer()), null, 'declined → host stores it')
}

// ─── 4. first claimer wins; later sinks are not consulted ────────────────────
{
  reset()
  let secondCalled = false
  S.registerLearnedRuleSink('first', () => true)
  S.registerLearnedRuleSink('second', () => {
    secondCalled = true
    return true
  })
  assert.equal(await S.offerLearnedRule(offer()), 'first', 'registration order decides')
  assert.equal(secondCalled, false, 'a claimed rule is not offered onward')
}

// ─── 5. a broken sink must never cost a learned rule ─────────────────────────
{
  reset()
  S.registerLearnedRuleSink('broken', () => {
    throw new Error('plugin blew up')
  })
  S.registerLearnedRuleSink('healthy', () => true)
  assert.equal(
    await S.offerLearnedRule(offer()),
    'healthy',
    'a throwing sink is skipped, not fatal',
  )

  reset()
  S.registerLearnedRuleSink('broken', () => {
    throw new Error('plugin blew up')
  })
  assert.equal(await S.offerLearnedRule(offer()), null, 'only broken sinks → unclaimed, not thrown')
}

// ─── 6. async sinks are awaited (writing settings is async in practice) ───────
{
  reset()
  S.registerLearnedRuleSink('async', async (o) => {
    await Promise.resolve()
    return o.slotKind === 'n'
  })
  assert.equal(await S.offerLearnedRule(offer()), 'async', 'async claim resolves')
  assert.equal(await S.offerLearnedRule(offer({ slotKind: 'slug' })), null, 'async decline resolves')
}

// ─── 7. registry hygiene ─────────────────────────────────────────────────────
{
  reset()
  S.registerLearnedRuleSink('a', () => false)
  S.registerLearnedRuleSink('a', () => true)
  assert.equal(S.listLearnedRuleSinks().length, 1, 're-registering replaces, not duplicates')
  assert.equal(await S.offerLearnedRule(offer()), 'a', 'the replacement is the one used')

  S.registerLearnedRuleSink('', () => true)
  S.registerLearnedRuleSink('bad', null)
  assert.equal(S.listLearnedRuleSinks().length, 1, 'empty id / non-function are ignored')

  S.unregisterLearnedRuleSink('a')
  assert.equal(S.listLearnedRuleSinks().length, 0, 'unregister works')
}

// ─── 8. BOUNDARY: the host offer carries no plugin product semantics ─────────
{
  const src = read('src/workspace/learning/ruleSink.ts')
  for (const term of ['matchPattern', 'urlTemplate:', 'WebQuickOpen', 'entries', 'quickOpen']) {
    assert.equal(
      src.includes(term),
      false,
      `ruleSink must not know about web-open internals (found "${term}")`,
    )
  }
  assert.doesNotMatch(src, /^import .*from/m, 'stays dependency-free (host must not import plugins)')
}

console.log('test-learning-rule-sink: ok')
