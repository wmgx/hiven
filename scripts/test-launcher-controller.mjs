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
const stripI18nImport = /import\s*\{\s*translate,\s*type\s+Locale\s*\}\s*from\s*'[^']*\/i18n'\s*;?\s*\n?/
const translate = (locale, namespace, key, vars = {}) => {
  const messages = {
    palette: {
      en: {
        copied: 'Copied',
        copy: 'Copy',
        insert: 'Insert',
        replaceActiveText: 'Replace active text',
        fieldRequiredWithLabel: '{label} is required',
        inputRequired: 'Input required',
        quickTextPlaceholder: 'Text for {title}',
      },
      zh: {
        copied: '已复制',
        copy: '复制',
        insert: '插入',
        replaceActiveText: '替换当前文本',
        fieldRequiredWithLabel: '{label} 为必填',
        inputRequired: '请输入内容',
        quickTextPlaceholder: '输入要用 {title} 处理的文本',
      },
    },
  }
  let value = messages[namespace]?.[locale]?.[key] ?? messages[namespace]?.en?.[key] ?? key
  for (const [name, replacement] of Object.entries(vars)) value = value.replaceAll(`{${name}}`, String(replacement))
  return value
}

const output = loadModule('src/workspace/launcher/output.ts', {
  stripImports: [...stripTypeImports, stripI18nImport],
  globals: { translate },
})
const controllerMod = loadModule('src/workspace/launcher/controller.ts', {
  stripImports: [
    ...stripTypeImports,
    stripI18nImport,
    /import\s*\{[^}]*\}\s*from\s*'\.\/output'\s*;?\s*\n?/,
  ],
  globals: { isOutputResult: output.isOutputResult, translate },
})
const { LauncherController } = controllerMod

function makeApi() {
  const calls = { copied: [], replaced: [], inserted: [] }
  return {
    calls,
    api: {
      getActiveText: () => 'ACTIVE',
      getSelectionText: () => '',
      getPaneSnapshot: () => ({ activePaneId: 'pane-1', paneIds: ['pane-1'], panes: {}, renderers: {} }),
      isPanePanelOpen: () => false,
      getClipboardText: async () => '',
      replaceActiveText: async (t) => { calls.replaced.push(t) },
      insertText: async (t) => { calls.inserted.push(t) },
      copyText: async (t) => { calls.copied.push(t) },
      openUrl: async () => {},
      showMainPanel: async () => {},
      dispatchEffects: () => ({ applied: [], errors: [] }),
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
  let paramFrame = ctrl.getState().frames[ctrl.getState().frames.length - 1]
  assert.equal(paramFrame.kind, 'param-input')
  assert.equal(paramFrame.query, '!', 'text param frame starts from the default value')
  await ctrl.commitCurrentParam('?')
  assert.deepEqual(order, ['record', 'execute:?'], 'param submit executes with edited params')
}

// --- 12. parameter frame advances one launcher step at a time and preserves default selection ---
{
  const order = []
  const { ctrl } = makeController({ recordSelection: () => order.push('record') })
  const item = {
    ...performItem('plugin:p:command:multi-param', async () => { order.push('default'); return { ok: true } }),
    params: [
      { key: 'mode', label: 'Mode', type: 'single-select', options: [{ label: 'Pretty', value: 'pretty' }, { label: 'Compact', value: 'compact' }], default: 'compact' },
      { key: 'ignoreCase', label: 'Ignore Case', type: 'boolean', default: false },
    ],
    defaultParams: { mode: 'compact', ignoreCase: false },
    executeWithParams: async (_ctx, params) => {
      order.push(`execute:${params.mode}:${String(params.ignoreCase)}`)
      return { ok: true }
    },
  }
  await ctrl.selectItem(item, { customizeParams: true })
  let paramFrame = ctrl.getState().frames[ctrl.getState().frames.length - 1]
  assert.equal(paramFrame.kind, 'param-input')
  assert.equal(paramFrame.paramIndex, 0)
  assert.equal(paramFrame.selectedIndex, 1, 'single-select param frame selects the default option')
  await ctrl.commitCurrentParam('pretty')
  paramFrame = ctrl.getState().frames[ctrl.getState().frames.length - 1]
  assert.equal(paramFrame.kind, 'param-input')
  assert.equal(paramFrame.paramIndex, 1, 'first param commit advances to the next launcher step')
  assert.equal(paramFrame.selectedIndex, 1, 'boolean false default selects the No option')
  await ctrl.commitCurrentParam(false)
  assert.deepEqual(order, ['record', 'execute:pretty:false'])
}

// --- 13. global launcher text tools collect manual input instead of reading the pane immediately ---
{
  const order = []
  const { ctrl } = makeController({
    surfaceId: 'global-launcher',
    recordSelection: () => order.push('record'),
  })
  const item = {
    ...performItem('plugin:p:tool:manual', async (ctx) => {
      order.push('execute:' + ctx.input.text)
      return { ok: true }
    }),
    inputPolicy: { mode: 'auto' },
  }
  await ctrl.selectItem(item)
  assert.deepEqual(order, ['record'], 'global text tool records usage before entering manual input')
  let frame = ctrl.getState().frames[ctrl.getState().frames.length - 1]
  assert.equal(frame.kind, 'collect-input', 'global text tool enters manual input frame')
  assert.equal(frame.input.placeholder, 'Text for plugin:p:tool:manual', 'manual input frame gets the quick text placeholder')
  ctrl.setInputText('manual text')
  await ctrl.submitInput()
  assert.deepEqual(order, ['record', 'execute:manual text'], 'manual input is passed into execution')
}

// --- 14. global launcher param tools collect manual input after params are confirmed ---
{
  const order = []
  const { ctrl } = makeController({
    surfaceId: 'global-launcher',
    recordSelection: () => order.push('record'),
  })
  const item = {
    ...performItem('plugin:p:tool:param-manual', async () => { order.push('default'); return { ok: true } }),
    inputPolicy: { mode: 'auto' },
    params: [{ key: 'mode', label: 'Mode', type: 'single-select', options: ['upper', 'lower'], default: 'upper' }],
    defaultParams: { mode: 'upper' },
    executeWithParams: async (ctx, params) => {
      order.push(`execute:${ctx.input.text}:${params.mode}`)
      return { ok: true }
    },
  }
  await ctrl.selectItem(item, { customizeParams: true })
  assert.equal(ctrl.getState().frames[ctrl.getState().frames.length - 1].kind, 'param-input')
  await ctrl.commitCurrentParam('lower')
  const frame = ctrl.getState().frames[ctrl.getState().frames.length - 1]
  assert.equal(frame.kind, 'collect-input', 'param confirmation advances to manual input frame')
  ctrl.setInputText('Abc')
  await ctrl.submitInput()
  assert.deepEqual(order, ['record', 'execute:Abc:lower'], 'manual input and chosen params are submitted together')
}

// --- 15. global manual input tools can preview output while typing ---
{
  const cap = makeApi()
  const { ctrl } = makeController({
    surfaceId: 'global-launcher',
    api: cap.api,
  })
  const item = {
    ...performItem('plugin:p:tool:live-manual', async (ctx) => output.textResult(ctx.input.text.toUpperCase(), ctx.api)),
    inputPolicy: { mode: 'auto' },
  }
  await ctrl.selectItem(item)
  ctrl.setInputText('live')
  await ctrl.previewInput()
  const frame = ctrl.getState().frames[ctrl.getState().frames.length - 1]
  assert.equal(frame.kind, 'collect-input')
  assert.equal(frame.previewOutput.choices[0].title, 'LIVE', 'live preview output updates in the input frame')
}

// --- 16. submitting a live preview copies the preview output and closes without re-running ---
{
  const cap = makeApi()
  let executeCount = 0
  const { ctrl, getClosed } = makeController({
    surfaceId: 'global-launcher',
    api: cap.api,
  })
  const item = {
    ...performItem('plugin:p:tool:live-submit', async (ctx) => {
      executeCount++
      return output.textResult(`${ctx.input.text}:${executeCount}`, ctx.api)
    }),
    inputPolicy: { mode: 'auto' },
  }
  await ctrl.selectItem(item)
  ctrl.setInputText('copy')
  await ctrl.previewInput()
  await ctrl.submitInput()
  assert.equal(executeCount, 1, 'submit should use the current preview instead of re-running the transform')
  assert.deepEqual(cap.calls.copied, ['copy:1'], 'submit copies current preview result')
  assert.equal(getClosed(), 1, 'submit closes after copying current preview')
}

console.log('✓ test-launcher-controller passed')
