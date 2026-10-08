#!/usr/bin/env node
/** Important logic: exact text cleanup plus real bundled registry/controller/Saved Actions. */
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
// Module loading only: no listening HTTP server, browser, or real user storage.
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
try {
  const { cleanLineList, removeBlankLines, trimLineWhitespace, dedupLines } = await vite.ssrLoadModule('/src/plugins/line-tools/core.ts')
  const sample = '  Ada  \r\n\r\nAda\nada\r  Ada  \n \t\r\nZed'
  const variants = [
    { params: { trim: false, removeBlank: false, dedup: false }, expected: sample },
    { params: { trim: false, removeBlank: false, dedup: true }, expected: '  Ada  \r\n\r\nAda\nada\r \t\r\nZed' },
    { params: { trim: false, removeBlank: true, dedup: false }, expected: '  Ada  \r\nAda\nada\r  Ada  \nZed' },
    { params: { trim: false, removeBlank: true, dedup: true }, expected: '  Ada  \r\nAda\nada\rZed' },
    { params: { trim: true, removeBlank: false, dedup: false }, expected: 'Ada\r\n\r\nAda\nada\rAda\n\r\nZed' },
    { params: { trim: true, removeBlank: false, dedup: true }, expected: 'Ada\r\n\r\nada\rZed' },
    { params: { trim: true, removeBlank: true, dedup: false }, expected: 'Ada\r\nAda\nada\rAda\nZed' },
    { params: { trim: true, removeBlank: true, dedup: true }, expected: 'Ada\r\nada\rZed' },
  ]
  for (const { params, expected } of variants) {
    assert.equal(cleanLineList(sample, params), expected, `fixed order: ${JSON.stringify(params)}`)
    assert.equal(cleanLineList('', params), '', 'empty input is stable in the pure algorithm')
    assert.equal(cleanLineList(expected, params), expected, 'cleanup is idempotent')
  }
  assert.equal(cleanLineList(sample), variants[2].expected, 'default removes only blank rows, retaining spacing and duplicates')
  const trimOnly = { trim: true, removeBlank: false, dedup: false }
  const dedupOnly = { trim: false, removeBlank: false, dedup: true }
  assert.equal(cleanLineList('\uFEFF\u00a0\u3000Ada \t Lovelace\u202f\u2003', trimOnly), 'Ada \t Lovelace', 'Unicode edge trim preserves inner whitespace')
  assert.equal(cleanLineList('\u200bAda\u200b\n\u0085', trimOnly), '\u200bAda\u200b\n\u0085', 'zero-width space and NEXT LINE are not JS trim whitespace')
  assert.equal(cleanLineList('A\u2028B\u2029C', trimOnly), 'A\u2028B\u2029C', 'only LF/CRLF/CR split records')
  assert.equal(cleanLineList('é\ne\u0301\nÉ\né', dedupOnly), 'é\ne\u0301\nÉ', 'case and Unicode codepoints remain distinct; first occurrence wins')
  assert.equal(cleanLineList('b\na\nb\nc\na', dedupOnly), 'b\na\nc', 'dedup never sorts')
  assert.equal(cleanLineList('Ada\n\u00a0\u3000\r\nGrace'), 'Ada\nGrace', 'blank detection uses trim even when trim option is off')
  assert.equal(cleanLineList(' \t\r\n\u00a0\r\u3000\n'), '', 'all removed rows become an empty string')

  for (const newline of ['\n', '\r\n', '\r']) {
    assert.equal(cleanLineList(` Ada ${newline}${newline}Grace${newline}`), ` Ada ${newline}Grace${newline}`, 'retained lines keep their separator and terminal newline')
    assert.equal(cleanLineList(`Ada${newline}${newline}Grace`), `Ada${newline}Grace`, 'unterminated final line stays unterminated')
    assert.equal(cleanLineList(`Ada${newline}  `), 'Ada', 'removing an unterminated last blank line also drops the previous separator')
    assert.equal(cleanLineList(`Ada${newline}  ${newline}`), `Ada${newline}`, 'removing a terminated last blank keeps the retained line separator')
    assert.equal(cleanLineList(`Ada${newline}Ada`, dedupOnly), 'Ada', 'deleting final unterminated duplicate does not leave a terminal newline')
    assert.equal(cleanLineList(`Ada${newline}Ada${newline}`, dedupOnly), `Ada${newline}`, 'deleting final terminated duplicate retains a terminal newline')
    assert.equal(cleanLineList(`${newline}${newline}`, dedupOnly), newline, 'one real blank row remains; trailing separator creates no phantom row')
    assert.equal(cleanLineList(`Ada${newline}  `, trimOnly), `Ada${newline}`, 'trim-only preserves the final now-empty row, exposing its preceding separator')
    assert.equal(cleanLineList(`Ada${newline}  ${newline} `, trimOnly), `Ada${newline}${newline}`, 'trim-only must not silently delete trailing empty rows')
  }
  assert.equal(cleanLineList('Ada\r\n \t\nGrace\rZed'), 'Ada\r\nGrace\rZed', 'deleting a middle row drops its separator, not its predecessor’s')
  assert.equal(cleanLineList('Ada\r\n \t\n'), 'Ada\r\n', 'when last row is deleted, last retained row keeps its own separator rather than borrowing the input’s last separator')
  assert.equal(cleanLineList('Ada\r\nAda\nGrace\rGrace\n', dedupOnly), 'Ada\r\nGrace\r', 'duplicates drop their own separators, including a different terminal separator')
  assert.equal(cleanLineList('Ada\r \nGrace', trimOnly), 'Ada\r\n\nGrace', 'trimming an empty LF row after a lone CR cannot merge two separators into one')
  assert.equal(cleanLineList('Ada\rGrace\rAda\r\n\nZed', dedupOnly), 'Ada\rGrace\r\n\nZed', 'dedup-induced CR plus empty LF adjacency retains both logical separators')
  assert.equal(cleanLineList('Ada\r \n \nGrace', trimOnly), 'Ada\r\n\n\nGrace', 'consecutive newly empty rows remain distinct')
  assert.equal(cleanLineList('Ada\r \n ', { trim: true, removeBlank: false, dedup: true }), 'Ada\r', 'repair runs after dropping an unneeded final separator, avoiding unnecessary normalization')
  assert.equal(cleanLineList('Ada\r\n\nGrace', trimOnly), 'Ada\r\n\nGrace', 'collision repair is stable on repeated cleanup')
  const untouched = '\r\n\uFEFF\u0000 \t\nAda\rAda\n'
  assert.equal(cleanLineList(untouched, variants[0].params), untouched, 'all-off is exact identity including control characters and mixed separators')
  assert.equal(cleanLineList('Ada\r\n'.repeat(20_000), { dedup: true }), 'Ada\r\n', 'large repeated lists retain the first line and delimiter')

  // Existing single-step tools keep their historical behavior.
  assert.equal(removeBlankLines(' A \r\n\r\nA\n'), ' A \r\nA')
  assert.equal(trimLineWhitespace(' A \r\n A \n'), 'A\nA\n')
  assert.equal(dedupLines('A\r\nA\nA', false), 'A\r\nA')

  const { registerBundledPluginPackages } = await vite.ssrLoadModule('/src/workspace/bundledPluginLoader.ts')
  const { pluginRegistry } = await vite.ssrLoadModule('/src/workspace/pluginRegistry.ts')
  const { collectStaticCandidates, getNearbySaveRunItem } = await vite.ssrLoadModule('/src/workspace/launcher/registry.ts')
  const { LauncherController } = await vite.ssrLoadModule('/src/workspace/launcher/controller.ts')
  const { getHostOutputIntent } = await vite.ssrLoadModule('/src/workspace/launcher/output.ts')
  const { makePluginT } = await vite.ssrLoadModule('/src/i18n/pluginI18nRegistry.ts')
  const { getLastSaveableRun } = await vite.ssrLoadModule('/src/workspace/savedActions/lastSaveableRun.ts')
  const store = await vite.ssrLoadModule('/src/workspace/savedActions/store.ts')
  const { createGlobalLauncherPluginApi } = await vite.ssrLoadModule('/src/launcher/clipboard/globalLauncherApi.ts')
  const { consumePendingObjectBlock } = await vite.ssrLoadModule('/src/launcher/clipboard/pendingObjectBlock.ts')
  registerBundledPluginPackages()
  const key = 'plugin:line-tools:tool:line-tools.clean-list'
  const item = collectStaticCandidates('global-launcher').find((candidate) => candidate.systemKey === key)
  assert.ok(item, 'actual bundled package registers the new global tool')
  assert.equal(item.executionMode, 'explicit-text-preview')
  assert.deepEqual(item.actionPolicy, { effect: 'pure', learnable: true })
  assert.equal(item.requireParamSelection, true)
  assert.equal(item.display.title, 'Clean Line List')
  assert.equal(item.display.titleI18n.zh, '清理行列表')
  assert.deepEqual(item.defaultParams, variants[2].params)
  assert.deepEqual(item.params.map(({ key, type, default: value, saveable }) => [key, type, value, saveable]), [
    ['trim', 'boolean', false, true], ['removeBlank', 'boolean', true, true], ['dedup', 'boolean', false, true],
  ])
  for (const param of item.params) {
    assert.ok(param.label && param.labelI18n.zh && param.hint && param.hintI18n.zh, 'all parameter labels and hints are localized')
    assert.notEqual(param.label, param.labelI18n.zh)
    assert.ok(!param.label.startsWith('param.') && !param.hint.startsWith('param.'), 'locale keys are resolved by the actual loader')
  }
  assert.ok(collectStaticCandidates('editor-command-bar').some((candidate) => candidate.systemKey === key), 'editor route remains available')
  assert.ok(collectStaticCandidates('quick-editor-command').some((candidate) => candidate.systemKey === key), 'quick editor route remains available')
  const registeredTools = pluginRegistry.getPluginDefinition('line-tools', 'production').tools
  assert.ok(registeredTools.find((tool) => tool.id === 'line-tools.clean-list').explicitTextPreview)
  assert.ok(registeredTools.filter((tool) => !['line-tools.clean-list', 'line-tools.extract-list'].includes(tool.id)).every((tool) => !tool.requireParamSelection), 'existing text tools retain their optional parameter behavior')

  const deliveries = []
  let hiddenReads = 0
  let closeCount = 0
  let returnCount = 0
  const hostReturn = createGlobalLauncherPluginApi({}).returnToLauncher
  const api = {
    getSelectionText() { hiddenReads++; throw new Error('Unexpected selection read') },
    getActiveText() { hiddenReads++; throw new Error('Unexpected editor read') },
    getClipboardText() { hiddenReads++; throw new Error('Unexpected clipboard read') },
    async copyText(text) { deliveries.push(['copy', text]) },
    async returnToLauncher(text) {
      deliveries.push(['return-to-launcher', text])
      await hostReturn(text)
      const block = consumePendingObjectBlock()
      assert.equal(block.source, 'tool-result')
      assert.equal(block.payloadText, text, 'actual return bridge preserves output, including empty strings')
    },
    async pasteToForegroundApp() { throw new Error('Unexpected paste') },
  }
  const controller = new LauncherController({
    surfaceId: 'global-launcher', api, locale: 'en',
    makeT: (candidate) => makePluginT(candidate.pluginId ?? '', 'en'),
    getSettings: () => ({}), recordSelection() {}, appendExperienceEvent() {}, onChange() {},
    requestClose: () => { closeCount++ }, onReturnToRoot: () => { returnCount++ },
  })
  const top = () => controller.getState().frames.at(-1)
  const chooseParams = async (params) => {
    for (const [key, value] of Object.entries(params)) {
      assert.equal(top().kind, 'param-input')
      assert.equal(top().item.params[top().paramIndex].key, key, 'parameters follow the processing order')
      await controller.commitCurrentParam(value)
    }
  }
  const beforeDefault = deliveries.length
  const direct = await item.execute({ surfaceId: 'global-launcher', input: { text: sample }, api, locale: 'en', t: makePluginT('line-tools', 'en') })
  assert.equal(direct.output.choices[0].preview, variants[2].expected, 'real default execution matches the documented defaults')
  assert.equal(deliveries.length, beforeDefault, 'default execution only previews')

  for (const [index, { params, expected }] of variants.entries()) {
    controller.reset()
    const previousRun = structuredClone(await getLastSaveableRun())
    const beforeDelivery = deliveries.length
    await controller.selectItem(item)
    await chooseParams(params)
    assert.equal(top().kind, 'collect-input')
    await controller.submitInput()
    assert.equal(top().kind, 'collect-input', 'an absent explicit input cannot trigger hidden input reads')
    assert.ok(controller.getState().error)
    controller.setInputText(sample)
    await controller.previewInput()
    assert.equal(top().previewOutput, undefined, 'typing alone never executes the tool')
    await controller.submitInput()
    assert.equal(top().kind, 'result')
    const choice = top().output.choices[0]
    assert.equal(choice.preview, expected)
    assert.equal(getHostOutputIntent(choice), 'copy')
    assert.deepEqual(choice.secondaryActions.map(getHostOutputIntent), ['return-to-launcher'])
    assert.equal(deliveries.length, beforeDelivery, 'preview does not deliver')
    assert.deepEqual(await getLastSaveableRun(), previousRun, 'preview cannot create a completed run')
    const destination = index % 2 === 0 ? 'copy' : 'return-to-launcher'
    const previousCloseCount = closeCount
    if (destination === 'copy') await controller.activateChoice(choice)
    else {
      await controller.activateSecondary(choice, 'return-to-launcher')
      assert.equal(top().kind, 'list')
      assert.equal(closeCount, previousCloseCount, 'return keeps the launcher open')
    }
    assert.deepEqual(deliveries.at(-1), [destination, expected])
    const completed = structuredClone(await getLastSaveableRun())
    assert.equal(completed.actionKey, key)
    assert.equal(completed.inputBinding, 'prompt')
    assert.equal(completed.outputIntent, destination)
    assert.deepEqual(completed.savedParams, params, 'false options are saved, not replaced by defaults')
    assert.equal(store.listSavedActions().length, 0, 'delivery alone does not create a Saved Action')

    controller.reset()
    const offer = getNearbySaveRunItem(completed)
    assert.ok(offer, 'the existing nearby save mechanism recognizes the completed tool')
    await controller.selectItem(offer)
    assert.equal(top().kind, 'collect-input')
    controller.setInputText(`Cleanup ${index}`)
    await controller.submitInput()
    assert.equal(top().kind, 'list')
    const artifact = store.listSavedActions()[0]
    assert.equal(artifact.baseActionKey, key)
    assert.deepEqual(artifact.savedParams, params)
    assert.equal(artifact.outputIntent, destination)
    assert.ok(!Object.hasOwn(artifact, 'inputText') && !Object.hasOwn(artifact, 'outputText'), 'Saved Actions store configuration, not material')
    assert.ok(!JSON.stringify(artifact).includes('Ada'), 'the sample text is not saved')

    const replay = collectStaticCandidates('global-launcher').find((candidate) => candidate.savedActionArtifactId === artifact.id)
    controller.reset()
    await controller.selectItem(replay)
    assert.equal(top().kind, 'collect-input', 'replay reuses parameters and still requires new input')
    const replayInput = sample.replaceAll('Ada', 'Grace').replaceAll('ada', 'grace').replaceAll('Zed', 'Lin')
    controller.setInputText(replayInput)
    await controller.submitInput()
    assert.equal(top().kind, 'result')
    const replayChoice = top().output.choices[0]
    assert.equal(replayChoice.preview, expected.replaceAll('Ada', 'Grace').replaceAll('ada', 'grace').replaceAll('Zed', 'Lin'), 'replay uses the three saved flags with new text')
    assert.equal(getHostOutputIntent(replayChoice), destination, 'saved destination becomes the replay primary action')
    assert.equal(deliveries.length, beforeDelivery + 1, 'replay waits for explicit delivery')
    await controller.activateChoice(replayChoice)
    assert.deepEqual(deliveries.at(-1), [destination, replayChoice.preview])
    assert.deepEqual(await getLastSaveableRun(), completed, 'saved replay does not replace last-run metadata')
    store.deleteSavedAction(artifact.id)
  }

  // Empty results are meaningful for both delivery actions, including return material.
  for (const destination of ['copy', 'return-to-launcher']) {
    controller.reset()
    await controller.selectItem(item, { objectBlockText: ' \t\r\n\u00a0\n' })
    await chooseParams(variants[2].params)
    assert.equal(top().kind, 'result', 'attached explicit text proceeds to preview after parameters')
    assert.equal(top().output.choices[0].preview, '')
    const choice = top().output.choices[0]
    if (destination === 'copy') await controller.activateChoice(choice)
    else await controller.activateSecondary(choice, 'return-to-launcher')
    assert.deepEqual(deliveries.at(-1), [destination, ''])
  }
  assert.equal(hiddenReads, 0, 'the global flow never reads editor, selection, clipboard, or foreground text')
  assert.ok(returnCount > 0)

  const editorWrites = []
  const editorResult = await item.executeWithParams({
    surfaceId: 'editor-command-bar', locale: 'en', t: makePluginT('line-tools', 'en'),
    api: { getSelectionText: () => sample, replaceActiveText: async (text) => { editorWrites.push(text) } },
  }, variants[7].params)
  assert.deepEqual(editorResult, { ok: true })
  assert.deepEqual(editorWrites, [variants[7].expected], 'editor execution retains the existing direct replace route')

  console.log('line-list-cleanup: pure text cases, all 8 parameter combinations, actual registry/controller, Copy/Return and Saved Action replay passed')
} finally {
  console.info = originalInfo
  await vite.close()
}
