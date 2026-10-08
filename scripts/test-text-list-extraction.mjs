#!/usr/bin/env node
/** Important extraction logic and the actual registry → controller → Saved Action route. */
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
  const { extractTextList } = await vite.ssrLoadModule('/src/plugins/line-tools/extractTextList.ts')
  const urls = [
    'HTTPS://Example.com/Path?q=A&b=2#Part',
    'https://example.com/wiki/A_(B)',
    'http://localhost:8080/a',
    'https://example.com/a%20b?q=%2F',
    'https://[::1]:8080/path',
  ]
  const sourceUrls = `链接：“${urls[0]}”， (${urls[1]}).\r\n<${urls[2]}>; ${urls[3]}! [${urls[4]}]。\n${urls[0]}`
  assert.deepEqual(extractTextList(sourceUrls, 'urls'), urls, 'keep spelling, source order, balanced brackets, query/fragment and first duplicate')
  assert.deepEqual(extractTextList(sourceUrls, 'urls', false), [...urls, urls[0]], 'dedup off retains every occurrence')
  assert.deepEqual(extractTextList('https://example.com/a(b(c)))). https://example.com/x[y]] https://example.com/a{b}}', 'urls'), [
    'https://example.com/a(b(c))', 'https://example.com/x[y]', 'https://example.com/a{b}',
  ], 'remove only excess trailing bracket closers')
  assert.deepEqual(extractTextList('https://EXAMPLE.com/A?b=2&a=1 https://example.com/a?a=1&b=2 https://EXAMPLE.com/A?b=2&a=1', 'urls'), [
    'https://EXAMPLE.com/A?b=2&a=1', 'https://example.com/a?a=1&b=2',
  ], 'URL dedup never changes case, query order, host spelling or path')
  assert.deepEqual(extractTextList('www.example.com ftp://example.com mailto:a@example.com http:// https://?bad prefixhttps://example.com', 'urls'), [], 'require an explicit standalone HTTP(S) scheme and parsed host')
  assert.deepEqual(extractTextList('https://example.com/中文?q=值，https://example.com/next。', 'urls'), ['https://example.com/中文?q=值', 'https://example.com/next'], 'Chinese punctuation separates links while Unicode paths remain intact')
  assert.deepEqual(extractTextList('[https://one.example](https://two.example) https://a.example/x,https://b.example/y;https://c.example/z', 'urls'), [
    'https://one.example', 'https://two.example', 'https://a.example/x', 'https://b.example/y', 'https://c.example/z',
  ], 'Markdown URL labels and punctuation-separated URLs never swallow each other')
  assert.deepEqual(extractTextList('https://example.com/?next=https://other.example/path', 'urls'), ['https://example.com/?next=https://other.example/path'], 'embedded redirect query remains one URL')
  assert.deepEqual(extractTextList('"a.b+tag_1-x@Sub.Example.COM", a.b+tag_1-x@sub.example.com A.b+tag_1-x@sub.example.com; next@example.org.', 'emails'), [
    'a.b+tag_1-x@Sub.Example.COM', 'A.b+tag_1-x@sub.example.com', 'next@example.org',
  ], 'email dedup ignores domain case but preserves local-part case and first spelling')
  assert.deepEqual(extractTextList('a@Example.com a@example.com a@Example.com', 'emails', false), ['a@Example.com', 'a@example.com', 'a@Example.com'])
  const unsupported = [
    '.first@example.com', 'first.@example.com', 'first..last@example.com',
    'a@-example.com', 'a@example-.com', 'a@exam_ple.com', 'a@example..com',
    'a@@example.com', 'a@example', 'a@example.c', 'a@example.123',
    'a!b@example.com', '"quoted local"@example.com', '"foo@bar.com"@example.com', '"foo@bar.com and baz"@example.com',
    'éname@example.com', 'name@example.comé', '用户@example.com', '联系foo@example.com',
    `${'a'.repeat(65)}@example.com`, `a@${'a'.repeat(64)}.com`,
  ]
  assert.deepEqual(extractTextList(unsupported.join(' '), 'emails'), [], 'never salvage partial addresses from invalid labels or unsupported local parts')
  assert.deepEqual(extractTextList('Contact: <a@x.io> (b@sub.example.com), c@example.org...', 'emails'), ['a@x.io', 'b@sub.example.com', 'c@example.org'], 'ordinary text separators and sentence punctuation')
  assert.deepEqual(extractTextList('', 'emails'), [])
  assert.deepEqual(extractTextList('no links or addresses here', 'urls'), [])
  assert.deepEqual(extractTextList(`x@${'.'.repeat(250_000)}a ${'a'.repeat(250_000)}@example.com valid@example.com`, 'emails'), ['valid@example.com'], 'large malformed tokens terminate without backtracking or partial matches')
  assert.deepEqual(extractTextList(`https://${'['.repeat(50_000)} ${'text '.repeat(30_000)} https://example.com/end`, 'urls'), ['https://example.com/end'], 'large malformed URL token does not prevent later valid links')

  const { registerBundledPluginPackages } = await vite.ssrLoadModule('/src/workspace/bundledPluginLoader.ts')
  const { collectStaticCandidates, getNearbySaveRunItem } = await vite.ssrLoadModule('/src/workspace/launcher/registry.ts')
  const { LauncherController } = await vite.ssrLoadModule('/src/workspace/launcher/controller.ts')
  const { getHostOutputIntent } = await vite.ssrLoadModule('/src/workspace/launcher/output.ts')
  const { makePluginT } = await vite.ssrLoadModule('/src/i18n/pluginI18nRegistry.ts')
  const { getLastSaveableRun } = await vite.ssrLoadModule('/src/workspace/savedActions/lastSaveableRun.ts')
  const store = await vite.ssrLoadModule('/src/workspace/savedActions/store.ts')
  const { createGlobalLauncherPluginApi } = await vite.ssrLoadModule('/src/launcher/clipboard/globalLauncherApi.ts')
  const { consumePendingObjectBlock } = await vite.ssrLoadModule('/src/launcher/clipboard/pendingObjectBlock.ts')
  registerBundledPluginPackages()
  const key = 'plugin:line-tools:tool:line-tools.extract-list'
  const item = collectStaticCandidates('global-launcher').find((candidate) => candidate.systemKey === key)
  assert.ok(item, 'actual bundled package exposes the new global tool')
  assert.equal(item.executionMode, 'explicit-text-preview')
  assert.equal(item.requireParamSelection, true)
  assert.deepEqual(item.actionPolicy, { effect: 'pure', learnable: true })
  assert.equal(item.display.title, 'Extract Links / Emails')
  assert.equal(item.display.titleI18n.zh, '提取链接 / 邮箱')
  assert.deepEqual(item.defaultParams, { kind: 'urls', dedup: true })
  assert.deepEqual(item.params.map(({ key, type, default: value, saveable }) => [key, type, value, saveable]), [
    ['kind', 'single-select', 'urls', true], ['dedup', 'boolean', true, true],
  ])
  for (const param of item.params) {
    assert.ok(param.label && param.labelI18n.zh && param.hint && param.hintI18n.zh)
    assert.ok(!param.label.startsWith('param.') && !param.hint.startsWith('param.'))
    for (const option of param.options ?? []) assert.ok(option.label && option.labelI18n.zh)
  }
  for (const surface of ['editor-command-bar', 'quick-editor-command']) {
    assert.ok(collectStaticCandidates(surface).some((candidate) => candidate.systemKey === key))
  }
  const deliveries = []
  let hiddenReads = 0
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
      assert.equal(block.payloadText, text)
    },
    async pasteToForegroundApp() { throw new Error('Unexpected paste') },
    async openUrl() { throw new Error('Extraction cannot open links') },
  }
  const controller = new LauncherController({
    surfaceId: 'global-launcher', api, locale: 'en',
    makeT: (candidate) => makePluginT(candidate.pluginId ?? '', 'en'),
    getSettings: () => ({}), recordSelection() {}, appendExperienceEvent() {}, onChange() {},
    requestClose() {}, onReturnToRoot() {},
  })
  const top = () => controller.getState().frames.at(-1)
  const chooseParams = async (params) => {
    for (const [key, value] of Object.entries(params)) {
      assert.equal(top().kind, 'param-input')
      assert.equal(top().item.params[top().paramIndex].key, key)
      await controller.commitCurrentParam(value)
    }
  }
  for (const [kind, dedup, source, expected, destination] of [
    ['urls', true, sourceUrls, urls.join('\n'), 'copy'],
    ['emails', false, 'A@Example.com A@example.com other@example.org', 'A@Example.com\nA@example.com\nother@example.org', 'return-to-launcher'],
  ]) {
    controller.reset()
    const previousRun = structuredClone(await getLastSaveableRun())
    const beforeDelivery = deliveries.length
    await controller.selectItem(item)
    await chooseParams({ kind, dedup })
    assert.equal(top().kind, 'collect-input')
    await controller.submitInput()
    assert.equal(top().kind, 'collect-input')
    controller.setInputText(source)
    await controller.previewInput()
    assert.equal(top().previewOutput, undefined, 'typing alone does not extract or deliver')
    await controller.submitInput()
    assert.equal(top().kind, 'result')
    const choice = top().output.choices[0]
    assert.equal(choice.preview, expected)
    assert.equal(getHostOutputIntent(choice), 'copy')
    assert.deepEqual(choice.secondaryActions.map(getHostOutputIntent), ['return-to-launcher'])
    assert.equal(deliveries.length, beforeDelivery)
    assert.deepEqual(await getLastSaveableRun(), previousRun, 'preview never creates completed-run metadata')
    if (destination === 'copy') await controller.activateChoice(choice)
    else await controller.activateSecondary(choice, 'return-to-launcher')
    assert.deepEqual(deliveries.at(-1), [destination, expected])
    const completed = structuredClone(await getLastSaveableRun())
    assert.equal(completed.actionKey, key)
    assert.equal(completed.inputBinding, 'prompt')
    assert.equal(completed.outputIntent, destination)
    assert.deepEqual(completed.savedParams, { kind, dedup })
    assert.equal(store.listSavedActions().length, 0)
    controller.reset()
    await controller.selectItem(getNearbySaveRunItem(completed))
    assert.equal(top().kind, 'collect-input')
    controller.setInputText(`Extract ${kind}`)
    await controller.submitInput()
    const artifact = store.listSavedActions()[0]
    assert.deepEqual(artifact.savedParams, { kind, dedup })
    assert.equal(artifact.outputIntent, destination)
    assert.ok(!Object.hasOwn(artifact, 'inputText') && !Object.hasOwn(artifact, 'outputText'))
    assert.ok(!JSON.stringify(artifact).includes('example.org') && !JSON.stringify(artifact).includes('Path?q='), 'material is not saved')
    const replay = collectStaticCandidates('global-launcher').find((candidate) => candidate.savedActionArtifactId === artifact.id)
    controller.reset()
    await controller.selectItem(replay)
    assert.equal(top().kind, 'collect-input', 'saved parameters skip prompts but require fresh material')
    controller.setInputText(source.replaceAll('Example.com', 'New.example.org').replaceAll('example.com', 'new.example.org'))
    await controller.submitInput()
    assert.equal(top().kind, 'result')
    const replayChoice = top().output.choices[0]
    assert.equal(replayChoice.preview, expected.replaceAll('Example.com', 'New.example.org').replaceAll('example.com', 'new.example.org'))
    assert.equal(getHostOutputIntent(replayChoice), destination)
    assert.equal(deliveries.length, beforeDelivery + 1, 'Saved Action replay still waits for explicit delivery')
    await controller.activateChoice(replayChoice)
    assert.deepEqual(deliveries.at(-1), [destination, replayChoice.preview])
    assert.deepEqual(await getLastSaveableRun(), completed)
    store.deleteSavedAction(artifact.id)
  }
  controller.reset()
  await controller.selectItem(item, { objectBlockText: 'Keep this source: https://example.com/preserved' })
  await chooseParams({ kind: 'urls', dedup: true })
  assert.equal(top().kind, 'result', 'explicit attached material uses the same preview route')
  assert.equal(top().output.choices[0].preview, 'https://example.com/preserved')
  const beforeErrors = deliveries.length
  const previousRun = structuredClone(await getLastSaveableRun())
  controller.reset()
  await controller.selectItem(item)
  await chooseParams({ kind: 'emails', dedup: true })
  controller.setInputText('Keep this original text')
  await controller.submitInput()
  assert.equal(top().kind, 'collect-input', 'no-match error stays in the existing input flow')
  assert.equal(top().inputText, 'Keep this original text', 'no-match error preserves the original material')
  assert.ok(controller.getState().error)
  for (const locale of ['en', 'zh']) {
    for (const kind of ['urls', 'emails']) {
      const result = await item.executeWithParams({ surfaceId: 'global-launcher', input: { text: 'Keep this original text' }, api, locale, t: makePluginT('line-tools', locale) }, { kind, dedup: true })
      assert.equal(result.ok, false)
      assert.ok(result.message.includes(kind === 'urls' ? 'http://' : 'name+tag@example.com'), 'localized no-match error gives a usable example')
      assert.equal(/[\u4e00-\u9fff]/.test(result.message), locale === 'zh')
    }
  }
  assert.equal(deliveries.length, beforeErrors, 'no-match result never copies, returns, or overwrites source')
  assert.deepEqual(await getLastSaveableRun(), previousRun)
  assert.equal(hiddenReads, 0)
  console.log('text-list-extraction: URL/email boundaries, punctuation, exact dedup, malformed input, localized errors, actual registry/controller, Copy/Return and Saved Action replay passed')
} finally {
  console.info = originalInfo
  await vite.close()
}
