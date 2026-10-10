#!/usr/bin/env node
// Execute the production renderer binding and lifecycle callbacks; native I/O is synthetic.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { createStore } from 'zustand/vanilla'

const compile = (source) => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const rendererPath = 'src/components/pluginSurface/PluginSurfaceRenderer.tsx'
const rendererSource = readFileSync(rendererPath, 'utf8')
const ast = ts.createSourceFile(rendererPath, rendererSource, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
const renderer = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'PluginSurfaceRenderer')
const declarations = new Map(renderer.body.statements.filter(ts.isVariableStatement).flatMap((statement) =>
  statement.declarationList.declarations.map((declaration) => [declaration.name.getText(ast), declaration.getText(ast)])))
const ownerCode = compile(`const ${declarations.get('deliveryFeedbackOwner')}; deliveryFeedbackOwner`)
const interruptCode = compile(`const ${declarations.get('interruptSettings')}; interruptSettings`)
const lifecycle = renderer.body.statements.find((node) => ts.isExpressionStatement(node)
  && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === 'useEffect'
  && node.getText(ast).includes('hiven://surface-registry-sync'))
assert.ok(lifecycle, 'renderer exposes its real independent-window lifecycle callback')
const registryEffect = renderer.body.statements.find((node) => ts.isExpressionStatement(node)
  && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === 'useLayoutEffect'
  && node.getText(ast).includes('pluginRegistry.subscribe'))
const lifecycleCode = compile(lifecycle.getText(ast))
const registryCode = compile(registryEffect.getText(ast))
let returnCallback
function findReturnCallback(node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'returnToLauncherWithObject') returnCallback = node.initializer
  ts.forEachChild(node, findReturnCallback)
}
findReturnCallback(renderer)
assert.ok(returnCallback)
const returnCode = compile(`const ${declarations.get('isCurrentSurface')}; const send = ${returnCallback.getText(ast)}; send`)

async function harness(presentation = 'plugin-surface-window') {
  const target = { pluginId: 'synthetic', source: 'installed' }
  const ready = { status: 'ready', target }, lifetime = { active: true }
  const store = createStore(() => ({ globalLauncherOpen: true, globalLauncherSessionId: 1,
    pluginSurfaceToolTarget: target, launcherHostSurfaceTarget: null }))
  const settings = createStore(() => ({ settingsDialogTarget: null }))
  const recoveryExports = {}
  vm.runInNewContext(compile(readFileSync('src/workspace/pasteRecovery.ts', 'utf8')), {
    exports: recoveryExports, AbortController,
    require(name) {
      if (name === '../store') return { useAppStore: store }
      if (name === './pluginSettingsStore') return { usePluginSettingsStore: settings }
      if (name === './telemetry') return { trackBehavior() {} }
      throw new Error(`Unexpected recovery import: ${name}`)
    },
  })
  let memo, lifecycleCleanup, registryCleanup, mutation, focus
  const windowListeners = new Map(), documentListeners = new Map()
  const registryListeners = new Set(), permissionListeners = new Set()
  const subscribe = (listeners) => (listener) => { listeners.add(listener); return () => listeners.delete(listener) }
  const scope = recoveryExports.createPasteRecoveryScope()
  const context = {
    target, surfaceState: ready, presentation, pasteOwnerVersion: 0,
    appSettingsSession: null, launcherSettingsTarget: null, launcherSessionId: 1,
    activeTargetRef: { current: target }, activeStateRef: { current: ready }, mountedRef: { current: false },
    hiddenRef: { current: false }, sessionRef: { current: null }, preparationScopeRef: { current: null },
    exportSessionRef: { current: 0 }, handoffRef: { current: null }, deliveredHandoffRef: { current: null },
    pasteScope: scope, ...recoveryExports,
    pluginRegistry: { getPluginLifetime: () => lifetime, subscribe: subscribe(registryListeners) },
    usePluginPermissionStore: { subscribe: subscribe(permissionListeners) },
    closeOwnedSettings() {}, finishAppSettings() {},
    refreshPasteOwner(update) { context.pasteOwnerVersion = update(context.pasteOwnerVersion) },
    pluginSurfaceInstanceId: () => 'synthetic-instance',
    useCallback: (callback) => callback,
    useMemo(factory, deps) {
      if (!memo || deps.some((value, index) => !Object.is(value, memo.deps[index]))) memo = { deps, value: factory() }
      return memo.value
    },
    useEffect(setup) { lifecycleCleanup = setup() },
    useLayoutEffect(setup) { registryCleanup = setup() },
    window: { __TAURI_INTERNALS__: {}, addEventListener: (name, fn) => windowListeners.set(name, fn), removeEventListener: (name) => windowListeners.delete(name) },
    document: { visibilityState: 'visible', addEventListener: (name, fn) => documentListeners.set(name, fn), removeEventListener: (name) => documentListeners.delete(name) },
    getCurrentWindow: () => ({ onFocusChanged: async (fn) => { focus = fn; return () => { focus = undefined } } }),
    console,
    require(name) {
      if (name === '@tauri-apps/api/event') return { listen: async (_name, fn) => { mutation = fn; return () => { mutation = undefined } } }
      throw new Error(`Unexpected renderer import: ${name}`)
    },
  }
  context.interruptSettings = vm.runInNewContext(interruptCode, { ...context })
  vm.runInNewContext(registryCode, { ...context })
  vm.runInNewContext(lifecycleCode, { ...context })
  await flush()
  return {
    context, store, settings, lifetime, scope, recovery: recoveryExports,
    render() { context.launcherSessionId = store.getState().globalLauncherSessionId; return vm.runInNewContext(ownerCode, { ...context }) },
    mount() { context.mountedRef.current = true },
    mutate(state) { assert.ok(mutation); mutation({ payload: { type: 'upsert', surface: { id: 'synthetic-instance', state } } }) },
    pageHide() { windowListeners.get('pagehide')() },
    visibility(hidden) { context.document.visibilityState = hidden ? 'hidden' : 'visible'; documentListeners.get('visibilitychange')() },
    removePlugin() { lifetime.active = false; for (const listener of registryListeners) listener() },
    revokePermissions() { for (const listener of permissionListeners) listener() },
    unmount() { context.mountedRef.current = false; context.interruptSettings(); lifecycleCleanup(); registryCleanup() },
  }
}

let passed = 0
async function check(name, test) {
  try { await test(); passed++ } catch (error) { error.message = `${name}: ${error.message}`; throw error }
}

await check('child subscribes before parent mount; ordinary rerenders keep the owner', async () => {
  const h = await harness(), owner = h.render()
  let invalidated = 0
  const stop = owner.subscribeInvalidation(() => invalidated++)
  assert.equal(owner.isCurrent(), false)
  h.mount()
  assert.equal(owner.isCurrent(), true, 'parent mount makes the same subscribed owner current')
  assert.equal(h.render(), owner, 'ordinary theme/status renders keep identity')
  assert.equal(invalidated, 0)
  stop(); h.unmount()
})
await check('temporary paste hide preserves feedback; true hide/show revokes it', async () => {
  const h = await harness(); h.mount()
  const owner = h.render(); let cleared = 0
  owner.subscribeInvalidation(() => cleared++)
  const attempt = h.recovery.createPasteRecoveryAttempt(owner, true)
  assert.equal(attempt.startHandoff(), true)
  h.mutate('hidden'); h.visibility(true)
  assert.equal(owner.isCurrent(), true)
  assert.equal(cleared, 0, 'expected native handoff preserves the original feedback owner')
  attempt.finish(false); h.visibility(false)
  assert.equal(h.render(), owner, 'temporary paste visibility restoration does not renew or revoke the owner')
  h.mutate('hidden')
  assert.equal(owner.isCurrent(), false)
  assert.ok(cleared > 0, 'already-settled feedback is cleared synchronously without another paste')
  h.mutate('visible')
  const next = h.render()
  assert.notEqual(next, owner)
  assert.equal(next.isCurrent(), true)
  assert.equal(owner.isCurrent(), false, 'old pending copy and paste callbacks cannot revive')
  h.unmount()
})
await check('ordinary DOM hide/show renews an owner without native registry events', async () => {
  const h = await harness('editor-panel'); h.mount()
  const first = h.render(); let invalidated = 0
  first.subscribeInvalidation(() => invalidated++)
  h.visibility(true)
  assert.equal(first.isCurrent(), false)
  assert.ok(invalidated > 0)
  h.visibility(false)
  const next = h.render()
  assert.notEqual(next, first)
  assert.equal(next.isCurrent(), true, 'returning to the same browser tab must allow fresh explicit actions')
  assert.equal(first.isCurrent(), false)
  h.unmount()
})
await check('true-to-true launcher reopen invalidates before React renders', async () => {
  const h = await harness('global-launcher'); h.mount()
  const owner = h.render(); let invalidated = 0
  owner.subscribeInvalidation(() => invalidated++)
  h.store.setState({ globalLauncherSessionId: 2 })
  assert.equal(owner.isCurrent(), false)
  assert.ok(invalidated > 0)
  const next = h.render()
  assert.notEqual(next, owner)
  assert.equal(next.isCurrent(), true)
  h.unmount()
})
for (const trigger of ['removePlugin', 'revokePermissions', 'pageHide', 'unmount']) {
  await check(`${trigger} synchronously revokes a retained feedback owner`, async () => {
    const h = await harness(); h.mount()
    const owner = h.render(); let invalidated = 0
    owner.subscribeInvalidation(() => invalidated++)
    h[trigger]()
    assert.equal(owner.isCurrent(), false)
    assert.ok(invalidated > 0)
    if (trigger !== 'unmount') h.unmount()
  })
}
await check('old unsubscribe cannot remove the new owner listener', async () => {
  const h = await harness(); h.mount()
  const old = h.render(), stop = old.subscribeInvalidation(() => {})
  h.mutate('hidden'); h.mutate('visible')
  const next = h.render(); let invalidated = 0
  next.subscribeInvalidation(() => invalidated++)
  stop(); h.mutate('hidden')
  assert.ok(invalidated > 0)
  h.unmount()
})
await check('own handoff refreshes feedback ownership without cancelling itself; rejection permits retry', async () => {
  const h = await harness(); h.mount()
  const first = h.render()
  let resolveHandoff, requests = 0
  const handoffResult = new Promise((resolve) => { resolveHandoff = resolve })
  const returnToLauncher = vm.runInNewContext(returnCode, {
    ...h.context, lifetime: h.lifetime, AbortController,
    createPluginSurfaceObjectBlock: (input) => ({ ...input }),
    isNativeDesktopRuntime: () => true,
    getCurrentWindow: () => ({ label: 'synthetic-independent' }), LAUNCHER_WINDOW_LABEL: 'launcher',
    requestLauncherObjectHandoff: (_block, options) => { requests++; assert.equal(options.signal.aborted, false); return handoffResult },
    showToast() {}, pickLocale: (_locale, _zh, en) => en, locale: 'en',
  })
  const pending = returnToLauncher({ kind: 'text', text: 'synthetic handoff' })
  assert.equal(first.isCurrent(), false, 'handoff invalidates old feedback synchronously')
  const next = h.render()
  assert.notEqual(next, first)
  assert.equal(next.isCurrent(), true, 'same mounted surface has a usable replacement owner')
  assert.equal(h.context.handoffRef.current.controller.signal.aborted, false, 'feedback refresh does not abort the in-flight handoff')
  resolveHandoff(false)
  assert.equal(await pending, false)
  assert.equal(requests, 1)
  assert.equal(h.context.handoffRef.current, null)
  assert.equal(next.isCurrent(), true, 'failed handoff leaves the new feedback owner usable')
  h.unmount()
})
console.log(`Tool delivery feedback owner: ${passed} production renderer lifecycle scenarios passed`)
