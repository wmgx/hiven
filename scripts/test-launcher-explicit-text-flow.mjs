#!/usr/bin/env node
/** Important logic only: actual controller/output/artifact store, no UI mocks. */
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
  const { pluginRegistry } = await vite.ssrLoadModule('/src/workspace/pluginRegistry.ts')
  const { collectStaticCandidates } = await vite.ssrLoadModule('/src/workspace/launcher/registry.ts')
  const { LauncherController } = await vite.ssrLoadModule('/src/workspace/launcher/controller.ts')
  const output = await vite.ssrLoadModule('/src/workspace/launcher/output.ts')
  const { createGlobalLauncherPluginApi } = await vite.ssrLoadModule('/src/launcher/clipboard/globalLauncherApi.ts')
  const { consumePendingObjectBlock } = await vite.ssrLoadModule('/src/launcher/clipboard/pendingObjectBlock.ts')
  const hostReturn = createGlobalLauncherPluginApi({}).returnToLauncher
  const { getLastSaveableRun, setLastSaveableRun } = await vite.ssrLoadModule('/src/workspace/savedActions/lastSaveableRun.ts')
  const store = await vite.ssrLoadModule('/src/workspace/savedActions/store.ts')
  const provider = await vite.ssrLoadModule('/src/workspace/savedActions/provider.ts')
  const { getHostSavedActionItems } = await vite.ssrLoadModule('/src/workspace/launcher/hostActions.ts')
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

  await controller.selectItem(formatter)
  assert.equal(top().kind, 'param-input', 'new mode always asks existing params in schema order')
  assert.equal(top().item.params[top().paramIndex].key, 'indent')
  await controller.commitCurrentParam(4)
  assert.equal(top().item.params[top().paramIndex].key, 'sortKeys')
  await controller.commitCurrentParam(true)
  assert.equal(top().kind, 'collect-input')
  await controller.captureInput()
  controller.setInputText(input)
  await controller.previewInput()
  assert.equal(top().previewOutput, undefined, 'typing must not run a live preview')
  assert.equal(await getLastSaveableRun(), null)
  await controller.submitInput()
  assert.equal(top().kind, 'result', 'single output stays in preview')
  assert.equal(top().output.choices[0].preview, expected)
  assert.deepEqual(deliveries, [])
  assert.equal(await getLastSaveableRun(), null, 'preview is not a completed delivery')
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
  const originalRun = structuredClone(await getLastSaveableRun())
  assert.equal(originalRun.outputIntent, 'return-to-launcher')
  assert.equal(originalRun.inputBinding, 'prompt')
  assert.deepEqual(originalRun.savedParams, { indent: 4, sortKeys: true })
  await controller.activateSecondary(returnedChoice, 'return-to-launcher')
  assert.equal(deliveries.length, 1, 'returned preview is invalid after root navigation')
  assert.equal(store.listSavedActions().length, 0, 'successful output alone never creates a tool')

  const saveCommand = getHostSavedActionItems().find((item) => item.systemKey === 'host:saved-action:save-last')
  await controller.selectItem(saveCommand, { objectBlockText: material })
  assert.equal(top().kind, 'collect-input')
  assert.equal(top().inputText, '', 'material cannot become a name')
  controller.exitCommand()
  assert.equal(store.listSavedActions().length, 0, 'cancelled naming never creates a tool')
  await controller.selectItem(saveCommand, { objectBlockText: material })
  const laterRun = { ...originalRun, actionKey: 'plugin:later:tool:other', runId: 'run_later', savedParams: {} }
  setLastSaveableRun(laterRun)
  let changed = 0
  const unsubscribe = store.subscribeSavedActions(() => { changed++ })
  controller.setInputText('Sorted JSON | neat JSON')
  await controller.submitInput()
  assert.equal(top().kind, 'list')
  assert.equal(rootReturns, 2)
  assert.equal(material, expected, 'save preserves current launcher material')
  assert.equal(closed, 0)
  assert.equal(changed, 1, 'successful save refreshes candidates')
  const artifact = store.listSavedActions()[0]
  assert.equal(artifact.baseActionKey, formatter.systemKey, 'save uses the entry-time snapshot, never a later LastRun')
  assert.deepEqual(artifact.savedParams, { indent: 4, sortKeys: true })
  assert.equal(artifact.outputIntent, 'return-to-launcher')
  assert.doesNotMatch(JSON.stringify(artifact), /ORIGINAL_ATTACHED_MATERIAL|"inputText"|"outputText"/)
  assert.ok(collectStaticCandidates('global-launcher').some((item) => item.savedActionArtifactId === artifact.id))

  const replay = provider.getSavedActionLauncherItems([formatter])[0]
  await controller.selectItem(replay, { objectBlockText: '{"y":2,"b":1}' })
  assert.equal(top().kind, 'result', 'saved params replay without asking the schema again')
  const replayChoice = top().output.choices[0]
  assert.equal(output.getHostOutputIntent(replayChoice), 'return-to-launcher', 'projected primary is return, not copy')
  assert.equal(replayChoice.preview, '{\n    "b": 1,\n    "y": 2\n}')
  assert.equal(deliveries.length, 1, 'saved replay also waits for explicit delivery')
  await controller.activateChoice(replayChoice)
  assert.equal(top().kind, 'list')
  assert.equal(material, '{\n    "b": 1,\n    "y": 2\n}')
  assert.equal((await getLastSaveableRun()).runId, laterRun.runId, 'saved invocation does not replace LastRun')
  assert.equal(closed, 0)

  // Source collisions fail closed before execution, regardless of array order.
  for (const candidates of [[formatter, { ...formatter, source: 'dev' }], [{ ...formatter, source: 'dev' }, formatter]]) {
    const ambiguous = provider.getSavedActionLauncherItems(candidates)[0]
    assert.equal(ambiguous.disabledReason.code, 'ambiguous-action')
    await controller.selectItem(ambiguous, { objectBlockText: input })
    assert.equal(top().kind, 'list')
  }
  // A collected replay frame must observe sources registered after discovery.
  const cachedReplay = collectStaticCandidates('global-launcher').find((item) => item.savedActionArtifactId === artifact.id)
  await controller.selectItem(cachedReplay)
  controller.setInputText(input)
  const productionDefinition = pluginRegistry.getPluginDefinition('json-tools', 'production')
  pluginRegistry.registerDevPlugin('json-tools', [], [], [], [], productionDefinition)
  try {
    await controller.submitInput()
    assert.equal(top().kind, 'collect-input')
    assert.match(controller.getState().error, /Multiple sources/)
  } finally {
    pluginRegistry.unregisterDevPlugin('json-tools')
    controller.exitCommand()
  }

  // Recheck after asynchronous computation as well. Use the actual formatter
  // behind a deferred provider so only timing is controlled by the test.
  let releaseReplay
  const deferredBase = {
    ...formatter,
    executeWithParams: async (ctx, params) => {
      await new Promise((resolve) => { releaseReplay = resolve })
      return formatter.executeWithParams(ctx, params)
    },
  }
  let currentBases = [deferredBase]
  const pendingReplay = provider.getSavedActionLauncherItems(currentBases, {}, () => currentBases)[0]
  await controller.selectItem(pendingReplay)
  controller.setInputText(input)
  const pendingExecution = controller.submitInput()
  currentBases = [deferredBase, { ...formatter, source: 'dev' }]
  releaseReplay()
  await pendingExecution
  assert.equal(top().kind, 'collect-input')
  assert.match(controller.getState().error, /Multiple sources/)
  controller.exitCommand()

  const changedContract = provider.projectSavedAction(artifact, { ...formatter, executionMode: undefined, contractFingerprint: 'changed' })
  assert.equal(changedContract.disabledReason.code, 'contract-changed')

  // Failed persistence must not report success or silently create in-memory artifacts.
  await controller.selectItem(saveCommand)
  controller.setInputText('Must not save')
  const priorValue = storage.getItem('hiven:saved-actions:v1')
  const originalWarn = console.warn
  const expectedSaveWarnings = []
  console.warn = (...args) => {
    if (args[0] === '[hiven] Failed to save Saved Action:') expectedSaveWarnings.push(args)
    else originalWarn(...args)
  }
  window.localStorage = undefined
  await controller.submitInput()
  assert.equal(top().kind, 'collect-input')
  assert.ok(controller.getState().error)
  window.localStorage = { ...storage, setItem() { throw new Error('Quota denied') } }
  await controller.submitInput()
  assert.equal(top().kind, 'collect-input')
  assert.ok(controller.getState().error)
  window.localStorage = { ...storage, setItem() {} }
  await controller.submitInput()
  assert.equal(top().kind, 'collect-input', 'silent no-op storage is also a failure')
  window.localStorage = storage
  console.warn = originalWarn
  assert.equal(expectedSaveWarnings.length, 3)
  assert.equal(storage.getItem('hiven:saved-actions:v1'), priorValue)
  assert.equal(changed, 1)
  controller.exitCommand()
  unsubscribe()

  // Output values are exact, including whitespace and the empty string.
  const explicitItem = (text) => ({
    systemKey: 'host:test:explicit', kind: 'host', display: { title: 'Exact text' },
    behavior: { type: 'perform' }, executionMode: 'explicit-text-preview',
    inputPolicy: { mode: 'auto' }, actionPolicy: { effect: 'pure', learnable: true },
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
    const beforeFailedDelivery = structuredClone(await getLastSaveableRun())
    failDelivery = true
    await controller.activateChoice(choice)
    assert.deepEqual(await getLastSaveableRun(), beforeFailedDelivery)
    await controller.activateSecondary(choice, 'return-to-launcher')
    assert.deepEqual(await getLastSaveableRun(), beforeFailedDelivery)
    failDelivery = false
    await controller.activateChoice(choice)
    assert.deepEqual(deliveries.at(-1), ['copy', text])
    assert.equal((await getLastSaveableRun()).outputIntent, 'copy')
    const count = deliveries.length
    await controller.activateChoice(choice)
    assert.equal(deliveries.length, count, 'a closed explicit preview is invalidated')
  }
  assert.equal(closed, 2, 'copy retains existing close behavior')

  const beforeInvalid = structuredClone(await getLastSaveableRun())
  controller.reset()
  await controller.selectItem(formatter, { objectBlockText: '{bad' })
  await controller.commitCurrentParam(2)
  await controller.commitCurrentParam(false)
  assert.equal(top().kind, 'param-input')
  assert.ok(controller.getState().error)
  assert.deepEqual(await getLastSaveableRun(), beforeInvalid)

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
  // Real newly opted-in tools follow the same controller, delivery and save contract.
  const extensionCases = [
    { key: 'plugin:encode-decode:tool:base64.decode', input: Buffer.from('  中文 🙂\t\n\n').toString('base64'), expected: '  中文 🙂\t\n\n', destination: 'copy' },
    { key: 'plugin:encode-decode:tool:base64.decode', input: Buffer.from(' \t\n').toString('base64'), expected: ' \t\n', destination: 'return' },
    { key: 'plugin:line-tools:tool:line-tools.remove-blank-lines', input: '\n first \n \t\n中文 🙂\n\n', expected: ' first \n中文 🙂', destination: 'return' },
    { key: 'plugin:line-tools:tool:line-tools.remove-blank-lines', input: ' \t\n\r\n ', expected: '', destination: 'copy' },
    { key: 'plugin:line-tools:tool:line-tools.remove-blank-lines', input: ' \t\n\r\n ', expected: '', destination: 'return' },
  ]
  for (const sample of extensionCases) {
    controller.reset()
    const actual = collectStaticCandidates('global-launcher').find((item) => item.systemKey === sample.key)
    const beforeRun = structuredClone(await getLastSaveableRun())
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
    assert.deepEqual(await getLastSaveableRun(), beforeRun, 'new-tool previews cannot be saved as completed runs')
    assert.equal(deliveries.length, deliveryCount)
    const choice = top().output.choices[0]
    if (sample.destination === 'copy') await controller.activateChoice(choice)
    else await controller.activateSecondary(choice, 'return-to-launcher')
    assert.deepEqual(deliveries.at(-1), [sample.destination, sample.expected])
    if (sample.destination === 'return') {
      assert.equal(top().kind, 'list')
      assert.equal(material, sample.expected, 'empty return replaces previous material with an empty payload')
    }
    const completed = structuredClone(await getLastSaveableRun())
    assert.equal(completed.actionKey, sample.key)
    assert.equal(completed.inputBinding, 'prompt')
    assert.deepEqual(completed.savedParams, {})
    const saved = store.createSavedAction(completed, `Saved ${actual.display.title}`, [])
    try {
      const replay = collectStaticCandidates('global-launcher').find((item) => item.savedActionArtifactId === saved.id)
      controller.reset()
      await controller.selectItem(replay, { objectBlockText: sample.input })
      assert.equal(top().kind, 'result')
      assert.equal(top().output.choices[0].preview, sample.expected)
      assert.equal(deliveries.length, deliveryCount + 1, 'replay waits for explicit delivery')
      await controller.activateChoice(top().output.choices[0])
      assert.deepEqual(deliveries.at(-1), [sample.destination, sample.expected])
      assert.deepEqual(await getLastSaveableRun(), completed, 'replay does not overwrite completed-run metadata')
      for (const candidates of [[actual, { ...actual, source: 'dev' }], [{ ...actual, source: 'dev' }, actual]]) {
        const ambiguous = provider.getSavedActionLauncherItems(candidates).find((item) => item.savedActionArtifactId === saved.id)
        assert.equal(ambiguous.disabledReason.code, 'ambiguous-action')
      }
    } finally {
      store.deleteSavedAction(saved.id)
    }
  }
  const beforeInvalidBase64 = structuredClone(await getLastSaveableRun())
  const beforeInvalidDeliveries = deliveries.length
  controller.reset()
  await controller.selectItem(collectStaticCandidates('global-launcher').find((item) => item.systemKey === 'plugin:encode-decode:tool:base64.decode'))
  controller.setInputText('%%%invalid%%%')
  await controller.submitInput()
  assert.equal(top().kind, 'collect-input')
  assert.ok(controller.getState().error)
  assert.equal(deliveries.length, beforeInvalidDeliveries)
  assert.deepEqual(await getLastSaveableRun(), beforeInvalidBase64, 'invalid Base64 never becomes a saveable success')

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
  console.log('Explicit text journey passed: JSON/Base64/blank-line removal, empty material return, exact delivery, save snapshot, durable artifacts, replay, failed writes, stale preview cancellation and legacy behavior')
} finally {
  console.info = originalInfo
  await vite.close()
}
