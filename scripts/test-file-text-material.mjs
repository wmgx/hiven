#!/usr/bin/env node
/** Material/async boundary behavior; synthetic payloads, no filesystem or clipboard reads. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { objectBlockText, objectBlockTextModule } from './helpers/object-block-text.mjs'

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
const blocks = load('src/launcher/clipboard/objectBlock.ts', { '../../kits/content/index': content, './clipboardSnapshot': snapshot, './attachPolicy': attach, './objectBlockText': objectBlockTextModule })
const material = load('src/launcher/clipboard/currentMaterial.ts')
const pending = load('src/launcher/clipboard/pendingObjectBlock.ts')
const dialogOptions = []
const fileText = load('src/launcher/clipboard/fileTextMaterial.ts', {
  './clipboardSnapshot': snapshot, './objectBlock': blocks,
  '@tauri-apps/plugin-dialog': { open: async (options) => { dialogOptions.push(options); return null } },
})
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
    '../../kits/content/index': content,
    './objectBlock': blocks, './pendingObjectBlock': pending, './clipboardSnapshot': snapshot,
    './currentMaterial': material,
    './fileTextMaterial': { ...fileText, readAttachedTextFile: (path) => {
      explicitReads.push(path)
      return new Promise((resolve, reject) => reads.push({ path, resolve, reject }))
    } },
    '../../workspace/launcher/perf': { launcherPerfNow: () => 0, logLauncherPerfDuration: noop },
    '../../workspace/telemetry': { TelemetryEvents: {}, trackBehavior: noop },
    '../../workspace/pasteRecovery': { checkPendingPasteRecovery: noop },
  }).useClipboardObjectBlock
  let open = true
  const render = () => runtime.render(() => hook({ open, readClipboard: options.readClipboard ?? forbiddenRead }))
  return { initial, reads, choices, get focusLeases() { return focusLeases }, get completed() { return completed }, render, close: () => { open = false; return render() }, reopen: () => { open = true; return render() }, unmount: runtime.unmount }
}

// A normal native reopen may reset an already-open, temporarily hidden host.
// A waiting handoff keeps its original persistence and age through that reset.
const pendingStorageKey = 'hiven-pending-object-block'
{
  const test = session(textBlock('old input', 'query'))
  let state = test.render()
  const next = textBlock('fresh waiting input', 'tool-result')
  pending.clearPendingObjectBlock()
  pending.setPendingObjectBlock(next, { silent: true })
  assert.equal(storage.getItem(pendingStorageKey), null)
  state.clearMaterial({ preservePending: true })
  state = test.render()
  assert.equal(state.block, next, 'new native session accepts memory-only waiting material')
  assert.equal(storage.getItem(pendingStorageKey), null, 'reset cannot upgrade a memory-only handoff to persistence')
  assert.equal(pending.peekPendingObjectBlock(), next)
  test.unmount()
}
{
  const test = session(textBlock('old input', 'query'))
  let state = test.render()
  const next = textBlock('persisted waiting input', 'tool-result')
  pending.clearPendingObjectBlock()
  const envelope = JSON.stringify({ block: next, createdAt: Date.now() - 20_000 })
  storage.setItem(pendingStorageKey, envelope)
  state.clearMaterial({ preservePending: true })
  state = test.render()
  assert.equal(state.block.id, next.id)
  assert.equal(storage.getItem(pendingStorageKey), envelope, 'reset preserves the exact persisted envelope and original TTL')
  test.unmount()
}
{
  const initial = textBlock('already accepted input', 'tool-result')
  const test = session(initial)
  let state = test.render()
  assert.equal(state.block, initial)
  const envelope = storage.getItem(pendingStorageKey)
  assert.ok(envelope)
  state.clearMaterial({ preservePending: true })
  state = test.render()
  assert.equal(state.block, initial, 'new session can accept the current silent backup despite the previous handoff receipt')
  assert.equal(storage.getItem(pendingStorageKey), envelope, 'reusing an accepted backup cannot refresh its TTL')
  test.unmount()
}
{
  const test = session(textBlock('old input', 'query'))
  let state = test.render()
  pending.clearPendingObjectBlock()
  storage.setItem(pendingStorageKey, JSON.stringify({ block: textBlock('expired waiting input', 'tool-result'), createdAt: Date.now() - 121_000 }))
  state.clearMaterial({ preservePending: true })
  state = test.render()
  assert.equal(state.block, null, 'preserving pending data does not revive an expired handoff')
  assert.equal(pending.peekPendingObjectBlock(), null)
  test.unmount()
}
{
  const initial = textBlock('consumed input', 'tool-result')
  const test = session(initial)
  let state = test.render()
  state.clearMaterial()
  assert.equal(test.render().block, null)
  assert.equal(pending.peekPendingObjectBlock(), null)
  assert.equal(storage.getItem(pendingStorageKey), null)
  pending.setPendingObjectBlock(initial)
  state = test.render()
  assert.equal(state.block, null, 'ordinary completion still rejects a duplicate handoff')
  assert.equal(pending.peekPendingObjectBlock(), null)
  test.unmount()
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
  assert.equal(pending.peekPendingObjectBlock().payloadText, exact)
  staleButton()
  assert.equal(test.reads.length, 1, 'stale file button cannot read replacement material')
  const loadedGeneration = getGeneration()
  pending.setPendingObjectBlock(blocks.createToolResultObjectBlock('processed text'))
  assert.notEqual(getGeneration(), loadedGeneration, 'explicit material changes invalidate synchronously before render')
  state = test.render()
  assert.equal(state.block.meta.textOrigin, 'file-content', 'processing keeps literal content provenance')
  assert.equal(state.block.meta.fileName, undefined, 'tool output does not borrow the old file identity')
  assert.equal(state.canReadFileText, false, 'unnamed literal output still cannot trigger another file read')
  const beforeClose = getGeneration()
  test.close()
  assert.equal(getGeneration(), undefined, 'closed material session cannot validate a preview')
  state = test.reopen()
  assert.notEqual(getGeneration(), beforeClose, 'reopening cannot revive the prior material identity')
  assert.equal(state.block.payloadText, 'processed text')
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

console.log('File text material: existing read boundaries, cancellation, handoff and error cases passed')
