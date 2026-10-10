#!/usr/bin/env node
// Run production exit/owner callbacks without rendering or asserting UI layout.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function compile(source) {
  return ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText
}
function parse(path) {
  const source = readFileSync(path, 'utf8')
  return { source, file: ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX) }
}
const framePath = 'src/components/launcher/GlobalLauncherPluginSurfaceFrame.tsx'
const { source: frameSource, file: frameFile } = parse(framePath)
const frameFunction = frameFile.statements.find((node) => ts.isFunctionDeclaration(node))
const frameReturn = frameFunction.body.statements.find(ts.isReturnStatement)
const frameCode = compile(frameSource.slice(0, frameReturn.expression.getStart(frameFile))
  + '({ requestLeave, onUnsavedChangesChange, escapeHandler, cancelLeave, discardChanges, pendingLeave })'
  + frameSource.slice(frameReturn.expression.end))

function frameHarness() {
  const slots = [], queuedEffects = []
  let cursor = 0, target = {}, view
  const calls = { back: 0, close: 0 }
  const useState = (initial) => {
    const i = cursor++
    if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
    return [slots[i], (value) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }]
  }
  const react = {
    useState,
    useRef: (value) => useState(() => ({ current: value }))[0],
    useCallback: (callback) => callback,
    useLayoutEffect(setup, deps) {
      const i = cursor++, previous = slots[i]
      if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) {
        queuedEffects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: setup() } })
      }
    },
  }
  const modules = {
    react, 'react/jsx-runtime': {}, '../../i18n': {}, '../../plugin-ui': {},
    './launcherEscapeInterceptor': { useLauncherEscapeInterceptor() {} },
    '../pluginSurface/PluginSurfaceRenderer': {}, '../SurfaceBreadcrumbHeader': {},
  }
  const context = { exports: {}, Element: class {}, require(name) { assert.ok(Object.hasOwn(modules, name), name); return modules[name] } }
  vm.runInNewContext(frameCode, context, { filename: framePath })
  function render() {
    cursor = 0
    view = context.exports.GlobalLauncherPluginSurfaceFrame({ target, locale: 'en', shellHeight: 600,
      onBack: () => calls.back++, onClose: () => calls.close++ })
    queuedEffects.splice(0).forEach((run) => run())
    return view
  }
  render()
  return { calls, render, get view() { return view },
    replaceTarget() { target = {}; render(); render() },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()) },
  }
}
const owner = () => ({ active: true, isCurrent() { return this.active } })
let passed = 0
function check(name, body) {
  try { body(); passed++ } catch (error) { error.message = `${name}: ${error.message}`; throw error }
}

for (const action of ['back', 'close']) check(`${action}: dirty prompts once, cancel keeps edits, discard goes raw once`, () => {
  const h = frameHarness(), first = owner()
  h.view.onUnsavedChangesChange(true, first)
  h.view.requestLeave(action); h.render()
  const pending = h.view.pendingLeave, confirm = h.view.discardChanges
  h.view.requestLeave(action === 'back' ? 'close' : 'back'); h.render()
  assert.equal(h.view.pendingLeave, pending, 'repeated exit keeps the first requested action')
  assert.equal(h.calls.back + h.calls.close, 0)
  h.view.cancelLeave(); h.render()
  confirm()
  assert.equal(h.calls.back + h.calls.close, 0, 'old confirmation cannot act after cancel')
  h.view.requestLeave(action); h.render()
  assert.ok(h.view.pendingLeave, 'cancel keeps the dirty owner')
  h.view.discardChanges(); h.view.discardChanges(); h.render()
  assert.equal(h.calls[action], 1)
  assert.equal(h.view.pendingLeave, null)
})
check('clean and reverted owners navigate without a prompt', () => {
  const h = frameHarness(), first = owner()
  h.view.requestLeave('back')
  assert.equal(h.calls.back, 1)
  h.view.onUnsavedChangesChange(true, first)
  h.view.onUnsavedChangesChange(false, first)
  h.view.requestLeave('close'); h.render()
  assert.equal(h.calls.close, 1)
  assert.equal(h.view.pendingLeave, null)
})
check('repeated reports are idempotent, and old Cancel cannot dismiss a new prompt', () => {
  const h = frameHarness(), first = owner()
  h.view.onUnsavedChangesChange(false, first); h.view.onUnsavedChangesChange(false, first)
  h.view.onUnsavedChangesChange(true, first); h.view.requestLeave('back'); h.render()
  const firstPending = h.view.pendingLeave, oldCancel = h.view.cancelLeave
  h.view.onUnsavedChangesChange(true, first); h.render()
  assert.equal(h.view.pendingLeave, firstPending)
  oldCancel(); h.render()
  h.view.requestLeave('close'); h.render()
  const nextPending = h.view.pendingLeave
  oldCancel(); h.render()
  assert.equal(h.view.pendingLeave, nextPending)
  h.view.onUnsavedChangesChange(false, first); h.view.onUnsavedChangesChange(false, first); h.render()
  assert.equal(h.view.pendingLeave, null, 'a complete undo dismisses its obsolete prompt')
})
check('Escape opens confirmation, then only cancels without leaving', () => {
  const h = frameHarness(), first = owner()
  h.view.onUnsavedChangesChange(true, first)
  const event = { key: 'Escape', target: null, prevented: 0, stopped: 0,
    preventDefault() { this.prevented++ }, stopPropagation() { this.stopped++ } }
  assert.equal(h.view.escapeHandler(event), true); h.render()
  assert.ok(h.view.pendingLeave)
  assert.equal(h.view.escapeHandler(event), true); h.render()
  assert.equal(h.view.pendingLeave, null)
  assert.equal(event.prevented, 2); assert.equal(event.stopped, 2)
  assert.equal(h.calls.back + h.calls.close, 0)
})
check('new target ignores old reports, cleanup and confirmation', () => {
  const h = frameHarness(), first = owner()
  const oldReport = h.view.onUnsavedChangesChange
  oldReport(true, first); h.view.requestLeave('back'); h.render()
  const oldConfirm = h.view.discardChanges
  h.replaceTarget()
  const next = owner()
  h.view.onUnsavedChangesChange(true, next); h.view.requestLeave('close'); h.render()
  const currentPending = h.view.pendingLeave
  oldReport(false, first); oldReport(true, first); oldConfirm(); h.render()
  assert.equal(h.view.pendingLeave, currentPending)
  assert.equal(h.calls.back + h.calls.close, 0)
  h.view.discardChanges()
  assert.equal(h.calls.close, 1)
})
check('replacement renderer with the same target rejects stale owner callbacks', () => {
  const h = frameHarness(), first = owner(), next = owner()
  h.view.onUnsavedChangesChange(true, first); h.view.requestLeave('back'); h.render()
  const oldConfirm = h.view.discardChanges
  first.active = false
  h.view.onUnsavedChangesChange(true, next); h.render()
  assert.equal(h.view.pendingLeave, null)
  h.view.requestLeave('close'); h.render()
  const currentPending = h.view.pendingLeave
  h.view.onUnsavedChangesChange(false, first); oldConfirm(); h.render()
  assert.equal(h.view.pendingLeave, currentPending)
  h.view.discardChanges()
  assert.equal(h.calls.close, 1)
})
for (const invalidate of ['owner', 'unmount']) check(`${invalidate} revokes a retained confirmation`, () => {
  const h = frameHarness(), first = owner()
  h.view.onUnsavedChangesChange(true, first); h.view.requestLeave('back'); h.render()
  const confirm = h.view.discardChanges
  if (invalidate === 'owner') first.active = false
  else h.unmount()
  confirm()
  assert.equal(h.calls.back + h.calls.close, 0)
})

const rendererPath = 'src/components/pluginSurface/PluginSurfaceRenderer.tsx'
const { file: rendererFile } = parse(rendererPath)
const rendererFunction = rendererFile.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'PluginSurfaceRenderer')
const declarations = new Map(rendererFunction.body.statements.filter(ts.isVariableStatement)
  .flatMap((statement) => statement.declarationList.declarations.map((decl) => [decl.name.getText(rendererFile), decl.getText(rendererFile)])))
const callbacks = {}
function inspect(node) {
  if (ts.isJsxAttribute(node) && node.name.text === 'host') {
    for (const prop of node.initializer.expression.properties) {
      if (ts.isPropertyAssignment(prop)) callbacks[prop.name.getText(rendererFile)] = prop.initializer.getText(rendererFile)
    }
  }
  ts.forEachChild(node, inspect)
}
inspect(rendererFunction)
function rendererHarness({ guarded = true, presentation = 'global-launcher' } = {}) {
  const target = { pluginId: 'synthetic', source: 'builtin' }, state = { status: 'ready' }, lifetime = { active: true }
  state.target = target
  const calls = { back: 0, close: 0, interrupt: 0, reports: [], requests: [] }
  const context = { exports: {}, target, surfaceState: state, lifetime, presentation,
    mountedRef: { current: true }, activeTargetRef: { current: target }, activeStateRef: { current: state }, hiddenRef: { current: false },
    pluginRegistry: { getPluginLifetime: () => lifetime }, useMemo: (factory) => factory(), useCallback: (callback) => callback,
    onUnsavedChangesChange: (dirty, value) => calls.reports.push({ dirty, owner: value }),
    onRequestLeave: guarded ? (action) => calls.requests.push(action) : undefined,
    onBack: () => calls.back++, onClose: () => calls.close++, interruptSettings: () => calls.interrupt++,
  }
  const code = ['leaveOwner', 'setUnsavedChanges', 'isCurrentSurface', 'leaveSurface', 'requestLeave']
    .map((name) => `const ${declarations.get(name)};`).join('\n')
    + `\nexports.api = { owner: leaveOwner, setUnsavedChanges, back: ${callbacks.requestBack}, close: ${callbacks.close}, complete: ${callbacks.complete} };`
  vm.runInNewContext(compile(code), context, { filename: rendererPath })
  return { calls, context, api: context.exports.api }
}
check('renderer asks before interruption; successful completion stays raw', () => {
  const h = rendererHarness()
  h.api.setUnsavedChanges(true); h.api.back(); h.api.close()
  assert.deepEqual(h.calls.requests, ['back', 'close'])
  assert.equal(h.calls.interrupt + h.calls.back + h.calls.close, 0)
  h.api.complete()
  assert.equal(h.calls.close, 1); assert.equal(h.calls.interrupt, 1)
  const standalone = rendererHarness({ guarded: false, presentation: 'plugin-surface-window' })
  standalone.api.back(); standalone.api.close(); standalone.api.complete()
  assert.equal(standalone.calls.back, 1); assert.equal(standalone.calls.close, 1)
})
for (const invalidate of ['target', 'state', 'lifetime', 'unmount', 'hidden']) check(`${invalidate} revokes retained renderer setters and navigation`, () => {
  const h = rendererHarness()
  h.api.setUnsavedChanges(true)
  if (invalidate === 'target') h.context.activeTargetRef.current = {}
  if (invalidate === 'state') h.context.activeStateRef.current = {}
  if (invalidate === 'lifetime') h.context.lifetime.active = false
  if (invalidate === 'unmount') h.context.mountedRef.current = false
  if (invalidate === 'hidden') h.context.hiddenRef.current = true
  h.api.setUnsavedChanges(false); h.api.back(); h.api.close(); h.api.complete()
  assert.equal(h.api.owner.isCurrent(), false)
  assert.equal(h.calls.reports.length, 1)
  assert.equal(h.calls.requests.length + h.calls.back + h.calls.close + h.calls.interrupt, 0)
})
console.log(`Plugin surface unsaved changes: ${passed} production callback scenarios passed`)
