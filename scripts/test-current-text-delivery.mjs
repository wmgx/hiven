#!/usr/bin/env node
/** Real material, recommendation, executor, controller and paste code; memory-only I/O. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { createServer } from 'vite'

const values = new Map()
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
}
globalThis.window = {
  localStorage: storage, sessionStorage: storage, location: { search: '' },
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
}
globalThis.localStorage = storage
globalThis.sessionStorage = storage
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const forbidden = () => { throw new Error('Unexpected acquisition, history lookup, or delivery') }
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

try {
  const blocks = await vite.ssrLoadModule('/src/launcher/clipboard/objectBlock.ts')
  const material = await vite.ssrLoadModule('/src/launcher/clipboard/currentMaterial.ts')
  const delivery = await vite.ssrLoadModule('/src/launcher/clipboard/currentTextDelivery.ts')
  const { recommendActionsForBlock } = await vite.ssrLoadModule('/src/launcher/clipboard/actionRecommendation.ts')
  const { executeRecommendedAction } = await vite.ssrLoadModule('/src/launcher/clipboard/actionExecutor.ts')
  const { LauncherController } = await vite.ssrLoadModule('/src/workspace/launcher/controller.ts')
  const { requirePluginPermissions } = await vite.ssrLoadModule('/src/workspace/pluginPermissions.ts')
  const { pasteAvailabilityMessageKey } = await vite.ssrLoadModule('/src/workspace/pasteAvailability.ts')
  const { t } = await vite.ssrLoadModule('/src/i18n/index.ts')
  const original = blocks.createHistoryItemObjectBlock({ kind: 'text', text: Array.from({ length: 9 }, (_, i) => `original line ${i + 1}`).join('\r\n') })
  const text = `${original.payloadText}\r\n  edited tenth line ${'complete payload '.repeat(30)}  \r\n\r\n`
  const edited = blocks.createQueryObjectBlock({ query: text })
  const current = material.replaceCurrentMaterial(edited)
  assert.equal(current.previousBlock, null, 'editing retains the existing replacement/no-restore contract')
  assert.equal(original.source, 'history-item')
  assert.equal(original.payloadText.includes('edited'), false, 'history remains untouched')
  assert.equal(edited.source, 'query')
  assert.equal(t('en', 'palette.currentTextSourceInput'), 'Input')
  assert.equal(t('zh', 'palette.currentTextSourceInput'), '输入')

  const actions = recommendActionsForBlock(edited)
  assert.deepEqual(actions.map((action) => action.id), ['paste-current-text', 'copy-current-text', 'open-in-quick-editor'])
  assert.deepEqual(recommendActionsForBlock(original).map((action) => action.id), ['paste-history-text', 'copy-history-text', 'open-history-in-quick-editor'])
  for (const actionId of ['copy-current-text', 'paste-current-text', 'copy-history-text', 'paste-history-text']) {
    const copied = [], pasted = []
    const result = await executeRecommendedAction({ block: edited, action: { id: actionId }, target: 'copy' }, {
      copyText: async (value) => copied.push(value), pasteText: async (value) => pasted.push(value),
      openInEditor: forbidden, openPluginSurface: forbidden, readLocalFileText: forbidden,
    })
    assert.equal(result.ok, true)
    assert.deepEqual(actionId.startsWith('paste') ? pasted : copied, [text], 'full exact edited text, including CRLF and trailing whitespace')
    assert.equal(actionId.startsWith('paste') ? copied.length : pasted.length, 0)
  }
  for (const extras of [
    { payloadText: undefined, preview: 'only a truncated preview' }, { payloadText: '' },
    { secretMasked: true }, { kind: 'secret' }, { kind: 'secret-like' },
    { kind: 'image' }, { kind: 'files' }, { payloadImage: { blobId: 'private' } },
    { payloadFiles: { paths: ['/synthetic/file.txt'] } }, { payloadText: 'binary\0text' },
  ]) {
    const block = { ...edited, ...extras }
    assert.equal(delivery.getCurrentTextPayload(block), null)
    assert.equal(recommendActionsForBlock(block).some((action) => delivery.isCurrentTextDeliveryAction(action.id)), false)
    const result = await executeRecommendedAction({ block, action: { id: 'copy-current-text' }, target: 'copy' }, {
      copyText: forbidden, pasteText: forbidden, openInEditor: forbidden, openPluginSurface: forbidden,
    })
    assert.equal(result.ok, false)
  }
  assert.equal(delivery.getCurrentTextPayload({ ...edited, payloadText: ' \r\n  ' }), ' \r\n  ')
  assert.equal(delivery.getCurrentTextPayload({ ...edited, payloadText: '/synthetic/file.txt', meta: { textOrigin: 'file-content' } }), '/synthetic/file.txt')

  function harness() {
    const h = { generation: 1, block: edited, open: true, visible: true, copied: [], pasted: [], busy: [] }
    h.controller = new LauncherController({
      surfaceId: 'global-launcher', locale: 'en',
      api: { getSelectionText: forbidden, getActiveText: forbidden, getClipboardText: forbidden },
      makeT: () => (key) => key, getSettings: () => ({}), recordSelection: forbidden,
      requestClose: forbidden, onChange() {}, appendExperienceEvent: forbidden,
    })
    h.scope = () => delivery.captureCurrentTextDeliveryScope({
      block: h.block, getMaterialGeneration: () => h.generation,
      hasMaterial: (block) => h.block === block,
      getController: () => h.controller, isOpen: () => h.open, isRootVisible: () => h.visible,
    })
    h.run = delivery.createCurrentTextDelivery((busy) => h.busy.push(busy))
    h.options = (isCurrent = h.scope().isCurrent) => ({
      block: h.block, action: 'copy-current-text', isCurrent,
      copyText: async (value) => h.copied.push(value),
      pasteText: async (value) => { h.pasted.push(value); return { ok: true } },
    })
    return h
  }

  {
    const h = harness(), scope = h.scope()
    h.open = false // Zustand notifies after native paste changes this store field.
    assert.equal(scope.isCurrent(), false)
    assert.equal(scope.isClosingCurrent(), true, 'just-closed native session still owns its feedback before reset')
    h.controller.reset()
    assert.equal(scope.isClosingCurrent(), false, 'closed ownership cannot survive controller reset')
    h.open = true; h.generation++
    assert.equal(scope.isCurrent(), false, 'reopening cannot restore old ownership')
  }

  for (const leave of ['material', 'generation', 'navigation', 'hidden', 'controller']) {
    const h = harness(), options = h.options()
    if (leave === 'material') h.block = blocks.createQueryObjectBlock({ query: 'new material' })
    if (leave === 'generation') h.generation++
    if (leave === 'navigation') h.controller.reset()
    if (leave === 'hidden') h.visible = false
    if (leave === 'controller') h.controller = { getState: () => ({ busy: false, frames: [{ kind: 'list' }] }) }
    assert.equal(await h.run(options), null, `old ${leave} row cannot deliver`)
    assert.equal(h.copied.length + h.pasted.length, 0)
  }
  {
    const h = harness(), done = deferred(), options = h.options()
    const pending = h.run({ ...options, copyText: async (value) => { h.copied.push(value); await done.promise } })
    assert.equal(await h.run({ ...options, action: 'paste-current-text' }), null, 'double click cannot begin another output')
    assert.deepEqual(h.copied, [text]); assert.deepEqual(h.pasted, [])
    h.block = blocks.createQueryObjectBlock({ query: 'newer material' }); h.generation++
    done.resolve()
    assert.equal(await pending, null, 'old completion cannot consume or close newer material')
    assert.equal(h.block.payloadText, 'newer material')
    assert.deepEqual(h.busy, [true, false])
    assert.equal((await h.run(h.options())).ok, true, 'new current material can subsequently deliver')
  }
  {
    const h = harness(), options = h.options()
    const failure = await h.run({ ...options, copyText: async () => { throw new Error('write failed') } })
    assert.equal(failure.message, 'write failed')
    assert.equal((await h.run(options)).ok, true, 'failure releases single-flight guard for explicit retry')
    const done = deferred()
    const pending = h.run({ ...options, copyText: () => done.promise })
    h.controller.reset(); done.reject(new Error('late failure'))
    assert.equal(await pending, null, 'late failure does not surface in newer navigation')
  }

  // Run the actual native paste orchestration with only its I/O replaced.
  const native = { availability: 'can-attempt', writes: [], hides: [], open: true, fail: false }
  const code = ts.transpileModule(readFileSync('src/workspace/pluginPaste.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports = {}
  const modules = {
    './pluginPermissions': { requirePluginPermissions }, './pluginClipboard': { writeClipboardImageBytes: forbidden },
    '../i18n': { t }, '../store': { useAppStore: { getState: () => ({ locale: 'en', setGlobalLauncherOpen: (value) => { native.open = value } }) } },
    './pasteAvailability': { readPasteAvailability: async () => native.availability, pasteAvailabilityMessageKey },
    './nativeClipboard': { writeText: async (value) => native.writes.push(value) },
    '@tauri-apps/api/core': { invoke: async (command, args) => { native.hides.push([command, args]); if (native.fail) throw new Error('native paste failed') } },
  }
  vm.runInNewContext(code, {
    exports, module: { exports }, console, URLSearchParams, Error,
    window: { location: { search: '?window=launcher' } },
    navigator: { clipboard: { writeText: forbidden } },
    require(name) { assert.ok(Object.hasOwn(modules, name), `Unexpected native dependency ${name}`); return modules[name] },
  })
  for (const availability of ['unsupported', 'accessibility-required']) {
    native.availability = availability
    assert.equal((await exports.createPluginPaste().pasteText(text)).fallback, 'none')
    assert.equal(native.writes.length + native.hides.length, 0, 'known unavailable target never writes/hides')
    assert.equal(native.open, true)
  }
  native.availability = 'can-attempt'
  await assert.rejects(exports.createPluginPaste({ 'clipboard.write': { granted: true }, 'accessibility.paste': { granted: false } }).pasteText(text), /permission/i)
  assert.equal(native.writes.length, 0, 'history permission denial retains its boundary')
  native.fail = true
  const fallback = await exports.createPluginPaste().pasteText(text)
  assert.equal(fallback.fallback, 'copied')
  assert.deepEqual(native.writes, [text])
  assert.equal(native.open, false, 'native paste closes its original launcher session before completion')
  assert.equal(native.hides[0][0], 'hide_launcher_and_paste')
  assert.match(fallback.message, /Copied to clipboard/)
  console.log('Current text delivery passed: exact payload, source continuity, exclusions, stale rows, single flight, lifecycle, permissions and native fallback')
} finally {
  await vite.close()
}
