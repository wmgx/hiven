import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CONTENT_SOURCE_STORES, NO_CONTENT_SINKS, sanitizeNoContentDetails } from '../src/workspace/contentBoundary.ts'
import { computeContractFingerprint } from '../src/workspace/launcher/contractFingerprint.ts'
import { assertLearnableToolSaveableContract } from '../src/workspace/launcher/toolContract.ts'

const read = (path) => readFileSync(path, 'utf8')
const canary = 'HIVEN_NO_CONTENT_CANARY_input_output_query_error'
const sanitized = sanitizeNoContentDetails({
  queryPreview: canary,
  titlePreview: canary,
  message: canary,
  path: canary,
  url: canary,
  unknown: canary,
  inputLength: canary.length,
  failed: true,
  systemKey: 'plugin:line-tools:tool:line-tools.join',
})
assert.doesNotMatch(JSON.stringify(sanitized), new RegExp(canary))
assert.equal(sanitized?.inputLength, canary.length)
assert.ok(CONTENT_SOURCE_STORES.includes('clipboard-history'))
assert.ok(CONTENT_SOURCE_STORES.includes('snippets'))
assert.ok(NO_CONTENT_SINKS.includes('telemetry'))
assert.ok(NO_CONTENT_SINKS.includes('usage-journal'))

const telemetrySource = read('src/workspace/telemetry/track.ts')
const controllerSource = read('src/workspace/launcher/controller.ts')
const perfSource = read('src/workspace/launcher/perf.ts')
assert.doesNotMatch(telemetrySource, /queryPreview|titlePreview|message:\s*error/)
assert.doesNotMatch(controllerSource, /titlePreview|message:\s*error/)
assert.match(perfSource, /sanitizeNoContentDetails\(details\)/)

const base = {
  systemKey: 'plugin:test:tool:format',
  inputPolicy: { mode: 'auto' },
  params: [{
    key: 'indent',
    label: 'Indent',
    labelI18n: { zh: '缩进' },
    type: 'single-select',
    default: '2',
    options: [{ label: 'Two', labelI18n: { zh: '二' }, value: '2' }],
    saveable: false,
  }],
}
const fingerprint = computeContractFingerprint(base)
assert.equal(fingerprint, computeContractFingerprint({
  ...base,
  params: [{ ...base.params[0], label: 'Spaces', labelI18n: { zh: '空格' }, saveable: true, saveableMaxLength: 12 }],
}))
for (const changed of [
  { ...base, systemKey: 'plugin:test:tool:other' },
  { ...base, inputPolicy: { mode: 'selection' } },
  { ...base, params: [{ ...base.params[0], key: 'width' }] },
  { ...base, params: [{ ...base.params[0], type: 'text' }] },
  { ...base, params: [{ ...base.params[0], default: '4' }] },
  { ...base, params: [{ ...base.params[0], options: [{ label: 'Two', value: '4' }] }] },
]) assert.notEqual(fingerprint, computeContractFingerprint(changed))

const lineTools = read('src/plugins/line-tools/index.ts')
const jsonTools = read('src/plugins/json-tools/index.ts')
const encodeDecode = read('src/plugins/encode-decode/index.ts')
assert.ok((lineTools.match(/policy: LEARNABLE_PURE/g) ?? []).length >= 10)
for (const key of ['separator', 'prefix', 'suffix', 'left', 'right']) {
  assert.match(lineTools, new RegExp(`key: '${key}'[^\\n]+saveable: true[^\\n]+saveableMaxLength: 256`))
}
assert.match(jsonTools, /key: 'indent'[^\n]+type: 'number'[^\n]+saveable: true/)
assert.match(jsonTools, /key: 'sortKeys'[^\n]+type: 'boolean'[^\n]+saveable: true/)
assert.ok((encodeDecode.match(/policy: LEARNABLE_PURE/g) ?? []).length >= 2)

const learnableTool = {
  id: 'future-tool',
  title: 'Future tool',
  policy: { effect: 'pure', learnable: true },
  params: [{ key: 'mode', label: 'Mode', type: 'boolean', saveable: false }],
  run: () => ({ ok: true }),
}
assert.doesNotThrow(() => assertLearnableToolSaveableContract(learnableTool))
assert.throws(
  () => assertLearnableToolSaveableContract({
    ...learnableTool,
    params: [{ key: 'mode', label: 'Mode', type: 'boolean' }],
  }),
  /future-tool.*mode.*saveable/,
)
assert.throws(
  () => assertLearnableToolSaveableContract({
    ...learnableTool,
    params: [{ key: 'separator', label: 'Separator', type: 'text', saveable: true }],
  }),
  /future-tool.*separator.*saveableMaxLength/,
)
assert.doesNotThrow(() => assertLearnableToolSaveableContract({
  ...learnableTool,
  policy: { effect: 'unknown', learnable: false },
  params: [{ key: 'opaque', label: 'Opaque', type: 'text' }],
}))

const adapter = read('src/workspace/launcher/toolAdapter.ts')
assert.match(adapter, /actionPolicy: tool\.policy \?\? DEFAULT_TOOL_ACTION_POLICY/)
console.log('self-learning PR0 checks passed')
