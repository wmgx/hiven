#!/usr/bin/env node
/** Important logic only: actual controller/output, no UI mocks. */
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const localValues = new Map()
const storage = {
  getItem: (key) => localValues.get(key) ?? null,
  setItem: (key, value) => { localValues.set(key, value) },
  removeItem: (key) => { localValues.delete(key) },
}
globalThis.window = {
  localStorage: storage, sessionStorage: storage,
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
}
globalThis.localStorage = storage
globalThis.sessionStorage = storage
const originalInfo = console.info
console.info = (...args) => { if (args[0] !== '[hiven:launcher-perf]') originalInfo(...args) }
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
try {
  const { registerBundledPluginPackages } = await vite.ssrLoadModule('/src/workspace/bundledPluginLoader.ts')
  const { collectStaticCandidates } = await vite.ssrLoadModule('/src/workspace/launcher/registry.ts')
  const { LauncherController } = await vite.ssrLoadModule('/src/workspace/launcher/controller.ts')
  const output = await vite.ssrLoadModule('/src/workspace/launcher/output.ts')
  const { createGlobalLauncherPluginApi } = await vite.ssrLoadModule('/src/launcher/clipboard/globalLauncherApi.ts')
  const { consumePendingObjectBlock } = await vite.ssrLoadModule('/src/launcher/clipboard/pendingObjectBlock.ts')
  const hostReturn = createGlobalLauncherPluginApi({}).returnToLauncher

  const { makePluginT } = await vite.ssrLoadModule('/src/i18n/pluginI18nRegistry.ts')
  registerBundledPluginPackages()
  const formatter = collectStaticCandidates('global-launcher').find((item) => item.systemKey === 'plugin:json-tools:tool:json.prettify')
  assert.ok(formatter)
  const deliveries = []
  const selectionRecords = []
  let material = 'ORIGINAL_ATTACHED_MATERIAL'
  let closed = 0
  let rootReturns = 0
  let hiddenReads = 0
  let failDelivery = false
  const api = {
    getSelectionText() { hiddenReads++; throw new Error('Implicit selection read') },
    getActiveText() { hiddenReads++; throw new Error('Implicit editor read') },
    getClipboardText() { hiddenReads++; throw new Error('Implicit clipboard read') },
    async copyText(text) {
      if (failDelivery) throw new Error('Copy denied')
      deliveries.push(['copy', text])
    },
    async returnToLauncher(text) {
      if (failDelivery) throw new Error('Return denied')
      deliveries.push(['return', text])
      await hostReturn(text)
      const returnedBlock = consumePendingObjectBlock()
      assert.equal(returnedBlock.source, 'tool-result')
      assert.equal(returnedBlock.payloadText, text, 'real host material bridge preserves even an empty string')
      material = returnedBlock.payloadText
    },
    async pasteToForegroundApp() { throw new Error('Unexpected paste') },
  }
  const makeController = (overrides = {}) => new LauncherController({
    surfaceId: 'global-launcher', api, locale: 'en',
    makeT: (item) => makePluginT(item.pluginId ?? '', 'en'),
    getSettings: () => ({}),
    recordSelection: (_surface, item) => selectionRecords.push(item.systemKey),
    requestClose: () => { closed++ },
    onReturnToRoot: () => { rootReturns++ },
    onChange() {}, appendExperienceEvent() {}, ...overrides,
  })
  const controller = makeController()
  const top = () => controller.getState().frames.at(-1)
  const input = '{"z":1,"a":{"c":3,"b":2}}'
  const expected = '{\n    "a": {\n        "b": 2,\n        "c": 3\n    },\n    "z": 1\n}'

  {
    const plain = makeController()
    await plain.selectItem(formatter)
    assert.equal(plain.getState().frames.at(-1).kind, 'collect-input', 'plain Enter keeps default params and asks only for input')
  }
  await controller.selectItem(formatter, { customizeParams: true })
  assert.equal(top().kind, 'param-input', 'customize asks existing params in schema order')
  assert.equal(top().item.params[top().paramIndex].key, 'indent')
  await controller.commitCurrentParam(4)
  assert.equal(top().item.params[top().paramIndex].key, 'sortKeys')
  await controller.commitCurrentParam(true)
  assert.equal(top().kind, 'collect-input')
  await controller.captureInput()
  controller.setInputText(input)
  await controller.previewInput()
  assert.equal(top().previewOutput, undefined, 'typing must not run a live preview')

  await controller.submitInput()
  assert.equal(top().kind, 'result', 'single output stays in preview')
  assert.equal(top().output.choices[0].preview, expected)
  assert.deepEqual(deliveries, [])

  const cancelledChoice = top().output.choices[0]
  controller.back()
  await controller.activateChoice(cancelledChoice)
  assert.deepEqual(deliveries, [], 'a discarded preview cannot deliver')
  await controller.submitInput()
  const returnedChoice = top().output.choices[0]
  await controller.activateSecondary(returnedChoice, 'return-to-launcher')
  assert.equal(top().kind, 'list', 'return follows host intent to root')
  assert.equal(material, expected)
  assert.equal(rootReturns, 1)
  assert.equal(closed, 0)

  await controller.activateSecondary(returnedChoice, 'return-to-launcher')
  assert.equal(deliveries.length, 1, 'returned preview is invalid after root navigation')

  // Output values are exact, including whitespace and the empty string.
  const explicitItem = (text) => ({
    systemKey: 'host:test:explicit', kind: 'host', display: { title: 'Exact text' },
    behavior: { type: 'perform' }, executionMode: 'explicit-text-preview',
    inputPolicy: { mode: 'auto' }, actionPolicy: { effect: 'pure' },
    contractFingerprint: 'v1:explicit-test',
    execute: async () => output.explicitTextPreviewResult(text, api, 'en'),
  })
  for (const text of ['  padded\n\n', '']) {
    controller.reset()
    await controller.selectItem(explicitItem(text), { objectBlockText: 'explicit material' })
    assert.equal(top().kind, 'result')
    assert.equal(top().output.choices[0].preview, text)
    assert.deepEqual(top().output.choices[0].secondaryActions.map(output.getHostOutputIntent), ['return-to-launcher'])
    const choice = top().output.choices[0]

    failDelivery = true
    await controller.activateChoice(choice)

    await controller.activateSecondary(choice, 'return-to-launcher')

    failDelivery = false
    await controller.activateChoice(choice)
    assert.deepEqual(deliveries.at(-1), ['copy', text])

    const count = deliveries.length
    await controller.activateChoice(choice)
    assert.equal(deliveries.length, count, 'a closed explicit preview is invalidated')
  }
  assert.equal(closed, 2, 'copy retains existing close behavior')

  controller.reset()
  await controller.selectItem(formatter, { objectBlockText: '{bad', customizeParams: true })
  await controller.commitCurrentParam(2)
  await controller.commitCurrentParam(false)
  assert.equal(top().kind, 'param-input')
  assert.ok(controller.getState().error)

  // Pending runs cannot resurrect a preview after back, reset, or input edits.
  for (const invalidate of ['back', 'reset', 'edit']) {
    controller.reset()
    let release
    const deferred = explicitItem('old preview')
    deferred.execute = () => new Promise((resolve) => { release = () => resolve(output.explicitTextPreviewResult('old preview', api)) })
    await controller.selectItem(deferred)
    controller.setInputText('old input')
    const pending = controller.submitInput()
    if (invalidate === 'edit') controller.setInputText('new input')
    else controller[invalidate]()
    release()
    await pending
    assert.notEqual(top().kind, 'result')
    assert.equal(controller.getState().busy, false)
    if (invalidate === 'edit') assert.equal(top().inputText, 'new input')
  }

  // A completed old delivery can record success but cannot close, reset, or
  // inject an error into the user's newer parameter flow.
  for (const outcome of ['copy', 'return', 'reject']) {
    controller.reset()
    await controller.selectItem(explicitItem('pending delivery'), { objectBlockText: 'material' })
    const choice = top().output.choices[0]
    let finish
    const method = outcome === 'return' ? 'returnToLauncher' : 'copyText'
    const original = api[method]
    api[method] = (text) => new Promise((resolve, reject) => {
      finish = async () => {
        if (outcome === 'reject') reject(new Error('Old delivery failed'))
        else { await original(text); resolve() }
      }
    })
    const pending = outcome === 'return'
      ? controller.activateSecondary(choice, 'return-to-launcher')
      : controller.activateChoice(choice)
    controller.reset()
    await controller.selectItem(formatter)
    const newFrame = top()
    const closeCount = closed
    const rootReturnCount = rootReturns
    await finish()
    await pending
    assert.equal(top(), newFrame)
    assert.equal(controller.getState().error, null)
    assert.equal(closed, closeCount)
    assert.equal(rootReturns, rootReturnCount)
    api[method] = original
  }
  // Real newly opted-in tools follow the same controller and delivery contract.
  const extensionCases = [
    { key: 'plugin:encode-decode:tool:base64.decode', input: Buffer.from('  中文 🙂\t\n\n').toString('base64'), expected: '  中文 🙂\t\n\n', destination: 'copy' },
    { key: 'plugin:encode-decode:tool:base64.decode', input: Buffer.from(' \t\n').toString('base64'), expected: ' \t\n', destination: 'return' },
    { key: 'plugin:line-tools:tool:line-tools.remove-blank-lines', input: '\n first \n \t\n中文 🙂\n\n', expected: ' first \n中文 🙂\n', destination: 'return' },
    { key: 'plugin:line-tools:tool:line-tools.remove-blank-lines', input: ' \t\n\r\n ', expected: '', destination: 'copy' },
    { key: 'plugin:line-tools:tool:line-tools.remove-blank-lines', input: ' \t\n\r\n ', expected: '', destination: 'return' },
  ]
  for (const sample of extensionCases) {
    controller.reset()
    const actual = collectStaticCandidates('global-launcher').find((item) => item.systemKey === sample.key)

    const deliveryCount = deliveries.length
    await controller.selectItem(actual)
    assert.equal(top().kind, 'collect-input', 'no invented parameter step for parameter-free tools')
    await controller.submitInput()
    assert.equal(top().kind, 'collect-input', 'truly empty input is still missing')
    assert.ok(controller.getState().error)
    controller.setInputText(sample.input)
    await controller.previewInput()
    assert.equal(top().previewOutput, undefined, 'typing never performs the new tools')
    await controller.submitInput()
    assert.equal(top().kind, 'result', 'nonempty whitespace input is meaningful')
    assert.equal(top().output.choices[0].preview, sample.expected)

    assert.equal(deliveries.length, deliveryCount)
    const choice = top().output.choices[0]
    if (sample.destination === 'copy') await controller.activateChoice(choice)
    else await controller.activateSecondary(choice, 'return-to-launcher')
    assert.deepEqual(deliveries.at(-1), [sample.destination, sample.expected])
    if (sample.destination === 'return') {
      assert.equal(top().kind, 'list')
      assert.equal(material, sample.expected, 'empty return replaces previous material with an empty payload')
    }
  }

  const beforeInvalidDeliveries = deliveries.length
  controller.reset()
  await controller.selectItem(collectStaticCandidates('global-launcher').find((item) => item.systemKey === 'plugin:encode-decode:tool:base64.decode'))
  controller.setInputText('%%%invalid%%%')
  await controller.submitInput()
  assert.equal(top().kind, 'collect-input')
  assert.ok(controller.getState().error)
  assert.equal(deliveries.length, beforeInvalidDeliveries)

  assert.equal(hiddenReads, 0, 'new explicit flow never reads editor/selection/clipboard')
  api.getSelectionText = () => ''
  api.getActiveText = () => ''

  // Ordinary single-choice execution and keep-open cancellation are unchanged.
  controller.reset()
  let ordinaryCalls = 0
  await controller.selectItem({
    systemKey: 'host:test:ordinary', kind: 'host', display: { title: 'Ordinary' },
    behavior: { type: 'perform' }, experienceRecord: false,
    execute: async () => ({ ok: true, output: { choices: [{ id: 'one', title: 'One', primaryAction: () => { ordinaryCalls++ } }] } }),
  })
  assert.equal(ordinaryCalls, 1)
  const cancellation = { id: 'cancel', title: 'Cancel', tone: 'muted', primaryAction: async () => ({ ok: true, keepOpen: true }) }
  const legacyCollect = {
    systemKey: 'host:test:legacy-confirm', kind: 'host', display: { title: 'Legacy' },
    behavior: { type: 'collect-input', input: { allowEmptyInput: true } }, experienceRecord: false,
    execute: async () => ({ ok: true, output: { choices: [cancellation, { id: 'ok', title: 'OK', primaryAction() {} }] } }),
  }
  controller.reset()
  await controller.selectItem(legacyCollect)
  await controller.submitInput()
  const rootReturnCount = rootReturns
  await controller.activateChoice(cancellation)
  assert.equal(top().kind, 'collect-input', 'ordinary cancellation pops only its result layer')
  assert.equal(rootReturns, rootReturnCount)
  console.log('Explicit text journey passed: JSON/Base64/blank-line removal, empty material return, exact delivery, stale preview cancellation and legacy behavior')
} finally {
  console.info = originalInfo
  await vite.close()
}
