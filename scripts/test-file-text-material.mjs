#!/usr/bin/env node
/** Material/async boundary behavior; synthetic payloads, no filesystem or clipboard reads. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const values = new Map()
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
}
const frames = new Map()
let frameId = 0
const noop = () => {}
function load(path, modules = {}) {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, {
    exports, module: { exports }, console, Date, Error, TextEncoder, structuredClone,
    localStorage: storage, window: { setTimeout, clearTimeout },
    requestAnimationFrame: (callback) => { frames.set(++frameId, callback); return frameId },
    cancelAnimationFrame: (id) => frames.delete(id),
    require(name) {
      assert.ok(Object.hasOwn(modules, name), `Unexpected dependency ${name} in ${path}`)
      return modules[name]
    },
  }, { filename: path })
  return exports
}
const content = load('src/kits/content/detectContent.ts')
const snapshot = load('src/launcher/clipboard/clipboardSnapshot.ts', { '../../kits/content/index': content })
const attach = load('src/launcher/clipboard/attachPolicy.ts', { '../../kits/content/index': content, './clipboardSnapshot': snapshot })
const blocks = load('src/launcher/clipboard/objectBlock.ts', { './clipboardSnapshot': snapshot, './attachPolicy': attach })
const material = load('src/launcher/clipboard/currentMaterial.ts')
const pending = load('src/launcher/clipboard/pendingObjectBlock.ts')
const dialogOptions = []
const fileText = load('src/launcher/clipboard/fileTextMaterial.ts', {
  './clipboardSnapshot': snapshot, './objectBlock': blocks,
  '@tauri-apps/plugin-dialog': { open: async (options) => { dialogOptions.push(options); return null } },
})
const { captureRootFileTextSession } = load('src/launcher/clipboard/fileTextInputSession.ts')
const fileBlock = (paths = ['/synthetic/example.json']) => blocks.createHistoryItemObjectBlock({ kind: 'files', paths, fileNames: paths.map((p) => p.split('/').at(-1)) })
const textBlock = (text, source = 'clipboard') => blocks.createGenericObjectBlock({ source, kind: 'text', title: 'synthetic', text })
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve() }

assert.equal(fileText.getAttachedTextFilePath(fileBlock()), '/synthetic/example.json')
assert.equal(fileText.getAttachedTextFilePath(textBlock('"/synthetic/with space.md"')), '/synthetic/with space.md')
assert.equal(fileText.getAttachedTextFilePath(textBlock('file:///synthetic/space%20name.txt', 'history-item')), '/synthetic/space name.txt')
assert.equal(fileText.getAttachedTextFilePath(fileBlock(['C:\\synthetic\\test.TXT'])), 'C:\\synthetic\\test.TXT')
for (const block of [
  null, fileBlock([]), fileBlock(['/synthetic/a.txt', '/synthetic/b.txt']),
  fileBlock(['/synthetic/photo.png']), fileBlock(['relative.txt']), fileBlock(['//server/share.txt']),
  textBlock('/synthetic/a.json', 'query'), textBlock('/synthetic/a.json', 'editor-pane'),
  textBlock('/synthetic/a.json', 'tool-result'), textBlock('bare.txt'), textBlock('../relative.md'),
  textBlock('/synthetic/a.txt\n/synthetic/b.txt'), textBlock('https://example.test/input.json'),
  { ...fileBlock(), payloadImage: { blobId: 'image' } }, { ...fileBlock(), secretMasked: true },
]) assert.equal(fileText.getAttachedTextFilePath(block), null)

// Minimal hook runtime exercises the production lifecycle without rendering UI.
function hookRuntime() {
  const slots = []
  let index = 0, dirty = false, scheduled = []
  const changed = (before, after) => !before || before.length !== after.length || after.some((value, i) => !Object.is(before[i], value))
  const react = {
    useState(initial) {
      const slot = index++
      if (!slots[slot]) slots[slot] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[slot].value, (next) => {
        const value = typeof next === 'function' ? next(slots[slot].value) : next
        if (!Object.is(value, slots[slot].value)) { slots[slot].value = value; dirty = true }
      }]
    },
    useRef(initial) {
      const slot = index++
      return (slots[slot] ??= { current: initial })
    },
    useCallback(callback, deps) {
      const slot = index++
      if (!slots[slot] || changed(slots[slot].deps, deps)) slots[slot] = { callback, deps }
      return slots[slot].callback
    },
    useEffect(effect, deps) {
      const slot = index++
      if (!slots[slot] || changed(slots[slot].deps, deps)) {
        const old = slots[slot]
        slots[slot] = { deps, cleanup: old?.cleanup }
        scheduled.push(() => { old?.cleanup?.(); slots[slot].cleanup = effect() })
      }
    },
  }
  return {
    react,
    render(run) {
      let result, guard = 0
      do {
        assert.ok(guard++ < 15, 'hook must settle')
        index = 0; dirty = false; scheduled = []
        result = run()
        for (const effect of scheduled) effect()
      } while (dirty)
      return result
    },
    unmount() { for (const slot of slots) slot?.cleanup?.() },
  }
}

let hiddenReads = 0, explicitReads = []
const forbiddenRead = () => { hiddenReads++; throw new Error('Unexpected implicit input read') }
function session(initial = fileBlock(), options = {}) {
  pending.clearPendingObjectBlock()
  if (initial) pending.setPendingObjectBlock(initial)
  const runtime = hookRuntime()
  const reads = [], choices = []
  let focusLeases = 0, completed = 0
  const hook = load('src/launcher/clipboard/useClipboardObjectBlock.ts', {
    react: runtime.react,
    './objectBlock': blocks, './pendingObjectBlock': pending, './clipboardSnapshot': snapshot,
    './currentMaterial': material,
    './fileTextMaterial': { ...fileText, readAttachedTextFile: (path) => {
      explicitReads.push(path)
      return new Promise((resolve, reject) => reads.push({ path, resolve, reject }))
    } },
    '../../workspace/launcher/perf': { launcherPerfNow: () => 0, logLauncherPerfDuration: noop },
    '../../workspace/telemetry': { TelemetryEvents: {}, trackBehavior: noop },
  }).useClipboardObjectBlock
  let open = true
  const picker = options.picker ? {
    choose: () => new Promise((resolve, reject) => choices.push({ resolve, reject })),
    beginSession: options.beginSession ?? (() => () => true),
    acquireFocusLease: () => { focusLeases++; return () => { focusLeases-- } },
    onComplete: () => { completed++ },
  } : undefined
  const render = () => runtime.render(() => hook({ open, readClipboard: options.readClipboard ?? forbiddenRead, filePicker: picker }))
  return { initial, reads, choices, get focusLeases() { return focusLeases }, get completed() { return completed }, render, close: () => { open = false; return render() }, reopen: () => { open = true; return render() }, unmount: runtime.unmount }
}

const exact = '\ufeff  {"hello":"世界"}\r\n\r\n  '
{
  const test = session()
  let state = test.render()
  const getGeneration = state.getMaterialGeneration
  const initialGeneration = getGeneration()
  assert.equal(typeof initialGeneration, 'number')
  assert.equal(test.render().getMaterialGeneration(), initialGeneration, 'render alone keeps material identity')
  assert.equal(explicitReads.length, 0, 'attaching never reads automatically')
  assert.equal(state.canReadFileText, true)
  const staleButton = state.readFileText
  state.readFileText(); state.readFileText()
  assert.equal(test.reads.length, 1, 'repeated clicks share the current request')
  state = test.render()
  assert.equal(state.isReadingFileText, true)
  assert.equal(state.block, test.initial, 'original stays in place while reading')
  test.reads[0].resolve(exact)
  await flush()
  state = test.render()
  assert.equal(state.block.payloadText, exact)
  assert.equal(state.block.meta.textOrigin, 'file-content')
  assert.equal(state.block.meta.fileName, 'example.json')
  assert.equal(state.canReadFileText, false)
  assert.equal(state.canRestorePreviousMaterial, true)
  assert.equal(pending.peekPendingObjectBlock().payloadText, exact)
  staleButton()
  assert.equal(test.reads.length, 1, 'stale file button cannot read replacement material')
  const loaded = state.block
  const loadedGeneration = getGeneration()
  pending.setPendingObjectBlock(blocks.createToolResultObjectBlock('processed text'))
  assert.notEqual(getGeneration(), loadedGeneration, 'explicit material changes invalidate synchronously before render')
  state = test.render()
  assert.equal(state.block.meta.textOrigin, 'file-content', 'processing keeps literal content provenance')
  assert.equal(state.block.meta.fileName, undefined, 'tool output does not borrow the old file identity')
  assert.equal(state.canReadFileText, false, 'unnamed literal output still cannot trigger another file read')
  state.restorePreviousMaterial()
  state = test.render()
  assert.equal(state.block, loaded, 'processing and restore preserve loaded text provenance')
  assert.equal(state.block.payloadText, exact)
  const draft = state.beginTextEdit()
  assert.ok(draft.commit('/synthetic/looks-like-another-file.json'))
  state = test.render()
  assert.equal(state.block.meta.textOrigin, 'file-content', 'editing cannot re-enable hidden path reads')
  assert.equal(state.canReadFileText, false)
  const beforeClose = getGeneration()
  test.close()
  assert.equal(getGeneration(), undefined, 'closed material session cannot validate a preview')
  state = test.reopen()
  assert.notEqual(getGeneration(), beforeClose, 'reopening cannot revive the prior material identity')
  assert.equal(state.block.payloadText, '/synthetic/looks-like-another-file.json')
  assert.equal(state.block.meta.textOrigin, 'file-content', 'handoff backup preserves provenance across sessions')
  test.unmount()
  assert.equal(getGeneration(), undefined, 'unmounted material session cannot validate a preview')
}
{
  const test = session()
  test.render().readFileText(); test.reads[0].resolve('')
  await flush()
  let state = test.render()
  assert.equal(state.block.payloadText, '', 'empty file is valid exact material')
  assert.equal(state.canEditText, true)
  state.restorePreviousMaterial()
  state = test.render()
  assert.equal(state.block, test.initial, 'read itself can restore the original file object')
  test.unmount()
}
for (const code of [
  ...Object.keys(fileText.FILE_TEXT_ERROR_KEYS),
  ...Object.keys(fileText.FILE_TEXT_ERROR_KEYS).map((key) => new Error(key)),
  new Error('private path must not escape'),
]) {
  const test = session()
  test.render().readFileText(); test.reads[0].reject(code)
  await flush()
  const state = test.render()
  assert.equal(state.block, test.initial)
  assert.equal(state.isReadingFileText, false)
  const message = code instanceof Error ? code.message : code
  assert.equal(state.fileTextError, Object.hasOwn(fileText.FILE_TEXT_ERROR_KEYS, message) ? message : 'read_failed')
  state.readFileText()
  assert.equal(test.reads.length, 2, 'failure permits an explicit retry')
  test.unmount()
}
for (const interrupt of ['cancel', 'remove', 'replace', 'close-reopen', 'unmount']) {
  for (const failure of [false, true]) {
    const test = session()
    let state = test.render()
    state.readFileText()
    if (interrupt === 'cancel') state.cancelFileTextRead()
    if (interrupt === 'remove') state.removeBlock()
    if (interrupt === 'replace') pending.setPendingObjectBlock(textBlock('new material', 'query'))
    if (interrupt === 'close-reopen') { test.close(); test.reopen() }
    if (interrupt === 'unmount') test.unmount()
    const before = interrupt === 'unmount' ? pending.peekPendingObjectBlock() : test.render().block
    if (failure) test.reads[0].reject('not_found')
    else test.reads[0].resolve('late material must never apply')
    await flush()
    if (interrupt === 'unmount') assert.equal(pending.peekPendingObjectBlock(), before)
    else {
      state = test.render()
      assert.equal(state.block, before, `${interrupt} discards late completion`)
      assert.equal(state.fileTextError, null, `${interrupt} discards late error`)
      assert.equal(state.isReadingFileText, false)
      test.unmount()
    }
  }
}
{
  const test = session()
  let state = test.render()
  state.readFileText(); state.cancelFileTextRead(); state.readFileText()
  test.reads[0].resolve('old'); await flush()
  state = test.render()
  assert.equal(state.isReadingFileText, true, 'old result cannot finish a newer request')
  test.reads[1].resolve('new'); await flush()
  assert.equal(test.render().block.payloadText, 'new')
  test.unmount()
}

// The native chooser has a single allowlisted filter and never widens query-path reads.
assert.equal(await fileText.chooseTextMaterialFile({ title: 'synthetic title', filterName: 'synthetic files' }), null)
assert.equal(dialogOptions[0].multiple, false)
assert.equal(dialogOptions[0].directory, false)
assert.equal(dialogOptions[0].title, 'synthetic title')
assert.equal(dialogOptions[0].filters.length, 1)
assert.equal(dialogOptions[0].filters[0].name, 'synthetic files')
assert.ok(dialogOptions[0].filters[0].extensions.includes('json'))
assert.ok(!dialogOptions[0].filters[0].extensions.includes('*'))

// Root controller identity is captured before acquisition; returning to root is a new flow.
{
  let state = { busy: false, frames: [{ kind: 'list' }] }, visible = true
  let controller = { getState: () => state }
  const begin = () => captureRootFileTextSession({ getController: () => controller, isRootVisible: () => visible })
  const first = begin()
  assert.equal(first(), true)
  state = { busy: false, frames: [{ kind: 'list' }, { kind: 'collect-input' }] }
  assert.equal(first(), false)
  assert.equal(begin(), null)
  state = { busy: false, frames: [{ kind: 'list' }] }
  assert.equal(first(), false, 'return to root never revives an older chooser')
  const second = begin()
  controller = { getState: () => state }
  assert.equal(second(), false, 'replacement controller cannot claim the old request')
  visible = false
  assert.equal(begin(), null)
  visible = true; state = { busy: true, frames: [{ kind: 'list' }] }
  assert.equal(begin(), null)
}

for (const initial of [null, textBlock('old material', 'query'), fileBlock()]) {
  for (const text of ['', exact, '/synthetic/another-file.json']) {
    const test = session(initial, { picker: true })
    let state = test.render()
    const stalePick = state.pickTextFile
    state.pickTextFile(); state.pickTextFile()
    assert.equal(test.choices.length, 1, 'duplicate clicks open only one chooser')
    assert.equal(test.focusLeases, 1, 'focus lease exists before native chooser settles')
    assert.equal(test.reads.length, 0)
    state = test.render()
    assert.equal(state.isPickingTextFile, true)
    assert.equal(state.block, initial)
    test.choices[0].resolve('/synthetic/chosen.MD'); await flush()
    assert.equal(test.focusLeases, 0, 'focus belongs to native chooser only')
    state = test.render()
    assert.equal(state.isPickingTextFile, false)
    assert.equal(state.isReadingFileText, true)
    assert.equal(test.reads[0].path, '/synthetic/chosen.MD')
    state.pickTextFile()
    assert.equal(test.choices.length, 1, 'reading keeps duplicate selection gated')
    test.reads[0].resolve(text); await flush()
    state = test.render()
    assert.equal(state.block.payloadText, text)
    assert.equal(state.block.meta.textOrigin, 'file-content')
    assert.equal(state.block.meta.fileName, 'chosen.MD')
    assert.equal(state.canReadFileText, false)
    assert.equal(state.canRestorePreviousMaterial, Boolean(initial))
    assert.equal(test.completed, 1)
    stalePick()
    assert.equal(test.choices.length, 1, 'old entry cannot replace newer material')
    if (initial) {
      state.restorePreviousMaterial(); state = test.render()
      assert.equal(state.block, initial)
      assert.equal(state.canRestorePreviousMaterial, false)
    }
    test.unmount()
  }
}

// Cancellation and failure preserve both material and its existing one-step restore.
for (const outcome of ['cancel', 'picker-failed', 'unsupported', 'array', 'read-failed']) {
  const test = session(textBlock('original', 'query'), { picker: true })
  let state = test.render()
  pending.setPendingObjectBlock(blocks.createToolResultObjectBlock('current result'))
  state = test.render()
  const before = state.block
  state.pickTextFile()
  if (outcome === 'picker-failed') test.choices[0].reject(new Error('sensitive private path'))
  else test.choices[0].resolve(outcome === 'cancel' ? null : outcome === 'unsupported' ? '/synthetic/no.exe' : outcome === 'array' ? ['/synthetic/a.txt'] : '/synthetic/a.txt')
  await flush()
  if (outcome === 'read-failed') { test.reads[0].reject('too_large'); await flush() }
  state = test.render()
  assert.equal(state.block, before)
  assert.equal(test.focusLeases, 0)
  assert.equal(state.isPickingTextFile, false)
  assert.equal(state.isReadingFileText, false)
  assert.equal(state.fileTextError, outcome === 'cancel' ? null : outcome === 'picker-failed' ? 'picker_failed' : outcome === 'read-failed' ? 'too_large' : 'unsupported_file')
  assert.equal(state.canRestorePreviousMaterial, true)
  state.restorePreviousMaterial(); state = test.render()
  assert.equal(state.block, test.initial)
  test.unmount()
}

// Invalidate during either await; rejected promises are discarded exactly like successful ones.
for (const phase of ['chooser', 'read']) {
  for (const interrupt of ['cancel', 'remove', 'replace', 'consume', 'close-reopen', 'unmount', 'root-change']) {
    for (const failure of [false, true]) {
      let rootCurrent = true
      const test = session(fileBlock(), { picker: true, beginSession: () => () => rootCurrent })
      let state = test.render()
      state.pickTextFile()
      if (phase === 'read') { test.choices[0].resolve('/synthetic/chosen.txt'); await flush() }
      if (interrupt === 'cancel') state.cancelFileTextRead()
      if (interrupt === 'remove') state.removeBlock()
      if (interrupt === 'consume') state.markBlockConsumed()
      if (interrupt === 'replace') pending.setPendingObjectBlock(textBlock('new material', 'query'))
      if (interrupt === 'close-reopen') { test.close(); test.reopen() }
      if (interrupt === 'unmount') test.unmount()
      if (interrupt === 'root-change') rootCurrent = false
      const before = interrupt === 'unmount' ? pending.peekPendingObjectBlock() : test.render().block
      if (phase === 'chooser') {
        const sessionEnded = interrupt === 'close-reopen' || interrupt === 'unmount'
        assert.equal(test.focusLeases, sessionEnded ? 0 : 1, 'discarding a result must not release a still-open chooser')
        if (!sessionEnded) assert.equal(test.render().isPickingTextFile, true)
      }
      const request = phase === 'chooser' ? test.choices[0] : test.reads[0]
      if (failure) request.reject(new Error('late private error'))
      else request.resolve(phase === 'chooser' ? '/synthetic/late.txt' : 'late contents')
      await flush()
      assert.equal(test.focusLeases, 0)
      assert.equal(test.completed, 0, 'stale completion cannot focus a different flow')
      if (phase === 'chooser') assert.equal(test.reads.length, 0, 'stale chooser never reads the selected path')
      if (interrupt === 'unmount') assert.equal(pending.peekPendingObjectBlock(), before)
      else {
        state = test.render()
        assert.equal(state.block, before)
        assert.equal(state.fileTextError, null)
        assert.equal(state.isPickingTextFile, false)
        assert.equal(state.isReadingFileText, false)
        test.unmount()
      }
    }
  }
}
{
  const test = session(fileBlock(), { picker: true })
  let state = test.render()
  state.pickTextFile(); state.cancelFileTextRead(); state.pickTextFile()
  assert.equal(test.focusLeases, 1)
  assert.equal(test.choices.length, 1, 'a cancelled but still-open chooser blocks a second native dialog')
  test.choices[0].resolve('/synthetic/old.txt'); await flush()
  assert.equal(test.reads.length, 0)
  assert.equal(test.focusLeases, 0)
  state = test.render(); state.pickTextFile()
  assert.equal(test.focusLeases, 1)
  test.choices[1].resolve('/synthetic/new.txt'); await flush()
  test.reads[0].resolve('new'); await flush()
  assert.equal(test.render().block.payloadText, 'new')
  test.unmount()
}

// A disposed session's chooser may settle after a new session owns its own lease.
{
  const test = session(fileBlock(), { picker: true })
  test.render().pickTextFile()
  test.close(); test.reopen().pickTextFile()
  assert.equal(test.focusLeases, 1)
  test.choices[0].resolve('/synthetic/old.txt'); await flush()
  assert.equal(test.reads.length, 0)
  assert.equal(test.focusLeases, 1, 'old session finally cannot release the new chooser lease')
  test.choices[1].resolve('/synthetic/new.txt'); await flush()
  test.reads[0].resolve('new session'); await flush()
  assert.equal(test.render().block.payloadText, 'new session')
  test.unmount()
}

// Starting explicit selection reserves material against the already-running auto read,
// including when the user cancels or selection/read fails.
for (const outcome of ['success', 'cancel', 'failure']) {
  let resolveClipboard
  const test = session(null, { picker: true, readClipboard: () => new Promise((resolve) => { resolveClipboard = resolve }) })
  let state = test.render()
  for (const [id, callback] of [...frames]) { frames.delete(id); callback() }
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(typeof resolveClipboard, 'function')
  state.pickTextFile()
  resolveClipboard('older clipboard result'); await flush()
  assert.equal(test.render().block, null)
  if (outcome === 'failure') test.choices[0].reject(new Error('native failed'))
  else test.choices[0].resolve(outcome === 'cancel' ? null : '/synthetic/new.txt')
  await flush()
  if (outcome === 'success') { test.reads[0].resolve('selected'); await flush() }
  state = test.render()
  assert.equal(state.block?.payloadText ?? null, outcome === 'success' ? 'selected' : null)
  test.unmount()
}

// Both existing surface routes must pass file contents through, even if path-shaped.
const currentTextDelivery = load('src/launcher/clipboard/currentTextDelivery.ts', { './currentMaterial': material })
const actionExecutor = load('src/launcher/clipboard/actionExecutor.ts', {
  './clipboardSnapshot': snapshot, './currentTextDelivery': currentTextDelivery,
})
const legacySurfaceReads = []
const literalSurface = { initialTextMode: 'literal' }
const literalTarget = { source: 'builtin', pluginId: 'literal-surface', surfaceId: 'main' }
const surfaceModule = load('src/components/launcher/useGlobalLauncherSelectionController.ts', {
  '@tauri-apps/api/core': { invoke: async (_command, { path }) => { legacySurfaceReads.push(path); return 'legacy file content' } },
  react: { useCallback: (callback) => callback, useState: (initial) => [initial, noop] },
  './GlobalLauncherSelection': { resolvePluginSurfaceTarget: () => literalTarget, getPluginSurfaceDefinition: () => ({ definition: { ui: { surfaces: [literalSurface] } }, surface: literalSurface }) },
  '../../launcher/clipboard/clipboardSnapshot': snapshot,
  '../../workspace/launcherBlurGuard': {}, '../../workspace/windowManager/pluginSurfaceWindows': { getPluginSurfaceShortcutPresentation: () => 'launcher' },
  '../../workspace/webNativeBridge': {}, '../../workspace/toast': {}, '../../i18n': {},
  '../../store': { useAppStore: { getState: () => ({ globalLauncherOpen: true }) } },
  '../../workspace/telemetry': { trackBehavior: noop, TelemetryEvents: {}, measureLatency: (_name, action) => action() },
})
for (const text of ['', ' \r\n ', '/synthetic/second.json']) {
  const loaded = fileText.createFileTextMaterial('/synthetic/first.txt', text)
  assert.equal(fileText.getAttachedTextFilePath(loaded), null)
  const opened = []
  const result = await actionExecutor.executeRecommendedAction({ block: loaded, action: { id: 'open', pluginId: 'synthetic' }, target: 'open-plugin-surface' }, {
    readLocalFileText: forbiddenRead,
    openPluginSurface: async (_id, options) => opened.push(options.initialText),
  })
  assert.equal(result.ok, true)
  assert.deepEqual(opened, [text])
  assert.equal(await surfaceModule.resolveSurfaceInitialText(text, true), text)
}
// Literal surfaces opt out at both entry paths, including path-shaped and empty material.
for (const text of ['', ' \r\n ', '/synthetic/second.json']) {
  assert.equal(await surfaceModule.resolveSurfaceInitialText(text, false, 'literal'), text)
  const opened = []
  const result = await actionExecutor.executeRecommendedAction({
    block: { source: 'clipboard', payloadText: text }, action: { id: 'open', pluginId: 'literal-surface' }, target: 'open-plugin-surface',
  }, {
    getPluginSurfaceInitialTextMode: () => 'literal',
    readLocalFileText: forbiddenRead,
    openPluginSurface: async (_id, options) => opened.push(options.initialText),
  })
  assert.equal(result.ok, true)
  assert.deepEqual(opened, [text])
}
const selectedTargets = []
const selection = surfaceModule.useGlobalLauncherSelectionController({
  controllerRef: { current: null }, clearPluginSurfaceTool: noop, locale: 'en',
  objectBlockText: '/synthetic/selected.json', objectBlockTextIsFileContent: false,
  openPluginSurface: async (target) => selectedTargets.push(target), focusSearchInputAfterBack: noop,
})
selection.selectItem({ kind: 'domain', domainItem: { systemKey: 'plugin-surface:builtin:literal-surface:main' } })
await new Promise((resolve) => setImmediate(resolve))
assert.equal(selectedTargets.length, 1)
assert.equal(selectedTargets[0].initialText, '/synthetic/selected.json', 'real selection callback uses the nested surface declaration')
assert.deepEqual(legacySurfaceReads, [])
assert.equal(await surfaceModule.resolveSurfaceInitialText('/synthetic/legacy.json'), 'legacy file content')
assert.deepEqual(legacySurfaceReads, ['/synthetic/legacy.json'], 'undeclared surfaces keep their existing path resolution')
assert.equal(hiddenReads, 0, 'no hidden clipboard/editor/file source was read')
pending.clearPendingObjectBlock()
console.log('File picker and text material passed: explicit scope, exact text, restore/edit provenance, duplicate/stale/cancel/session races, stable failures and both surface routes')
