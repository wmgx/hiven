import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
function load(path, imports = {}) {
  const module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
    { module, exports: module.exports, TextEncoder, require: name => { if (name in imports) return imports[name]; throw Error(name) } })
  return module.exports
}
const material = load('src/launcher/clipboard/currentMaterial.ts')
const { createMaterialComparison, MATERIAL_COMPARE_MAX_BYTES: max } = load('src/currentMaterialCompare.ts', { './historyDiffHandoff': load('src/historyDiffHandoff.ts') })
const block = text => ({ id: text, createdAt: 1, source: 'tool-result', kind: 'text', payloadText: text })
const before = block('  original\r\n完整\n'), after = block('  current\n材料\n')
let state = material.acceptMaterialHandoff(material.replaceCurrentMaterial(before), after, true)
const pair = material.getMaterialTextPair(state)
assert.equal(pair.previous, before.payloadText); assert.equal(pair.current, after.payloadText)
for (const patch of [{ secretMasked: true }, { kind: 'secret-like' }, { kind: 'secret' }, { kind: 'image' }, { kind: 'files' }, { payloadImage: {} }, { payloadFiles: {} }, { payloadText: undefined, preview: 'not full text' }, { payloadText: 'nul\0text' }]) {
  for (const side of ['block', 'previousBlock']) assert.equal(material.getMaterialTextPair({ ...state, [side]: { ...state[side], ...patch } }), null)
}
for (const cleared of [material.replaceCurrentMaterial(after), material.discardCurrentMaterial(state), material.forgetPreviousMaterial(state), material.restorePreviousMaterial(state), material.acceptMaterialHandoff(material.replaceCurrentMaterial(null), after, true)]) assert.equal(material.getMaterialTextPair(cleared), null)
const third = block('third result')
const changed = material.getMaterialTextPair(material.acceptMaterialHandoff(state, third, true))
assert.equal(changed.previous, after.payloadText);assert.equal(changed.current, third.payloadText)
let current = true, available = true, targets = [], preparations = 0
const compare = createMaterialComparison()
const options = { prepare: async () => { preparations++ }, available: () => available, titles: { previous: 'Previous material', current: 'Current material' }, open: target => targets.push(target) }
const snapshot = { ...pair, isCurrent: () => current }
assert.equal(await compare(snapshot, options), null)
const payload = JSON.parse(targets[0].initialText)
assert.equal(payload.original.text, before.payloadText); assert.equal(payload.modified.text, after.payloadText)
assert.equal(payload.original.title, 'Previous material');assert.equal(payload.modified.title, 'Current material')
assert.equal(await compare({ ...snapshot, previous: 'a'.repeat(max), current: 'x' }, options), 'too-large')
assert.equal(await compare({ ...snapshot, previous: '中'.repeat(Math.ceil(max / 3)), current: '' }, options), 'too-large')
assert.equal(preparations, 1)
assert.equal(await compare({ ...snapshot, previous: 'a'.repeat(max), current: '' }, options), null)
available = false; assert.equal(await compare(snapshot, options), 'unavailable')
assert.equal(await compare(snapshot, { ...options, prepare: async () => { throw Error('load') } }), 'unavailable')
let release;const delayed = { ...options, prepare: () => new Promise(resolve => { release = resolve }) }
available = true;const pending = compare(snapshot, delayed), count = targets.length
await compare(snapshot, options);assert.equal(targets.length, count)
current = false;release();await pending;assert.equal(targets.length, count)
await compare(snapshot, options);assert.equal(targets.length, count)
current = true;await compare(snapshot, options);assert.equal(targets.length, count + 1)
console.log('PASS full text eligibility, pair lifecycle, byte limits, neutral labels, availability, deduplication and late cancellation')
