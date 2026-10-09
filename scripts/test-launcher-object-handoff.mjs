#!/usr/bin/env node
// Real production bridge modules in separate webview contexts, with controlled native events.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const REQUEST = 'hiven://launcher-object-handoff'
const REPLY = 'hiven://launcher-object-handoff-reply'
const KEY = 'hiven:launcher-object-handoff'
let now = 10_000, nextId = 0, storageFails = false
const values = new Map(), timers = new Map(), listeners = new Map(), queue = []
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => { if (storageFails) throw Error('storage unavailable'); values.set(key, String(value)) },
  removeItem: (key) => values.delete(key),
}
class Clock extends Date { static now() { return now } }
const schedule = (callback, delay, repeat) => { const id = ++nextId; timers.set(id, { callback, delay, repeat, due: now + delay }); return id }
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const drain = async (filter = () => true) => {
  await flush()
  let index
  while ((index = queue.findIndex(filter)) >= 0) {
    const event = queue.splice(index, 1)[0]
    for (const handler of [...(listeners.get(`${event.target}:${event.name}`) ?? [])]) await handler({ payload: event.payload })
    await flush()
  }
}
const advance = async (milliseconds, filter) => {
  const end = now + milliseconds
  while (now < end) {
    now = Math.min(end, now + 50)
    for (const [id, timer] of [...timers]) {
      if (timer.due > now || !timers.has(id)) continue
      if (timer.repeat) timer.due = now + timer.delay
      else timers.delete(id)
      timer.callback()
    }
    await drain(filter)
  }
}
function load(path, modules = {}, globals = {}) {
  const exports = {}
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(code, {
    exports, module: { exports }, console, Date: Clock, JSON, localStorage: storage,
    crypto: { randomUUID: () => `request-${++nextId}` },
    setInterval: (callback, delay) => schedule(callback, delay, true),
    clearInterval: (id) => timers.delete(id),
    setTimeout: (callback, delay) => schedule(callback, delay, false),
    clearTimeout: (id) => timers.delete(id),
    require(name) { assert.ok(Object.hasOwn(modules, name), `${path}: unexpected ${name}`); return modules[name] },
    ...globals,
  }, { filename: path })
  return exports
}
function windowModule(label, settings = {}) {
  const events = {
    listen: async (name, callback) => {
      const key = `${label}:${name}`
      if (!listeners.has(key)) listeners.set(key, new Set())
      listeners.get(key).add(callback)
      return () => listeners.get(key).delete(callback)
    },
    emitTo: async (target, name, payload) => { queue.push({ target, name, payload }) },
  }
  return load('src/launcher/clipboard/launcherObjectHandoff.ts', {
    '@tauri-apps/api/event': events,
    '@tauri-apps/api/window': { getCurrentWindow: () => ({ label }), Window: { getByLabel: async () => ({ isVisible: async () => settings.visible !== false }) } },
    '../../workspace/windowManager/launcherWindow': { showLauncherWindow: async () => settings.show?.() },
    '../../workspace/windowManager/windowLabels': { LAUNCHER_WINDOW_LABEL: 'launcher' },
  })
}
const pendingPath = 'src/launcher/clipboard/pendingObjectBlock.ts'
const block = (text) => ({ id: `block-${++nextId}`, kind: 'text', source: 'tool-result', createdAt: now, payloadText: text })
let passed = 0

// The original bug: old per-webview memory must not erase the newer shared material.
{
  const launcher = load(pendingPath), surface = load(pendingPath)
  launcher.setPendingObjectBlock(block('old backup'), { persist: true, silent: true })
  surface.setPendingObjectBlock(block('三条完整文本\r\n第二条\n第三条'), { persist: true })
  assert.equal(launcher.peekPendingObjectBlock().payloadText, '三条完整文本\r\n第二条\n第三条')
  assert.equal(launcher.consumePendingObjectBlock().payloadText, '三条完整文本\r\n第二条\n第三条')
  assert.equal(launcher.consumePendingObjectBlock(), null)
  passed++
}

async function session(settings = {}) {
  values.clear(); queue.length = 0; listeners.clear(); timers.clear(); storageFails = false
  const pending = load(pendingPath)
  const materials = load('src/launcher/clipboard/currentMaterial.ts')
  let current = materials.replaceCurrentMaterial(block('original')), generation = 1, applies = 0, open = true, alive = true
  pending.subscribePendingObjectBlock((next) => {
    const accepted = materials.acceptMaterialHandoff(current, next, true)
    if (accepted !== current) { current = accepted; generation++; applies++ }
  })
  const target = windowModule('launcher', settings)
  const sender = windowModule('plugin-surface:history', settings)
  const stop = await target.subscribeLauncherObjectHandoff({
    prepare: () => { if (!open) { open = true; generation++ } },
    getGeneration: () => open ? generation : undefined,
    accept: (next) => { const before = generation; pending.setPendingObjectBlock(next, { persist: true }); return generation !== before },
  })
  const controller = new AbortController()
  const exact = block('  完整第一条\r\n\r\n第二条\n第三条  ')
  const send = (next = exact, signal = controller.signal) => sender.requestLauncherObjectHandoff(next, { signal, isCurrent: () => alive })
  return { send, exact, stop, controller, get material() { return current }, get generation() { return generation }, get applies() { return applies },
    changeMaterial() { current = materials.replaceCurrentMaterial(block('new user task')); generation++ },
    close() { open = false; generation++ }, reopen() { open = true; generation++ }, invalidateOwner() { alive = false; controller.abort() },
  }
}
{
  const test = await session()
  const result = test.send()
  await advance(150)
  assert.equal(await result, true)
  assert.equal(test.material.block.payloadText, test.exact.payloadText)
  assert.equal(test.applies, 1, 'already-open target accepts without an open transition')
  assert.equal(test.material.previousBlock.payloadText, 'original')
  assert.equal(values.has(KEY), false, 'receipt is cleared after acknowledgement')
  assert.equal(timers.size, 0)
  test.stop(); passed++
}
// Source cancel, owner replacement, target generation changes and close/reopen between ready/commit.
for (const interruption of ['abort', 'owner', 'material', 'close-reopen', 'unmount']) {
  const test = await session()
  const result = test.send()
  await drain()
  assert.equal(test.applies, 0, 'ready is not delivery')
  if (interruption === 'abort') test.controller.abort()
  if (interruption === 'owner') test.invalidateOwner()
  if (interruption === 'material') test.changeMaterial()
  if (interruption === 'close-reopen') { test.close(); test.reopen() }
  if (interruption === 'unmount') test.stop()
  await advance(5_100)
  assert.equal(await result, false, interruption)
  assert.equal(test.applies, 0, `${interruption}: queued commit cannot apply`)
  test.stop(); passed++
}
// A delayed commit after timeout never revives a request; a newer request survives old cancellation.
{
  const test = await session()
  const old = test.send()
  await drain()
  await advance(5_100, (event) => event.name !== REQUEST)
  assert.equal(await old, false)
  const nextController = new AbortController()
  const newer = test.send(block('new complete draft'), nextController.signal)
  await advance(150)
  assert.equal(await newer, true)
  assert.equal(test.applies, 1)
  assert.equal(test.material.block.payloadText, 'new complete draft')
  test.stop(); passed++
}
{
  const test = await session()
  const old = test.send()
  await drain()
  const secondController = new AbortController()
  const newer = test.send(block('newer window'), secondController.signal)
  await flush()
  test.controller.abort()
  assert.ok(values.has(KEY), 'old abort cannot clear newer request')
  await advance(150)
  assert.equal(await old, false)
  assert.equal(await newer, true)
  assert.equal(test.applies, 1)
  test.stop(); passed++
}
// Lost ack and repeated commit use the exact applied receipt, not a second material update.
{
  const test = await session()
  const result = test.send()
  await drain()
  await advance(50, (event) => event.name !== REPLY)
  assert.equal(test.applies, 1)
  const receipt = JSON.parse(values.get(KEY))
  assert.equal(receipt.applied, true)
  assert.equal(receipt.block, undefined, 'receipt retains no material text')
  queue.push({ target: 'launcher', name: REQUEST, payload: { id: receipt.id, phase: 'commit' } })
  await drain((event) => event.name !== REPLY)
  assert.equal(test.applies, 1)
  await advance(50, (event) => event.name !== REPLY)
  assert.equal(await result, true, 'sender observes persisted receipt when native ack is lost')
  await drain()
  assert.equal(test.applies, 1)
  test.stop(); passed++
}
for (const failure of ['storage']) {
  const test = await session({ visible: failure !== 'hidden', show: () => { if (failure === 'show') throw Error('show failed') } })
  storageFails = failure === 'storage'
  const result = test.send()
  await advance(5_100)
  assert.equal(await result, false)
  assert.equal(test.applies, 0)
  assert.equal(test.material.block.payloadText, 'original')
  assert.equal(timers.size, 0)
  test.stop(); passed++
}
// A receipt accepted just before deadline remains success when the final ack is lost.
{
  const test = await session()
  const result = test.send()
  await drain()
  await advance(4_900, (event) => event.name !== REQUEST)
  await advance(50, (event) => event.name !== REPLY)
  assert.equal(test.applies, 1)
  await advance(50, (event) => event.name !== REPLY)
  assert.equal(await result, true)
  test.stop(); passed++
}
// Presentation occurs after delivery; failed/uncertain show and owner changes are bounded.
for (const failure of ['none', 'throw', 'hidden', 'owner']) {
  values.clear(); queue.length = 0; listeners.clear(); timers.clear()
  const native = windowModule('plugin-surface:history', { visible: failure !== 'hidden', show: () => { if (failure === 'throw') throw Error('show failed') } })
  const shown = native.showLauncherAfterObjectHandoff(() => failure !== 'owner')
  await advance(600)
  assert.equal(await shown, failure === 'none')
  assert.equal(timers.size, 0)
  passed++
}
console.log(`Launcher object handoff: ${passed} production-module scenarios passed`)

// Execute the production host/merge callbacks directly: lifecycle logic, not rendered UI assertions.
function callbackFrom(path, name) {
  const source = readFileSync(path, 'utf8')
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
  let callback
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(file) === name) callback = node.initializer
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0]
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(callback, `${name} production callback exists`)
  return ts.transpileModule(`exports.run = ${callback.getText(file)}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
}
const hostCode = callbackFrom('src/components/pluginSurface/PluginSurfaceRenderer.tsx', 'returnToLauncherWithObject')
function hostSession({ local = false, accept = async () => true, publish = true } = {}) {
  const target = {}, surfaceState = {}, handoffRef = { current: null }, deliveredHandoffRef = { current: null }, hiddenRef = { current: false }
  const mountedRef = { current: true }, activeTargetRef = { current: target }, activeStateRef = { current: surfaceState }
  const sent = [], messages = []
  let back = 0, cleared = 0, visible = true, shows = 0
  const interruptSettings = () => { handoffRef.current?.controller.abort(); handoffRef.current = null; deliveredHandoffRef.current = null }
  const globals = {
    exports: {}, console, AbortController, target, surfaceState, handoffRef, deliveredHandoffRef, hiddenRef, mountedRef, activeTargetRef, activeStateRef,
    isCurrentSurface: () => mountedRef.current && activeTargetRef.current === target && activeStateRef.current === surfaceState && !hiddenRef.current,
    interruptSettings, createPluginSurfaceObjectBlock: (input) => block(input.text),
    isNativeDesktopRuntime: () => true,
    getCurrentWindow: () => ({ label: local ? 'launcher' : 'plugin-surface:history', isVisible: async () => true }),
    LAUNCHER_WINDOW_LABEL: 'launcher',
    requestLauncherObjectHandoff: async (next) => { sent.push(next); return accept() },
    showLauncherAfterObjectHandoff: async () => {
      shows++
      // Actual native closeOnBlur emits hidden and interrupts settings after own show.
      if (visible) { hiddenRef.current = true; interruptSettings() }
      return visible
    },
    setPendingObjectBlock: (next) => { sent.push(next); return publish },
    clearPendingObjectBlock: () => cleared++,
    requestAnimationFrame: (callback) => { callback(); return 1 },
    useAppStore: { getState: () => ({ openGlobalLauncherOverlay() {}, clearPluginSurfaceTool() {} }), setState() {} },
    onBack: () => back++,
    showToast: (message) => messages.push(message), pickLocale: (_locale, _zh, en) => en,
    locale: 'en', presentation: 'plugin-surface-window',
  }
  vm.runInNewContext(hostCode, globals)
  return { run: globals.exports.run, sent, messages, interruptSettings, hiddenRef,
    get back() { return back }, get cleared() { return cleared }, get shows() { return shows },
    replaceOwner() { activeTargetRef.current = {}; interruptSettings() }, setVisible(value) { visible = value },
  }
}
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done }); return { promise, resolve } }
{
  const pending = deferred(), test = hostSession({ accept: () => pending.promise })
  const first = test.run({ kind: 'text', text: '完整草稿', source: 'tool-result' })
  assert.equal(test.run({ kind: 'text', text: '完整草稿', source: 'tool-result' }), first, 'repeated source clicks share the same delivery')
  assert.equal(test.back, 0)
  pending.resolve(true)
  assert.equal(await first, true)
  assert.equal(test.back, 1, 'own native blur-hide after acceptance cannot turn delivery into failure')
  assert.equal(test.sent.length, 1)
  assert.equal(await test.run({ kind: 'text', text: 'stale source callback' }), false)
  passed++
}
{
  const pending = deferred(), test = hostSession({ accept: () => pending.promise })
  const result = test.run({ kind: 'text', text: 'old owner' })
  test.replaceOwner(); pending.resolve(true)
  assert.equal(await result, false)
  assert.equal(test.back, 0)
  assert.equal(test.shows, 0)
  passed++
}
{
  const test = hostSession()
  const input = { kind: 'text', text: '保留草稿', source: 'tool-result' }
  test.setVisible(false)
  assert.equal(await test.run(input), false)
  assert.equal(test.back, 0)
  assert.equal(test.messages.length, 1, 'failed native presentation has a visible error path')
  assert.equal(test.hiddenRef.current, false, 'failed presentation keeps the source usable')
  test.setVisible(true)
  assert.equal(await test.run(input), true)
  assert.equal(test.sent[0], test.sent[1], 'retry confirms the exact already delivered snapshot')
  assert.equal(test.back, 1)
  passed++
}
for (const publish of [false, true]) {
  const test = hostSession({ local: true, publish })
  assert.equal(await test.run({ kind: 'text', text: 'same-window draft' }), publish)
  assert.equal(test.back, publish ? 1 : 0)
  assert.equal(test.cleared, publish ? 0 : 1, 'unreceived local drafts are withdrawn')
  assert.equal(test.shows, 0, 'same native window needs no focus-changing show')
  passed++
}
const mergeCode = callbackFrom('src/plugins/clipboard-history/surfaces/ClipboardHistorySurface.tsx', 'continueMerge')
for (const outcome of ['accepted', 'failed', 'cancelled', 'new-draft']) {
  const result = deferred(), mergeSubmissionRef = { current: null }, mergePreview = { text: '完整预览' }
  let cancelled = 0, loading = false, retries = 0
  const context = {
    exports: {}, AbortController, mergeSubmissionRef, mergePreview, settings: { enabled: true }, combining: true,
    mergeSuspended: false, mergeSuspendedRef: { current: false }, mergeReader: { isCurrent: () => true },
    host: { returnToLauncherWithObject: () => result.promise, showMessage() {} },
    setMergeLoading: (value) => { loading = value }, setMergeRetry: () => retries++,
    cancelMerge: () => cancelled++, t: (key) => key,
  }
  vm.runInNewContext(mergeCode, context)
  const pending = context.exports.run()
  assert.equal(loading, true)
  assert.equal(cancelled, 0, 'draft remains while waiting for an actual receipt')
  if (outcome === 'cancelled' || outcome === 'new-draft') {
    mergeSubmissionRef.current.abort()
    mergeSubmissionRef.current = outcome === 'new-draft' ? new AbortController() : null
  }
  result.resolve(outcome !== 'failed')
  await pending
  assert.equal(cancelled, outcome === 'accepted' ? 1 : 0)
  assert.equal(retries, outcome === 'failed' ? 1 : 0)
  assert.equal(mergePreview.text, '完整预览')
  passed++
}
console.log(`Launcher object handoff: ${passed} total production-module and callback scenarios passed`)
