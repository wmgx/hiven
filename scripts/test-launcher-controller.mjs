#!/usr/bin/env node
/**
 * test-launcher-controller.mjs
 * Verifies launcher lifecycle: usage timing, result-choice stack, Enter/Escape,
 * collect-input single submit, no-output close, output keeps open, failure shows error.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function loadModule(path, { stripImports = [], globals = {} } = {}) {
  let src = readFileSync(path, 'utf8')
  for (const re of stripImports) src = src.replace(re, '')
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
  }).outputText
  const moduleExports = {}
  const sandbox = { exports: moduleExports, module: { exports: moduleExports }, console, ...globals }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports
}

const stripTypeImports = [/import\s+type\s*\{[\s\S]*?\}\s*from\s*'[^']*'\s*;?\s*\n?/g]

const output = loadModule('src/workspace/launcher/output.ts', { stripImports: stripTypeImports })
const controllerMod = loadModule('src/workspace/launcher/controller.ts', {
  stripImports: [
    ...stripTypeImports,
    /import\s*\{[^}]*\}\s*from\s*'\.\/output'\s*;?\s*\n?/,
  ],
  globals: { isOutputResult: output.isOutputResult },
})
const { LauncherController } = controllerMod

function makeApi() {
  const calls = { copied: [], replaced: [], inserted: [] }
  return {
    calls,
    api: {
      getActiveText: () => 'ACTIVE',
      getSelectionText: () => '',
      getClipboardText: async () => '',
      replaceActiveText: async (t) => { calls.replaced.push(t) },
      insertText: async (t) => { calls.inserted.push(t) },
      copyText: async (t) => { calls.copied.push(t) },
      openUrl: async () => {},
      showMessage: () => {},
    },
  }
}

function makeController(overrides = {}) {
  const recorded = []
  let closed = 0
  const states = []
  const { api } = makeApi()
  const ctrl = new LauncherController({
    surfaceId: 'command-palette',
    api,
    locale: 'en',
    makeT: () => (k) => k,
    getSettings: () => ({}),
    recordSelection: (surfaceId, item) => recorded.push({ surfaceId, key: item.systemKey }),
    requestClose: () => { closed++ },
    onChange: (s) => states.push(s),
    ...overrides,
  })
  return { ctrl, recorded, getClosed: () => closed, states, api }
}

function performItem(systemKey, execute, kind = 'plugin') {
  return { systemKey, kind, display: { title: systemKey }, behavior: { type: 'perform' }, pinnable: true, execute }
}
function collectInputItem(systemKey, execute, input = {}) {
  return { systemKey, kind: 'plugin', display: { title: systemKey }, behavior: { type: 'collect-input', input }, pinnable: true, execute }
}

// --- 1. perform: records usage BEFORE execution, no-output closes ---
{
  const order = []
  const { ctrl, recorded, getClosed } = makeController({
    recordSelection: () => order.push('record'),
  })
  const item = performItem('plugin:p:launcher:a', async () => { order.push('execute'); return { ok: true } })
  await ctrl.selectItem(item)
  assert.deepEqual(order, ['record', 'execute'], 'usage recorded before execution')
  assert.equal(getClosed(), 1, 'no-output success closes launcher')
}

// --- 2. perform with output: enters result mode, keeps open ---
{
  const { ctrl, getClosed, api } = makeController()
  const item = performItem('plugin:p:launcher:b', async (ctx) => output.textResult('HELLO', ctx.api))
  await ctrl.selectItem(item)
  const st = ctrl.getState()
  assert.equal(st.frames[st.frames.length - 1].kind, 'result', 'output enters result frame')
  assert.equal(getClosed(), 0, 'output keeps launcher open')
  // text output Enter copies
  const choice = st.frames[st.frames.length - 1].output.choices[0]
  assert.equal(choice.title, 'HELLO')
}

// --- 3. text output Enter-copy default ---
{
  const cap = makeApi()
  const { ctrl } = makeController({ api: cap.api })
  const item = performItem('plugin:p:launcher:c', async (ctx) => output.textResult('XYZ', ctx.api))
  await ctrl.selectItem(item)
  const st = ctrl.getState()
  const choice = st.frames[st.frames.length - 1].output.choices[0]
  await ctrl.activateChoice(choice)
  assert.deepEqual(cap.calls.copied, ['XYZ'], 'default text output Enter copies')
}

// --- 4. collect-input: records usage on ENTER input (not submit), submits once ---
{
  const order = []
  let executeCount = 0
  const { ctrl } = makeController({ recordSelection: () => order.push('record') })
  const item = collectInputItem('plugin:p:launcher:web', async (ctx) => {
    executeCount++
    order.push('execute:' + ctx.input.text)
    return { ok: true }
  })
  await ctrl.selectItem(item)
  assert.deepEqual(order, ['record'], 'usage recorded when entering input mode, before submit')
  assert.equal(ctrl.getState().frames[ctrl.getState().frames.length - 1].kind, 'collect-input')
  ctrl.setInputText('query')
  await ctrl.submitInput()
  assert.equal(executeCount, 1, 'collect-input executes exactly once')
  assert.deepEqual(order, ['record', 'execute:query'], 'execute happens on submit with input text')
}

// --- 5. collect-input empty rejected unless allowEmptyInput ---
{
  let executeCount = 0
  const { ctrl } = makeController()
  const item = collectInputItem('plugin:p:launcher:web2', async () => { executeCount++; return { ok: true } }, { allowEmptyInput: false, emptyInputMessage: 'need input' })
  await ctrl.selectItem(item)
  await ctrl.submitInput() // empty
  assert.equal(executeCount, 0, 'empty submit blocked')
  assert.equal(ctrl.getState().error, 'need input', 'shows empty-input message')
}

// --- 6. failure keeps launcher open and shows error ---
{
  const { ctrl, getClosed } = makeController()
  const item = performItem('plugin:p:launcher:fail', async () => ({ ok: false, message: 'boom' }))
  await ctrl.selectItem(item)
  assert.equal(ctrl.getState().error, 'boom', 'error displayed')
  assert.equal(getClosed(), 0, 'failure does not close launcher')
}

// --- 7. Escape pops frames; from base returns false ---
{
  const { ctrl } = makeController()
  const item = performItem('plugin:p:launcher:o', async (ctx) => output.textResult('Z', ctx.api))
  await ctrl.selectItem(item)
  assert.equal(ctrl.getState().frames.length, 2, 'in result frame')
  assert.equal(ctrl.back(), true, 'escape pops result frame')
  assert.equal(ctrl.getState().frames.length, 1, 'back to list')
  assert.equal(ctrl.back(), false, 'escape from base returns false (host closes)')
}

// --- 8. pinned execution does not record usage (recordUsage:false) ---
{
  const recorded = []
  const { ctrl } = makeController({ recordSelection: (s, i) => recorded.push(i.systemKey) })
  const item = performItem('plugin:p:launcher:pin', async () => ({ ok: true }))
  await ctrl.selectItem(item, { recordUsage: false })
  assert.equal(recorded.length, 0, 'pinned execution does not record usage')
}

// --- 9. dynamic item never records usage ---
{
  const recorded = []
  const { ctrl } = makeController({ recordSelection: (s, i) => recorded.push(i.systemKey) })
  const item = performItem('plugin:p:dynamic:d', async () => ({ ok: true }), 'dynamic')
  await ctrl.selectItem(item)
  assert.equal(recorded.length, 0, 'dynamic item does not record long-term usage')
}

// --- 10. multi-level: choice action returning output pushes another result frame ---
{
  const { ctrl, api } = makeController()
  const item = performItem('plugin:p:launcher:multi', async (ctx) => output.choicesResult([
    { id: 'lvl1', title: 'Level1', primaryAction: async () => output.textResult('deep', ctx.api) },
  ]))
  await ctrl.selectItem(item)
  let st = ctrl.getState()
  assert.equal(st.frames.length, 2)
  const choice = st.frames[1].output.choices[0]
  await ctrl.activateChoice(choice)
  st = ctrl.getState()
  assert.equal(st.frames.length, 3, 'choice returning output pushes another result frame')
}

// --- 11. Cmd/Ctrl+Enter customization enters param frame and executes with supplied params ---
{
  const order = []
  const { ctrl } = makeController({ recordSelection: () => order.push('record') })
  const item = {
    ...performItem('plugin:p:command:upper', async () => { order.push('default'); return { ok: true } }),
    params: [{ key: 'suffix', label: 'Suffix', type: 'text', default: '!' }],
    defaultParams: { suffix: '!' },
    executeWithParams: async (_ctx, params) => {
      order.push('execute:' + params.suffix)
      return { ok: true }
    },
  }
  await ctrl.selectItem(item, { customizeParams: true })
  assert.deepEqual(order, ['record'], 'usage recorded when entering param mode, before submit')
  assert.equal(ctrl.getState().frames[ctrl.getState().frames.length - 1].kind, 'param-input')
  ctrl.setParamValue('suffix', '?')
  await ctrl.submitParams()
  assert.deepEqual(order, ['record', 'execute:?'], 'param submit executes with edited params')
}

console.log('✓ test-launcher-controller passed')
