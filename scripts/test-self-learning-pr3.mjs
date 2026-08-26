import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  canonicalSafeParams,
  createMiningFingerprints,
  isSecretLikeInput,
} from '../src/workspace/experience/miningFingerprint.ts'
import {
  mineLearningCandidates,
  summarizeCandidateFeedback,
} from '../src/workspace/experience/miner.ts'
import { shouldRecordCandidateSurface } from '../src/workspace/experience/candidateSurfaceDedupe.ts'

const now = new Date(2026, 7, 26, 12).getTime()
const day = 24 * 60 * 60 * 1000
const policy = { effect: 'pure', learnable: true }
const jsonItem = {
  systemKey: 'plugin:json-tools:tool:json.format',
  kind: 'plugin-tool',
  display: { title: 'Format JSON' },
  behavior: { type: 'perform' },
  params: [
    { key: 'indent', label: 'Indent', type: 'number', default: 2, saveable: true },
    { key: 'sortKeys', label: 'Sort keys', type: 'boolean', default: false, saveable: true },
  ],
  defaultParams: { indent: 2, sortKeys: false },
  inputPolicy: { mode: 'auto' },
  actionPolicy: policy,
  contractFingerprint: 'v1:0123456789abcdef',
  execute: () => ({ ok: true }),
}
const joinItem = {
  ...jsonItem,
  systemKey: 'plugin:line-tools:tool:line-tools.join',
  display: { title: 'Join Lines', titleI18n: { zh: '合并行' } },
  params: [{ key: 'separator', label: 'Separator', type: 'text', default: '\n', saveable: true, saveableMaxLength: 256 }],
  defaultParams: { separator: '\n' },
  contractFingerprint: 'v1:fedcba9876543210',
}

let seq = 0
function runEvents({ item, params, ts, fingerprint, paramSignature = `h1:${'a'.repeat(64)}`, output = 'copy', via = 'execute', status = 'success', surface = 'global-launcher' }) {
  const id = `run_${++seq}`
  const safeParamsJson = canonicalSafeParams(params)
  const common = { ts, sessionId: `session_${seq}`, runId: id, actionKey: item.systemKey, surfaceId: surface, via }
  return [
    {
      ...common,
      eventId: `event_${seq}_start`,
      eventType: 'run.started',
      inputBinding: 'selection',
      inputFingerprint: fingerprint,
      paramSignature,
      safeParamsJson,
    },
    { ...common, eventId: `event_${seq}_finish`, eventType: 'run.finished', status },
    {
      ...common,
      eventId: `event_${seq}_output`,
      eventType: 'output.applied',
      outputIntent: output,
      outputApplication: 'explicit',
    },
  ]
}

const defaultEvents = Array.from({ length: 20 }, (_, index) => runEvents({
  item: jsonItem,
  params: { indent: 2, sortKeys: false },
  ts: now - (index % 3) * day,
  fingerprint: `h1:${(index % 4).toString(16).repeat(64)}`,
})).flat()
assert.deepEqual(mineLearningCandidates({ events: defaultEvents, baseItems: [jsonItem], now }), [], 'default params + default output must never produce a candidate')
const mixedDefaultEvents = [
  ...runEvents({
    item: jsonItem,
    params: { indent: 2, sortKeys: false },
    ts: now,
    fingerprint: `h1:${'f'.repeat(64)}`,
    output: 'copy',
    surface: 'editor-command-bar',
  }),
  ...defaultEvents.slice(0, 9),
]
assert.deepEqual(mineLearningCandidates({ events: mixedDefaultEvents, baseItems: [jsonItem], now }), [], 'default runs from another surface must not inflate a non-default output group')

const repeatedEvents = [
  runEvents({ item: joinItem, params: { separator: ', ' }, ts: now - day, fingerprint: `h1:${'1'.repeat(64)}` }),
  runEvents({ item: joinItem, params: { separator: ', ' }, ts: now - day, fingerprint: `h1:${'2'.repeat(64)}` }),
  runEvents({ item: joinItem, params: { separator: ', ' }, ts: now, fingerprint: `h1:${'3'.repeat(64)}` }),
  runEvents({ item: joinItem, params: { separator: ', ' }, ts: now, fingerprint: `h1:${'1'.repeat(64)}` }),
].flat()
const candidates = mineLearningCandidates({ events: repeatedEvents, baseItems: [joinItem], now })
assert.equal(candidates.length, 1)
assert.deepEqual({
  occurrences: candidates[0].occurrences,
  distinctInputs: candidates[0].distinctInputs,
  dayCount: candidates[0].dayCount,
  params: candidates[0].savedParams,
}, { occurrences: 4, distinctInputs: 3, dayCount: 2, params: { separator: ', ' } })
const mismatchedSignatureEvents = repeatedEvents.map((event, index) => event.eventType === 'run.started' && index === 0
  ? { ...event, paramSignature: `h1:${'b'.repeat(64)}` }
  : event)
assert.deepEqual(mineLearningCandidates({ events: mismatchedSignatureEvents, baseItems: [joinItem], now }), [], 'param signature must participate in candidate grouping')
const unknownParamEvents = repeatedEvents.map((event) => event.eventType === 'run.started'
  ? { ...event, safeParamsJson: '{"opaque":"PRIVATE_NON_SAVEABLE_CANARY"}' }
  : event)
assert.deepEqual(mineLearningCandidates({ events: unknownParamEvents, baseItems: [joinItem], now }), [], 'unknown or non-opted-in params must fail closed')

const beforePreview = repeatedEvents.length
for (let index = 0; index < 100; index += 1) joinItem.execute()
assert.equal(repeatedEvents.length, beforePreview, 'preview computations must append zero events')
assert.equal(mineLearningCandidates({ events: repeatedEvents, baseItems: [joinItem], now }).length, 1)
const failedEvidence = repeatedEvents.map((event, index) => index === 1 ? { ...event, status: 'failed' } : event)
assert.equal(mineLearningCandidates({ events: failedEvidence, baseItems: [joinItem], now }).length, 0, 'failed runs cannot count toward the four successful applications')

const artifact = {
  schemaVersion: 1,
  id: 'artifact_existing',
  name: 'Comma Join',
  aliases: [],
  baseActionKey: joinItem.systemKey,
  savedParams: { separator: ', ' },
  inputBinding: 'selection',
  outputIntent: 'copy',
  contractFingerprint: joinItem.contractFingerprint,
  actionPolicy: policy,
  createdAt: now,
}
assert.deepEqual(mineLearningCandidates({ events: repeatedEvents, baseItems: [joinItem], savedActions: [artifact], now }), [], 'existing same-config Artifact must suppress the candidate')

const savedActionEvents = Array.from({ length: 5 }, (_, index) => runEvents({
  item: joinItem,
  params: { separator: ', ' },
  ts: now - (index % 2) * day,
  fingerprint: `h1:${(index + 4).toString(16).repeat(64)}`,
  via: 'saved-action',
})).flat()
assert.deepEqual(mineLearningCandidates({ events: savedActionEvents, baseItems: [joinItem], now }), [], 'via=saved-action must be excluded directly')

const candidate = candidates[0]
const feedback = [
  ...Array.from({ length: 5 }, (_, index) => ({ eventId: `surface_${index}`, ts: now, sessionId: `session_${index}`, eventType: 'candidate.surfaced', actionKey: candidate.actionKey, candidateKey: candidate.candidateKey })),
  ...Array.from({ length: 4 }, (_, index) => ({ eventId: `ignore_${index}`, ts: now, sessionId: `session_${index}`, eventType: 'candidate.dismissed', actionKey: candidate.actionKey, candidateKey: candidate.candidateKey, candidateDecision: 'ignore-once' })),
]
assert.deepEqual(summarizeCandidateFeedback(feedback, candidate.candidateKey), {
  surfaced: 5, ignored: 4, suppressed: 0, saved: 0, ignoreRate: 0.8,
})
assert.equal(shouldRecordCandidateSurface('session_dedupe', candidate.candidateKey), true)
assert.equal(shouldRecordCandidateSurface('session_dedupe', candidate.candidateKey), false)
assert.equal(shouldRecordCandidateSurface('session_next', candidate.candidateKey), true)

const secret = new Uint8Array(32).fill(7)
const inputCanary = 'PRIVATE_INPUT_CANARY_PR3'
const fingerprints = await createMiningFingerprints(inputCanary, { separator: ', ' }, secret)
assert.ok(fingerprints)
const sameFingerprints = await createMiningFingerprints(inputCanary, { separator: ', ' }, secret)
const differentFingerprints = await createMiningFingerprints(`${inputCanary}!`, { separator: ', ' }, secret)
assert.equal(fingerprints.inputFingerprint, sameFingerprints?.inputFingerprint)
assert.notEqual(fingerprints.inputFingerprint, differentFingerprints?.inputFingerprint)
assert.equal(fingerprints.paramSignature, differentFingerprints?.paramSignature)
assert.match(fingerprints.inputFingerprint, /^h1:[0-9a-f]{64}$/)
assert.match(fingerprints.paramSignature, /^h1:[0-9a-f]{64}$/)
assert.doesNotMatch(JSON.stringify(fingerprints), new RegExp(inputCanary))
assert.equal(isSecretLikeInput('password=hunter2'), true)
assert.equal(await createMiningFingerprints('Bearer abcdefghijklmnopqrstuvwxyz123456', {}, secret), null)

const controllerSource = readFileSync('src/workspace/launcher/controller.ts', 'utf8')
assert.match(controllerSource, /via !== 'saved-action'/)
assert.match(controllerSource, /event\.safeParamsJson = snapshot\.safeParamsJson/)
assert.match(controllerSource, /miningSnapshot = createMiningFingerprints/)
assert.doesNotMatch(controllerSource, /await createMiningFingerprints/, 'fingerprinting must not block the committed action')
const inboxSource = readFileSync('src/components/learning/LearningInboxSurface.tsx', 'utf8')
for (const decision of ['ignore-once', 'suppress-cluster', 'disable-action-learning']) assert.match(inboxSource, new RegExp(decision))

console.log('self-learning PR3 checks passed')
