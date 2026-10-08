#!/usr/bin/env node
/** Real bundled loader → registry → explicit text tools, with delivery spies. */
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const storedValues = new Map()
const storage = {
  getItem: (key) => storedValues.get(key) ?? null,
  setItem: (key, value) => { storedValues.set(key, value) },
  removeItem: (key) => { storedValues.delete(key) },
}
globalThis.window = {
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  localStorage: storage, sessionStorage: storage,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
}
globalThis.localStorage = storage
globalThis.sessionStorage = storage

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const pluginId = 'json-tools'
const key = 'plugin:json-tools:tool:json.prettify'
let registry
let definition
let originalPreview
let rawTool
try {
  const { jsonToolsPlugin } = await vite.ssrLoadModule('/src/plugins/json-tools/index.ts')
  rawTool = jsonToolsPlugin.tools.find((tool) => tool.id === 'json.prettify')
  originalPreview = rawTool.explicitTextPreview
  let runnerCalls = 0
  let pauseRun
  // Observe the context delivered through the actual bundled loader, while
  // retaining and executing the real plugin's JSON algorithm and error path.
  rawTool.explicitTextPreview = {
    async run(context) {
      runnerCalls += 1
      assert.deepEqual(Object.keys(context).sort(), ['input', 'locale', 'params', 't'])
      assert.deepEqual(Object.keys(context.input), ['text'])
      if (pauseRun) await pauseRun()
      return originalPreview.run(context)
    },
  }

  const { registerBundledPluginPackages } = await vite.ssrLoadModule('/src/workspace/bundledPluginLoader.ts')
  const { collectStaticCandidates, collectStaticPluginItems } = await vite.ssrLoadModule('/src/workspace/launcher/registry.ts')
  const { adaptToolToLauncherItem } = await vite.ssrLoadModule('/src/workspace/launcher/toolAdapter.ts')
  const { computeContractFingerprint } = await vite.ssrLoadModule('/src/workspace/launcher/contractFingerprint.ts')
  const { getHostOutputIntent } = await vite.ssrLoadModule('/src/workspace/launcher/output.ts')
  const { makePluginT } = await vite.ssrLoadModule('/src/i18n/pluginI18nRegistry.ts')
  const { registerActiveEditorContext } = await vite.ssrLoadModule('/src/workspace/editorBridge.ts')
  const { createSavedAction, deleteSavedAction } = await vite.ssrLoadModule('/src/workspace/savedActions/store.ts')
  ;({ pluginRegistry: registry } = await vite.ssrLoadModule('/src/workspace/pluginRegistry.ts'))
  registerBundledPluginPackages()
  definition = registry.getPluginDefinition(pluginId, 'production')
  const tool = definition.tools.find((candidate) => candidate.id === 'json.prettify')
  assert.notEqual(definition, jsonToolsPlugin, 'trust is attached after product metadata and localization')
  assert.notEqual(tool, rawTool, 'trust belongs to the final localized tool object')
  const editorReads = { selection: 0, activeText: 0 }
  registerActiveEditorContext({
    windowLabel: 'editor', activePaneId: 'test-pane', paneIds: ['test-pane'],
    get selectedText() { editorReads.selection += 1; return '{"selected":true}' },
    get activeText() { editorReads.activeText += 1; return '{"document":true}' },
  })
  editorReads.selection = 0
  editorReads.activeText = 0
  const items = collectStaticCandidates('global-launcher')
  assert.deepEqual(editorReads, { selection: 0, activeText: 0 }, 'fresh JSON discovery must not read the editor')
  const item = items.find((candidate) => candidate.systemKey === key)
  assert.ok(item, 'real bundled JSON formatter must be visible in global registry collection')
  assert.equal(item.executionMode, 'explicit-text-preview')
  assert.equal(item.display.title, 'JSON Prettify')
  assert.equal(item.display.titleI18n.zh, 'JSON 格式化')
  assert.deepEqual(items.filter((candidate) => candidate.executionMode).map((candidate) => candidate.systemKey).sort(), [key, 'plugin:encode-decode:tool:base64.decode', 'plugin:line-tools:tool:line-tools.remove-blank-lines', 'plugin:line-tools:tool:line-tools.clean-list'].sort(), 'only the explicitly declared bundled tools opt in')
  assert.ok(collectStaticCandidates('editor-command-bar').some((candidate) => candidate.systemKey === key), 'editor entry remains')
  const workbench = items.find((candidate) => candidate.systemKey === 'plugin:json-tools:launcher:open-format')
  assert.equal(workbench.display.title, 'JSON Prettify Workbench')
  assert.equal(workbench.display.titleI18n.zh, 'JSON 格式化工作台')
  assert.ok(workbench.display.aliases.includes('json format'), 'workbench aliases and identity remain intact')

  const savedRun = {
    status: 'ready', runId: 'registry-read-test', actionKey: key,
    savedParams: { indent: 4, sortKeys: true }, inputBinding: 'prompt',
    outputIntent: 'copy', contractFingerprint: item.contractFingerprint,
    actionPolicy: item.actionPolicy, completedAt: Date.now(),
  }
  const promptArtifact = createSavedAction(savedRun, 'Explicit JSON', [])
  collectStaticCandidates('global-launcher')
  assert.deepEqual(editorReads, { selection: 0, activeText: 0 }, 'prompt-only Saved Actions must not read the editor')
  const selectionArtifact = createSavedAction({ ...savedRun, inputBinding: 'selection' }, 'Selection JSON', [])
  collectStaticCandidates('global-launcher')
  assert.deepEqual(editorReads, { selection: 1, activeText: 0 }, 'legacy selection binding reads only selection on demand')
  deleteSavedAction(selectionArtifact.id)
  const activeArtifact = createSavedAction({ ...savedRun, inputBinding: 'active-text' }, 'Document JSON', [])
  collectStaticCandidates('global-launcher')
  assert.deepEqual(editorReads, { selection: 1, activeText: 1 }, 'legacy active-text binding reads only the document on demand')
  deleteSavedAction(activeArtifact.id)
  deleteSavedAction(promptArtifact.id)

  const deliveries = []
  let hiddenReads = 0
  const api = new Proxy({
    copyText: async (text) => { deliveries.push(['copy', text]) },
    returnToLauncher: async (text) => { deliveries.push(['return', text]) },
  }, {
    get(target, property) {
      if (property in target) return target[property]
      hiddenReads += 1
      throw new Error(`Unexpected implicit host API: ${String(property)}`)
    },
  })
  const ctx = {
    surfaceId: 'global-launcher', locale: 'en', api,
    t: makePluginT(pluginId, 'en'),
    get settings() { throw new Error('Global pure runner must not receive settings') },
    get storage() { throw new Error('Global pure runner must not receive storage') },
    get ai() { throw new Error('Global pure runner must not receive AI') },
  }
  assert.equal((await item.execute(ctx)).ok, false, 'no input must fail without implicit selection/clipboard reads')
  assert.equal((await item.execute({ ...ctxWithoutGetters(ctx), input: { text: '   ' } })).ok, false)
  assert.equal(runnerCalls, 1, 'nonempty whitespace reaches the pure runner and JSON still rejects it')
  const input = '{"z":1,"a":{"c":3,"b":2}}'
  const expected = '{\n    "a": {\n        "b": 2,\n        "c": 3\n    },\n    "z": 1\n}'
  const result = await item.executeWithParams(Object.assign(Object.create(ctx), {
    input: { text: input, source: 'foreground-app' },
  }), { indent: 4, sortKeys: true })
  assert.equal(result.ok, true)
  assert.equal(result.output.choices[0].preview, expected, 'non-default params reach the actual formatter')
  assert.equal(runnerCalls, 2)
  assert.equal(hiddenReads, 0, 'no editor, clipboard, foreground or shell fallback')
  assert.deepEqual(deliveries, [], 'execution produces a preview without delivery')
  const choice = result.output.choices[0]
  assert.equal(getHostOutputIntent(choice), 'copy')
  assert.deepEqual(choice.secondaryActions.map(getHostOutputIntent), ['return-to-launcher'], 'no foreground paste or editor output')
  await choice.primaryAction()
  await choice.secondaryActions[0].run()
  assert.deepEqual(deliveries, [['copy', expected], ['return', expected]])
  const invalid = await item.execute(Object.assign(Object.create(ctx), { input: { text: '{bad' } }))
  assert.equal(invalid.ok, false)
  assert.equal(deliveries.length, 2, 'invalid JSON causes no delivery')

  const ordinaryFingerprint = computeContractFingerprint({ systemKey: key, inputPolicy: tool.inputPolicy, params: tool.params })
  assert.notEqual(item.contractFingerprint, ordinaryFingerprint, 'explicit preview is a material saved-action contract change')
  assert.equal(item.contractFingerprint, computeContractFingerprint({
    systemKey: key, inputPolicy: tool.inputPolicy, params: tool.params, executionMode: 'explicit-text-preview',
  }))

  const editorWrites = []
  const editor = await item.executeWithParams({
    ...ctxWithoutGetters(ctx), surfaceId: 'editor-command-bar',
    api: { getSelectionText: () => input, replaceActiveText: async (text) => { editorWrites.push(text) } },
  }, { indent: 4, sortKeys: true })
  assert.deepEqual(editor, { ok: true }, 'editor retains direct replace flow')
  assert.deepEqual(editorWrites, [expected])

  const forged = adaptToolToLauncherItem(tool, { pluginId, source: 'builtin', systemKey: key })
  assert.equal(forged.executionMode, undefined, 'source label alone grants no trust')
  assert.equal((await forged.execute(Object.assign(Object.create(ctx), { input: { text: input } }))).ok, false)
  const unlocalized = adaptToolToLauncherItem(rawTool, { pluginId, source: 'builtin', systemKey: key, definition: jsonToolsPlugin })
  assert.equal(unlocalized.executionMode, undefined, 'pre-localization references are ineligible')

  registry.registerDevPlugin(pluginId, [], [], [], [], definition)
  const dev = collectStaticPluginItems().find((candidate) => candidate.systemKey === key && candidate.source === 'dev')
  assert.equal(dev.executionMode, undefined, 'even the same definition reference in the dev registry is ineligible')
  registry.unregisterDevPlugin(pluginId)

  const originalTools = definition.tools
  definition.tools = definition.tools.map((candidate) => candidate === tool ? { ...candidate } : candidate)
  assert.equal((await item.execute(Object.assign(Object.create(ctx), { input: { text: input } }))).ok, false, 'tool replacement invalidates an already collected item')
  assert.equal(collectStaticCandidates('global-launcher').some((candidate) => candidate.systemKey === key), false)
  definition.tools = originalTools

  const replacement = { ...definition }
  registry.registerProductionPlugin(pluginId, [], [], [], [], replacement)
  assert.equal((await item.execute(Object.assign(Object.create(ctx), { input: { text: input } }))).ok, false, 'definition replacement invalidates an already collected item')
  assert.equal(collectStaticCandidates('global-launcher').some((candidate) => candidate.systemKey === key), false, 'missing store record builtin fallback cannot grant preview eligibility')
  registry.registerProductionPlugin(pluginId, [], [], [], [], definition)

  const originalRunner = tool.explicitTextPreview.run
  tool.explicitTextPreview.run = () => ({ ok: true, text: 'replacement' })
  assert.equal((await item.execute(Object.assign(Object.create(ctx), { input: { text: input } }))).ok, false, 'runner mutation invalidates cached items')
  tool.explicitTextPreview.run = originalRunner

  let release
  pauseRun = () => new Promise((resolve) => { release = resolve })
  const pending = item.execute(Object.assign(Object.create(ctx), { input: { text: input } }))
  registry.unregisterProductionPlugin(pluginId)
  release()
  assert.equal((await pending).ok, false, 'registration must still be current after asynchronous execution')
  assert.equal(deliveries.length, 2)
  const extensions = [
    {
      pluginId: 'encode-decode', toolId: 'base64.decode', route: 'open-base64-decode',
      title: 'Base64 Decode', titleZh: 'Base64 解码', alias: 'base64 decode',
      cases: [],
    },
    {
      pluginId: 'line-tools', toolId: 'line-tools.remove-blank-lines', route: 'open-line-remove-blank',
      title: 'Remove Blank Lines', titleZh: '删除空行', alias: 'remove blank lines',
      cases: [['\n  中文 🙂  \n \t\nnext \n\n', '  中文 🙂  \nnext '], [' \t\n\r\n  ', '']],
    },
  ]
  const exactDecoded = '  中文 🙂\t \n\n'
  extensions[0].cases = [[Buffer.from(exactDecoded).toString('base64'), exactDecoded], [Buffer.from(' \t\n').toString('base64'), ' \t\n']]
  for (const extension of extensions) {
    const extensionKey = `plugin:${extension.pluginId}:tool:${extension.toolId}`
    const actual = items.find((candidate) => candidate.systemKey === extensionKey)
    assert.equal(actual.executionMode, 'explicit-text-preview')
    assert.equal(actual.display.title, extension.title)
    assert.equal(actual.display.titleI18n.zh, extension.titleZh)
    const route = items.find((candidate) => candidate.systemKey === `plugin:${extension.pluginId}:launcher:${extension.route}`)
    assert.equal(route.display.title, `${extension.title} Workbench`)
    assert.equal(route.display.titleI18n.zh, `${extension.titleZh}工作台`)
    assert.ok(route.display.aliases.includes(extension.alias))
    const extensionDeliveries = []
    const extensionCtx = Object.assign(Object.create(ctx), {
      t: makePluginT(extension.pluginId, 'en'),
      api: {
        copyText: async (text) => { extensionDeliveries.push(['copy', text]) },
        returnToLauncher: async (text) => { extensionDeliveries.push(['return', text]) },
      },
    })
    assert.equal((await actual.execute(extensionCtx)).ok, false)
    assert.equal((await actual.execute(Object.assign(Object.create(extensionCtx), { input: { text: '' } }))).ok, false)
    for (const [source, expectedText] of extension.cases) {
      const beforeDelivery = extensionDeliveries.length
      const result = await actual.execute(Object.assign(Object.create(extensionCtx), { input: { text: source } }))
      assert.equal(result.ok, true)
      const preview = result.output.choices[0]
      assert.equal(preview.preview, expectedText, 'real pure helper preserves meaningful whitespace and Unicode')
      assert.equal(getHostOutputIntent(preview), 'copy')
      assert.deepEqual(preview.secondaryActions.map(getHostOutputIntent), ['return-to-launcher'])
      assert.equal(extensionDeliveries.length, beforeDelivery, 'preview produces no delivery')
      await preview.primaryAction()
      await preview.secondaryActions[0].run()
      assert.deepEqual(extensionDeliveries.slice(beforeDelivery), [['copy', expectedText], ['return', expectedText]])
    }
    if (extension.pluginId === 'encode-decode') {
      const count = extensionDeliveries.length
      assert.equal((await actual.execute(Object.assign(Object.create(extensionCtx), { input: { text: '%%%invalid%%%' } }))).ok, false)
      assert.equal(extensionDeliveries.length, count)
    }
    const [source, expectedText] = extension.cases[0]
    const writes = []
    assert.deepEqual(await actual.execute({
      ...ctxWithoutGetters(extensionCtx), surfaceId: 'editor-command-bar',
      api: { getSelectionText: () => source, replaceActiveText: async (text) => { writes.push(text) } },
    }), { ok: true })
    assert.deepEqual(writes, [expectedText], 'editor tool still replaces directly')
    const currentDefinition = registry.getPluginDefinition(extension.pluginId, 'production')
    const currentTool = currentDefinition.tools.find((candidate) => candidate.id === extension.toolId)
    assert.equal(adaptToolToLauncherItem(currentTool, { pluginId: extension.pluginId, source: 'builtin', systemKey: extensionKey }).executionMode, undefined)
    registry.registerProductionPlugin(extension.pluginId, [], [], [], [], { ...currentDefinition })
    try {
      assert.equal((await actual.execute(Object.assign(Object.create(extensionCtx), { input: { text: source } }))).ok, false, 'new tools also fail closed after source replacement')
      assert.equal(collectStaticCandidates('global-launcher').some((candidate) => candidate.systemKey === extensionKey), false)
    } finally {
      registry.registerProductionPlugin(extension.pluginId, [], [], [], [], currentDefinition)
    }
  }
  console.log('Explicit text preview passed: JSON, Base64 decode and blank-line removal, exact text, restricted context, editor compatibility and source identity')
} finally {
  if (rawTool && originalPreview) rawTool.explicitTextPreview = originalPreview
  registry?.unregisterDevPlugin(pluginId)
  if (registry && definition) registry.registerProductionPlugin(pluginId, [], [], [], [], definition)
  await vite.close()
}

function ctxWithoutGetters(ctx) {
  return { surfaceId: ctx.surfaceId, locale: ctx.locale, api: ctx.api, t: ctx.t, settings: {}, storage: {}, ai: {} }
}
