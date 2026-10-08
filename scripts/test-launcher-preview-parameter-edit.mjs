#!/usr/bin/env node
/** Actual bundled tools, controller and Saved Action projection; no UI snapshots. */
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const values = new Map()
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => { values.set(key, value) },
  removeItem: (key) => { values.delete(key) },
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
  const { collectStaticCandidates, getNearbySaveRunItem } = await vite.ssrLoadModule('/src/workspace/launcher/registry.ts')
  const { LauncherController } = await vite.ssrLoadModule('/src/workspace/launcher/controller.ts')
  const { getHostOutputIntent } = await vite.ssrLoadModule('/src/workspace/launcher/output.ts')
  const { getLastSaveableRun } = await vite.ssrLoadModule('/src/workspace/savedActions/lastSaveableRun.ts')
  const { createSavedAction, listSavedActions } = await vite.ssrLoadModule('/src/workspace/savedActions/store.ts')
  const { projectSavedAction } = await vite.ssrLoadModule('/src/workspace/savedActions/provider.ts')
  const { makePluginT } = await vite.ssrLoadModule('/src/i18n/pluginI18nRegistry.ts')
  registerBundledPluginPackages()
  const items = collectStaticCandidates('global-launcher')
  const json = items.find((item) => item.systemKey === 'plugin:json-tools:tool:json.prettify')
  const lines = items.find((item) => item.systemKey === 'plugin:line-tools:tool:line-tools.clean-list')
  assert.ok(json && lines)
  const runs = []
  const deliveries = []
  const usages = []
  let materialGeneration = 1
  let failCopy = false
  let failReturn = false
  let pauseRun
  const observed = (item) => ({
    ...item,
    executeWithParams: async (ctx, params) => {
      runs.push({ key: item.systemKey, input: ctx.input.text, params: structuredClone(params) })
      if (pauseRun) await pauseRun()
      return item.executeWithParams(ctx, params)
    },
  })
  const formatter = observed({
    ...json,
    params: [...json.params, { key: 'transient', label: 'Transient', type: 'text', default: 'runtime-only', saveable: false }],
    defaultParams: { ...json.defaultParams, transient: 'runtime-only' },
  })
  const cleaner = observed(lines)
  const api = {
    getSelectionText() { throw new Error('No implicit selection read') },
    getActiveText() { throw new Error('No implicit editor read') },
    getClipboardText() { throw new Error('No implicit clipboard read') },
    async copyText(text) { if (failCopy) throw new Error('Copy denied'); deliveries.push(['copy', text]) },
    async returnToLauncher(text) { if (failReturn) throw new Error('Return denied'); deliveries.push(['return', text]) },
  }
  const controller = new LauncherController({
    surfaceId: 'global-launcher', api, locale: 'en',
    makeT: (item) => makePluginT(item.pluginId ?? '', 'en'), getSettings: () => ({}),
    getMaterialGeneration: () => materialGeneration,
    recordSelection: (_surface, item) => usages.push(item.systemKey),
    requestClose() {}, onReturnToRoot() {}, onChange() {},
    appendExperienceEvent() {},
  })
  const top = () => controller.getState().frames.at(-1)
  async function preview(item, input, params) {
    controller.reset()
    await controller.selectItem(item)
    if (item.commitVia !== 'saved-action') {
      for (const param of item.params ?? []) await controller.commitCurrentParam(params[param.key] ?? item.defaultParams?.[param.key] ?? param.default)
    }
    assert.equal(top().kind, 'collect-input')
    controller.setInputText(input)
    await controller.submitInput()
    assert.equal(top().kind, 'result')
    return top()
  }
  const input = '{"z":1,"a":{"c":3,"b":2}}'
  const original = await preview(formatter, input, { indent: 4, sortKeys: true })
  const originalChoice = original.output.choices[0]
  const depth = controller.getState().frames.length
  assert.deepEqual(original.previewEdit.params, { indent: 4, sortKeys: true, transient: 'runtime-only' })
  assert.equal(original.previewEdit.inputText, input)
  assert.equal(await getLastSaveableRun(), null)
  assert.equal(controller.canEditPreviewParam('indent', original), true)
  assert.equal(controller.canEditPreviewParam('missing', original), false)
  controller.editPreviewParam('indent', original)
  assert.equal(top().paramIndex, 0)
  assert.equal(top().query, '4')
  const oldEdit = top()
  await controller.activateChoice(originalChoice)
  await controller.activateSecondary(originalChoice, 'return-to-launcher')
  assert.deepEqual(deliveries, [])
  await controller.commitCurrentParam(2, oldEdit)
  const edited = top()
  assert.equal(edited.kind, 'result', 'one confirmation skips all other parameter questions')
  assert.equal(controller.getState().frames.length, depth, 'repeated edits do not grow the stack')
  assert.deepEqual(runs.at(-1), { key: json.systemKey, input, params: { indent: 2, sortKeys: true, transient: 'runtime-only' } })
  assert.equal(runs.length, 2, 'the confirmed edit executes exactly once')
  assert.equal(edited.output.choices[0].preview, '{\n  "a": {\n    "b": 2,\n    "c": 3\n  },\n  "z": 1\n}')
  assert.notEqual(edited.committedRun.runId, original.committedRun.runId)
  assert.equal(await getLastSaveableRun(), null)
  assert.deepEqual(usages, [], 'parameter edits never count as delivery')
  controller.editPreviewParam('sortKeys', original)
  assert.equal(top(), edited, 'an old result callback cannot edit the new result')

  controller.editPreviewParam('indent', edited)
  const cancelledEdit = top()
  controller.setParamQuery('8', cancelledEdit)
  assert.equal(controller.back(cancelledEdit), true)
  const cancelled = top()
  assert.equal(runs.length, 2, 'cancel performs no computation')
  assert.equal(cancelled.committedRun, edited.committedRun, 'cancel keeps the exact committed run')
  assert.deepEqual(cancelled.previewEdit.params, edited.previewEdit.params)
  assert.equal(cancelled.output.choices[0].preview, edited.output.choices[0].preview)
  assert.notEqual(cancelled.output.choices[0], edited.output.choices[0])
  assert.equal(getHostOutputIntent(cancelled.output.choices[0]), 'copy')
  assert.deepEqual(cancelled.output.choices[0].secondaryActions.map(getHostOutputIntent), ['return-to-launcher'])
  await controller.activateChoice(edited.output.choices[0])
  assert.deepEqual(deliveries, [], 'cancel does not revive pre-edit output callbacks')
  controller.editPreviewParam('sortKeys', cancelled)
  const nextEdit = top()
  controller.setParamQuery('stale', cancelledEdit)
  controller.setParamSelectedIndex(1, cancelledEdit)
  await controller.commitCurrentParam(false, cancelledEdit)
  assert.equal(controller.back(cancelledEdit), false)
  assert.equal(controller.exitCommand(cancelledEdit), false)
  assert.equal(top(), nextEdit, 'old parameter callbacks cannot change a later edit')
  await controller.commitCurrentParam(false, nextEdit)
  assert.equal(runs.length, 3)
  assert.deepEqual(top().previewEdit.params, { indent: 2, sortKeys: false, transient: 'runtime-only' })
  assert.match(top().output.choices[0].preview, /^\{\n  "z"/)
  const deliverable = top()
  failCopy = true
  await controller.activateChoice(deliverable.output.choices[0])
  assert.equal(await getLastSaveableRun(), null, 'failed delivery cannot update LastRun')
  failCopy = false
  await controller.activateChoice(deliverable.output.choices[0])
  const completed = structuredClone(await getLastSaveableRun())
  assert.equal(completed.runId, deliverable.committedRun.runId)
  assert.deepEqual(completed.savedParams, { indent: 2, sortKeys: false }, 'runtime-only parameters never leak into the saved subset')
  assert.equal(usages.length, 1)

  const lineInput = ' A \n\nA\n B'
  await preview(cleaner, lineInput, { trim: false, removeBlank: true, dedup: false })
  for (const [key, value, expected] of [
    ['trim', true, 'A\nA\nB'],
    ['dedup', true, 'A\nB'],
    ['removeBlank', false, 'A\n\nB'],
  ]) {
    const before = top()
    const beforeCount = runs.length
    controller.editPreviewParam(key, before)
    await controller.commitCurrentParam(value)
    assert.equal(runs.length, beforeCount + 1)
    assert.equal(runs.at(-1).input, lineInput, 'each edit starts with the original input, never the previous output')
    assert.deepEqual(top().previewEdit.params, { ...before.previewEdit.params, [key]: value })
    assert.equal(top().output.choices[0].preview, expected)
  }
  assert.deepEqual(await getLastSaveableRun(), completed, 'previews leave the previously completed run untouched')

  const artifact = createSavedAction({ ...completed, outputIntent: 'return-to-launcher' }, 'Saved return', [])
  const saved = projectSavedAction(artifact, formatter)
  const savedBefore = JSON.stringify(listSavedActions())
  await preview(saved, input)
  const savedResult = top()
  assert.equal(getHostOutputIntent(savedResult.output.choices[0]), 'return-to-launcher')
  controller.editPreviewParam('indent', savedResult)
  controller.back()
  assert.equal(top().committedRun, savedResult.committedRun)
  assert.equal(getHostOutputIntent(top().output.choices[0]), 'return-to-launcher', 'cancel restores the Saved Return projection')
  assert.equal(top().output.choices[0].secondaryActions, undefined)
  assert.deepEqual(await getLastSaveableRun(), completed, 'cancelling Saved Action editing leaves LastRun unchanged')
  controller.editPreviewParam('indent', top())
  await controller.commitCurrentParam(4)
  assert.equal(getHostOutputIntent(top().output.choices[0]), 'return-to-launcher', 'recompute retains the saved output destination')
  assert.equal(top().committedRun.via, 'saved-action')
  assert.notEqual(top().committedRun.runId, savedResult.committedRun.runId)
  assert.equal(JSON.stringify(listSavedActions()), savedBefore, 'parameter editing never updates the artifact')
  const editedSavedResult = top()
  assert.deepEqual(await getLastSaveableRun(), completed, 'confirming parameters alone does not replace LastRun')
  failReturn = true
  await controller.activateChoice(editedSavedResult.output.choices[0])
  assert.deepEqual(await getLastSaveableRun(), completed, 'a failed edited Saved Return cannot replace LastRun')
  failReturn = false
  await controller.activateChoice(top().output.choices[0])
  assert.equal(deliveries.at(-1)[0], 'return')
  const savedCompleted = structuredClone(await getLastSaveableRun())
  assert.equal(savedCompleted.runId, editedSavedResult.committedRun.runId)
  assert.equal(savedCompleted.actionKey, json.systemKey, 'edited Saved Action delivery is saveable under the real base action')
  assert.deepEqual(savedCompleted.savedParams, { indent: 4, sortKeys: false })
  assert.equal(savedCompleted.outputIntent, 'return-to-launcher')
  assert.equal(savedCompleted.contractFingerprint, json.contractFingerprint)
  const unchangedArtifact = listSavedActions().find((candidate) => candidate.id === artifact.id)
  assert.deepEqual(unchangedArtifact.savedParams, artifact.savedParams)
  assert.equal(unchangedArtifact.outputIntent, artifact.outputIntent)

  // Red-case chain: an old base Copy must not feed the nearby save after editing a Saved Return.
  const nearby = getNearbySaveRunItem(savedCompleted)
  assert.ok(nearby)
  await controller.selectItem(nearby)
  assert.equal(top().kind, 'collect-input')
  assert.equal(top().inputText, '')
  controller.setInputText('Edited return settings')
  await controller.submitInput()
  assert.equal(top().kind, 'list')
  const newlySaved = listSavedActions().find((candidate) => candidate.id !== artifact.id)
  assert.ok(newlySaved)
  assert.equal(newlySaved.baseActionKey, json.systemKey)
  assert.deepEqual(newlySaved.savedParams, { indent: 4, sortKeys: false })
  assert.equal(newlySaved.outputIntent, 'return-to-launcher')
  assert.doesNotMatch(JSON.stringify(newlySaved), /"inputText"|"outputText"|runtime-only/)
  await preview(projectSavedAction(newlySaved, formatter), input)
  assert.equal(top().output.choices[0].preview, editedSavedResult.output.choices[0].preview)
  assert.equal(getHostOutputIntent(top().output.choices[0]), 'return-to-launcher')
  await controller.activateChoice(top().output.choices[0])
  assert.deepEqual(await getLastSaveableRun(), savedCompleted, 'unedited Saved Action replay retains the existing LastRun policy')
  const legacy = projectSavedAction({ ...artifact, inputBinding: 'selection' }, formatter)
  assert.equal(legacy.params, undefined, 'legacy implicit input bindings have no editing projection')

  for (const action of ['confirm', 'cancel', 'deliver']) {
    await preview(formatter, input, { indent: 4, sortKeys: true })
    const result = top()
    const count = runs.length
    const deliveryCount = deliveries.length
    if (action !== 'deliver') controller.editPreviewParam('indent', result)
    materialGeneration += 1
    if (action === 'confirm') await controller.commitCurrentParam(2)
    else if (action === 'cancel') controller.back()
    else await controller.activateChoice(result.output.choices[0])
    assert.equal(top().kind, 'collect-input')
    assert.equal(top().inputText, input)
    assert.deepEqual(top().params, { indent: 4, sortKeys: true, transient: 'runtime-only' })
    assert.ok(controller.getState().error)
    assert.equal(runs.length, count, `${action} rejects a replaced material before execution`)
    assert.equal(deliveries.length, deliveryCount)
  }
  await preview(formatter, input, { indent: 4, sortKeys: true })
  controller.editPreviewParam('sortKeys', top())
  materialGeneration = undefined
  controller.back()
  assert.equal(top().kind, 'collect-input', 'an inactive supplied getter is not the same as an absent getter')
  materialGeneration = 20

  // Changing the material during a confirmed async run must discard its result.
  await preview(formatter, input, { indent: 4, sortKeys: true })
  controller.editPreviewParam('indent', top())
  let release
  pauseRun = () => new Promise((resolve) => { release = resolve })
  const pending = controller.commitCurrentParam(2)
  assert.equal(controller.getState().busy, true)
  materialGeneration += 1
  release()
  await pending
  pauseRun = undefined
  assert.equal(top().kind, 'collect-input')
  assert.equal(top().inputText, input)
  assert.equal(controller.getState().busy, false)

  // Exact bundled runner identity is read-checked on cancel without executing it.
  await preview(formatter, input, { indent: 4, sortKeys: true })
  controller.editPreviewParam('indent', top())
  const definition = pluginRegistry.getPluginDefinition('json-tools', 'production')
  const tool = definition.tools.find((candidate) => candidate.id === 'json.prettify')
  const oldRunner = tool.explicitTextPreview.run
  const count = runs.length
  tool.explicitTextPreview.run = () => { throw new Error('Stale runner must never execute') }
  try {
    controller.back()
    assert.equal(top().kind, 'collect-input')
    assert.equal(top().inputText, input)
    assert.equal(runs.length, count)
  } finally { tool.explicitTextPreview.run = oldRunner }

  await preview(formatter, input, { indent: 4, sortKeys: true })
  controller.editPreviewParam('indent', top())
  const indentSpec = tool.params.find((param) => param.key === 'indent')
  const saveable = indentSpec.saveable
  const beforeContractChange = runs.length
  indentSpec.saveable = false
  try {
    controller.back()
    assert.equal(top().kind, 'collect-input', 'saveability changes cannot restore the old committed save snapshot')
    assert.equal(top().inputText, input)
    assert.equal(runs.length, beforeContractChange)
    assert.deepEqual(await getLastSaveableRun(), savedCompleted)
  } finally { indentSpec.saveable = saveable }

  await preview(formatter, input, { indent: 4, sortKeys: true })
  controller.editPreviewParam('indent', top())
  pluginRegistry.unregisterProductionPlugin('json-tools')
  controller.invalidateUnavailablePlugin()
  await controller.commitCurrentParam(2)
  assert.equal(top().kind, 'collect-input', 'revoked plugin editing keeps the original input available')
  assert.equal(top().inputText, input)
  assert.ok(controller.getState().error)
  assert.deepEqual(await getLastSaveableRun(), savedCompleted)
  console.log('Preview parameter editing passed: exact single reruns, zero-run cancel, fresh intents, stale callbacks/material/plugin guards, Saved Return and LastRun timing')
} finally {
  console.info = originalInfo
  await vite.close()
}
