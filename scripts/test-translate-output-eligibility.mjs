#!/usr/bin/env node
import assert from 'node:assert/strict'
import { load } from './ai-runtime-test-harness.mjs'

const { isCurrentTranslationOutput: eligible } = load('src/plugins/translate/surfaces/outputEligibility.ts', {})
const view = { identity: 'input-language-profile-model-a', outputText: '  full translation\r\n\n', status: { kind: 'success' } }
const result = { view, aiRevision: 4 }

assert.equal(eligible(result, result, view.identity, 4), true)
assert.equal(eligible(result, { ...result }, view.identity, 4), true, 'an unchanged displayed result survives ordinary renders')
assert.equal(view.outputText, '  full translation\r\n\n', 'eligibility preserves the complete output')

for (const kind of ['idle', 'unconfigured', 'waiting', 'translating', 'stopped', 'error', 'quota-exceeded']) {
  const incomplete = { ...result, view: { ...view, status: { kind } } }
  assert.equal(eligible(incomplete, incomplete, view.identity, 4), false, `${kind} output cannot leave the surface`)
}
for (const text of ['', ' ', '\r\n\t']) {
  const empty = { ...result, view: { ...view, outputText: text } }
  assert.equal(eligible(empty, empty, view.identity, 4), false, 'empty or whitespace-only success is not output')
}

assert.equal(eligible(null, result, view.identity, 4), false, 'a button rendered without a result cannot acquire a later result')
assert.equal(eligible(result, null, view.identity, 4), false, 'cancel, close, back and unmount revoke the output')
assert.equal(eligible(result, result, 'input-language-profile-model-b', 4), false, 'changed input or settings revoke output before cleanup')
assert.equal(eligible(result, result, view.identity, 5), false, 'a new preflight revision revokes an old model result before render')
assert.equal(eligible(result, { ...result, view: { ...view } }, view.identity, 4), false, 'a new view cannot be delivered through an older displayed button')
assert.equal(eligible({ ...result, view: { ...view } }, result, view.identity, 4), false, 'equal content is not proof of the same displayed result')

const nonAi = { view }
assert.equal(eligible(nonAi, nonAi, view.identity, 99), true, 'non-AI output is independent of AI readiness')
console.log('Translation output eligibility passed: completion, exact view, identity and preflight revision')
