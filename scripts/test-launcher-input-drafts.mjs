#!/usr/bin/env node
/** Real controller/registry/tool execution, with in-memory input and delivery only. */
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const values = new Map()
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => { values.set(key, String(value)) },
  removeItem: (key) => { values.delete(key) },
}
globalThis.window = {
  localStorage: storage, sessionStorage: storage, location: { search: '' },
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
}
globalThis.localStorage = storage
globalThis.sessionStorage = storage
const originalInfo = console.info
console.info = (...args) => { if (args[0] !== '[hiven:launcher-perf]') originalInfo(...args) }
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const controllers = []
try {
  const { registerBundledPluginPackages } = await vite.ssrLoadModule('/src/workspace/bundledPluginLoader.ts')
  const { collectStaticCandidates } = await vite.ssrLoadModule('/src/workspace/launcher/registry.ts')
  const { LauncherController } = await vite.ssrLoadModule('/src/workspace/launcher/controller.ts')
  const { makePluginT } = await vite.ssrLoadModule('/src/i18n/pluginI18nRegistry.ts')
  registerBundledPluginPackages()
  const json = collectStaticCandidates('global-launcher').find((item) => item.systemKey === 'plugin:json-tools:tool:json.prettify')
  const random = collectStaticCandidates('quick-editor-command').find((item) => item.systemKey === 'plugin:random:tool:random.integer')
  assert.ok(json)
  assert.ok(random)

  function harness(surfaceId = 'global-launcher') {
    const deliveries = []
    let closed = 0
    const api = {
      getSelectionText: () => '', getActiveText: () => '',
      async getClipboardText() { throw new Error('Unexpected clipboard read') },
      async copyText(text) { deliveries.push(['copy', text]) },
      async replaceActiveText(text) { deliveries.push(['replace', text]) },
      async pasteToForegroundApp() { throw new Error('Unexpected paste') },
    }
    const controller = new LauncherController({
      surfaceId, api, locale: 'en', makeT: (item) => makePluginT(item.pluginId ?? '', 'en'),
      getSettings: () => ({}), recordSelection() {}, requestClose: () => { closed++ },
      onChange() {}, appendExperienceEvent() {},
    })
    controllers.push(controller)
    return { controller, deliveries, top: () => controller.getState().frames.at(-1), closed: () => closed }
  }

  // Leaving edited text is immediate (no discard prompt); late errors cannot own a new visit.
  {
    const h = harness()
    const item = { ...json, params: undefined, executeWithParams: undefined, execute: async () => ({ ok: false, message: 'Synthetic invalid input' }) }
    await h.controller.selectItem(item, { recordUsage: false })
    h.controller.setInputText('{ synthetic invalid')
    await h.controller.submitInput()
    assert.ok(h.controller.getState().error)
    h.controller.back()
    assert.equal(h.top().kind, 'list', 'edited input leaves without confirmation')
    assert.equal('inputDraftLeave' in h.controller.getState(), false)
    await h.controller.selectItem(item, { recordUsage: false })
    h.controller.setInputText('changed')
    h.controller.exitCommand()
    assert.equal(h.top().kind, 'list', 'exitCommand leaves without confirmation')
    let finish
    const slow = { ...item, execute: () => new Promise(resolve => { finish = resolve }) }
    await h.controller.selectItem(slow, { recordUsage: false })
    h.controller.setInputText('pending')
    const running = h.controller.submitInput()
    await Promise.resolve()
    h.controller.back()
    finish({ ok: false, message: 'late synthetic error' }); await running
    assert.equal(h.top().kind, 'list')
    assert.equal(h.controller.getState().error, null)
  }

  // Real random tool: correcting a failed range must keep the chosen count.
  {
    const h = harness('quick-editor-command')
    await h.controller.selectItem(random, { customizeParams: true, recordUsage: false })
    for (const value of [10, 5, 7]) await h.controller.commitCurrentParam(value)
    assert.match(h.controller.getState().error, /Max can't be less than min/)
    assert.deepEqual(h.deliveries, [])
    h.controller.back()
    assert.equal(h.top().query, '5')
    await h.controller.commitCurrentParam(20)
    assert.equal(h.top().query, '7')
    assert.deepEqual(h.top().params, { min: 10, max: 20, count: 7 })
    await h.controller.commitCurrentParam(h.top().query)
    assert.equal(h.controller.getState().error, null)
    const numbers = h.deliveries[0][1].split('\n').map(Number)
    assert.equal(numbers.length, 7)
    assert.ok(numbers.every((value) => Number.isInteger(value) && value >= 10 && value <= 20))
  }

  // An unsubmitted edit is a draft too, including an intentionally empty field.
  {
    const h = harness('quick-editor-command')
    await h.controller.selectItem(random, { customizeParams: true, recordUsage: false })
    await h.controller.commitCurrentParam(10)
    await h.controller.commitCurrentParam(20)
    for (const query of ['9', '', '1.', '01', '1e2', '2.00', '  ', 'invalid-number']) {
      h.controller.setParamQuery(query)
      h.controller.back()
      assert.equal(h.top().params.count, 1, 'unsubmitted draft does not replace the committed value')
      await h.controller.commitCurrentParam(20)
      assert.equal(h.top().query, query)
    }
    await h.controller.commitCurrentParam(h.top().query)
    assert.match(h.controller.getState().error, /valid number/)
    assert.deepEqual(h.deliveries, [], 'restoring an invalid numeric draft cannot execute it')
    h.controller.setParamQuery('03')
    await h.controller.commitCurrentParam(h.top().query)
    assert.equal(h.top().params.count, 3, 'committing performs number normalization')
    assert.equal(h.top().paramDrafts.count, undefined, 'a committed value replaces its old draft')
  }

  // A retained choice is only a draft: changed options and constraints still apply.
  {
    const h = harness('quick-editor-command')
    let executions = 0
    const params = [
      { key: 'group', label: 'Group', type: 'single-select', required: true, options: ['old', 'new'] },
      { key: 'targets', label: 'Targets', type: 'multi-select', options: ['a', 'b', 'c'], minSelect: 1, maxSelect: 2 },
      { key: 'label', label: 'Label', type: 'text', required: true },
    ]
    const item = {
      systemKey: 'host:test:dependent-options', kind: 'host', display: { title: 'Option validation' },
      behavior: { type: 'perform' }, params,
      execute() { throw new Error('Expected executeWithParams') },
      executeWithParams() { executions++; return { ok: false, message: 'Synthetic retryable error' } },
    }
    await h.controller.selectItem(item, { customizeParams: true, recordUsage: false })
    await h.controller.commitCurrentParam('old')
    h.controller.toggleCurrentMultiParamValue('a')
    h.controller.toggleCurrentMultiParamValue('b')
    await h.controller.commitCurrentParam()
    await h.controller.commitCurrentParam('material label')
    assert.equal(executions, 1)
    h.controller.back()
    h.controller.back()
    params[0].options = ['new']
    params[1].options = ['b', 'c']
    await h.controller.submitParams()
    assert.ok(h.controller.getState().error)
    assert.equal(executions, 1, 'current schema rejects a stale single choice')
    await h.controller.commitCurrentParam('new')
    assert.deepEqual(h.top().params.targets, ['b'], 'unavailable multi choices are removed when revisiting the field')
    assert.equal(h.top().params.label, 'material label')
    h.controller.toggleCurrentMultiParamValue('c')
    params[1].maxSelect = 1
    await h.controller.commitCurrentParam()
    assert.ok(h.controller.getState().error)
    assert.equal(executions, 1, 'a reduced maximum cannot be bypassed by retained selections')
    h.controller.toggleCurrentMultiParamValue('c')
    await h.controller.commitCurrentParam()
    assert.equal(h.top().query, 'material label')
    await h.controller.commitCurrentParam(h.top().query)
    assert.equal(executions, 2)
  }

  console.log('launcher input drafts: real random/JSON recovery, draft lifecycle, stale output and schema validation passed')
} finally {
  for (const controller of controllers) controller.reset()
  await vite.close()
  console.info = originalInfo
}
