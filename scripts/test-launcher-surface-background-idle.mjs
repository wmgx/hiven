#!/usr/bin/env node
// Production frame/host hooks with dependency-aware layout effects and a fake native clock.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const microtasks = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const owner = () => ({ active: true, isCurrent() { return this.active } })
const sameDeps = (left, right) => left && right && left.length === right.length && left.every((value, i) => Object.is(value, right[i]))

function fixture({ initiallyFocused = true } = {}) {
  let now = 1_700_000_000_000, nextTimer = 0, focused = initiallyFocused, closes = 0
  let target = {}, visible = true, open = true, standalone = true, mounted = true, needsRender = true, renderCount = 0
  let guard, renderer, deferredProbe = null
  const timers = new Map(), focusListeners = new Set()
  class Clock extends Date { static now() { return now } }
  const window = {
    __TAURI_INTERNALS__: {},
    setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { at: now + delay, callback }); return id },
    clearTimeout: (id) => timers.delete(id),
  }
  function hookRuntime() {
    const slots = [], effects = []
    let cursor = 0
    const state = (initial) => {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], (next) => {
        const value = typeof next === 'function' ? next(slots[index]) : next
        if (Object.is(value, slots[index])) return
        slots[index] = value; needsRender = true
      }]
    }
    return {
      react: {
        useState: state,
        useRef: (initial) => state(() => ({ current: initial }))[0],
        useCallback(callback, deps) {
          const index = cursor++, previous = slots[index]
          if (!previous || !sameDeps(previous.deps, deps)) slots[index] = { deps, callback }
          return slots[index].callback
        },
        useLayoutEffect(setup, deps) {
          const index = cursor++, previous = slots[index]
          if (!previous || !sameDeps(previous.deps, deps)) effects.push({ index, previous, setup, deps })
        },
      },
      begin() { cursor = 0 },
      cleanChanged() { for (const effect of effects) effect.previous?.cleanup?.() },
      setupChanged() {
        for (const effect of effects.splice(0)) slots[effect.index] = { deps: effect.deps, cleanup: effect.setup() }
      },
      unmount() { for (const slot of slots) slot?.cleanup?.() },
    }
  }
  const hostHooks = hookRuntime(), frameHooks = hookRuntime()
  function load(path, modules) {
    const exports = {}
    const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText
    vm.runInNewContext(code, { exports, module: { exports }, console, Date: Clock, window, AbortController,
      require(name) { assert.ok(Object.hasOwn(modules, name), `Unexpected dependency ${name}`); return modules[name] },
    }, { filename: path })
    return exports
  }
  const nativeWindow = { getCurrentWindow: () => ({ isFocused: () => {
    if (deferredProbe) return deferredProbe.promise
    return Promise.resolve(focused)
  } }) }
  const focusGuard = load('src/workspace/launcherBlurGuard.ts', {
    '@tauri-apps/api/window': nativeWindow,
    '@tauri-apps/api/webviewWindow': { getAllWebviewWindows: async () => [] },
  })
  const recovery = load('src/workspace/pasteRecovery.ts', {
    '../store': { useAppStore: {} }, './pluginSettingsStore': { usePluginSettingsStore: {} },
    './telemetry': { trackBehavior() {} }, '@tauri-apps/api/core': { invoke: async () => 'attempt' },
  })
  const lifecycle = load('src/components/launcher/GlobalLauncherWindowLifecycle.ts', {
    react: hostHooks.react,
    '../../workspace/windowManager/launcherWindow': {
      onCurrentLauncherWindowFocusChanged: async (callback) => {
        focusListeners.add(callback); return () => focusListeners.delete(callback)
      },
    },
    '../../workspace/launcherBlurGuard': focusGuard, './GlobalLauncherLayout': {}, '../../workspace/launcher/perf': {},
    '@tauri-apps/api/window': nativeWindow, '../../workspace/pasteRecovery': recovery,
    '../../workspace/launcherWindowEvents': { LAUNCHER_NEW_SESSION_EVENT: 'hiven:launcher-new-session' },
  })
  const background = load('src/components/launcher/useLauncherSurfaceBackgroundIdle.ts', { react: hostHooks.react })
  const PluginSurfaceRenderer = () => null
  const frame = load('src/components/launcher/GlobalLauncherPluginSurfaceFrame.tsx', {
    react: frameHooks.react,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    '../../i18n': { t: (_, key) => key }, '../../plugin-ui': { ConfirmDialog: () => null },
    './launcherEscapeInterceptor': { useLauncherEscapeInterceptor() {} },
    '../pluginSurface/PluginSurfaceRenderer': { PluginSurfaceRenderer }, '../SurfaceBreadcrumbHeader': {},
  })
  function findRenderer(node) {
    if (!node || typeof node !== 'object') return null
    if (node.type === PluginSurfaceRenderer) return node.props
    for (const child of [node.props?.children].flat()) {
      const found = findRenderer(child)
      if (found) return found
    }
    return null
  }
  function render() {
    if (!mounted) return
    needsRender = false; renderCount++
    hostHooks.begin()
    guard = background.useLauncherSurfaceBackgroundIdle(open && visible ? target : null)
    lifecycle.useAutoCloseStandaloneLauncherOnBackgroundIdle({
      open, standaloneLauncher: standalone, closeLauncher: () => closes++, paused: guard.paused, isPaused: guard.isPaused,
      restartVersion: guard.restartVersion,
    })
    frameHooks.begin()
    renderer = findRenderer(frame.GlobalLauncherPluginSurfaceFrame({
      target, locale: 'en', shellHeight: 600, onBack() {}, onClose() {}, onUnsavedChangesReport: guard.onUnsavedChangesReport,
    }))
    // React clears changed layout effects before installing the next generation.
    frameHooks.cleanChanged(); hostHooks.cleanChanged()
    frameHooks.setupChanged(); hostHooks.setupChanged()
  }
  async function settle() {
    for (let i = 0; i < 20; i++) {
      if (needsRender && mounted) render()
      await microtasks()
      if (!needsRender || !mounted) return
    }
    assert.fail('Hook updates did not settle; likely a callback/cleanup loop')
  }
  return {
    settle, recovery, focusGuard,
    get closes() { return closes }, get timerCount() { return timers.size }, get listenerCount() { return focusListeners.size },
    get renders() { return renderCount }, get renderer() { return renderer }, get guard() { return guard }, get target() { return target },
    report(dirty, identity) { renderer.onUnsavedChangesChange(dirty, identity) },
    replaceTarget() { target = {}; needsRender = true },
    showSurface(value) { visible = value; needsRender = true },
    setOpen(value) { open = value; needsRender = true },
    setStandalone(value) { standalone = value; needsRender = true },
    rerender() { needsRender = true },
    focus(value, emit = true) { focused = value; if (emit) for (const listener of [...focusListeners]) listener(value) },
    holdProbe() {
      let resolve
      const promise = new Promise((done) => { resolve = done })
      deferredProbe = { promise }
      return (value) => { deferredProbe = null; resolve(value) }
    },
    async advance(milliseconds, { commit = true } = {}) {
      if (commit) await settle()
      const until = now + milliseconds
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) break
        const [id, timer] = next
        now = timer.at; timers.delete(id); timer.callback()
        if (commit) await settle()
        else await microtasks()
      }
      now = until
      if (commit) await settle()
      else await microtasks()
    },
    async unmount() {
      mounted = false; frameHooks.unmount(); hostHooks.unmount(); await microtasks()
      assert.equal(timers.size, 0, 'unmount clears every idle timer')
      assert.equal(focusListeners.size, 0, 'unmount removes every native focus listener')
    },
  }
}
let passed = 0
async function check(name, body) {
  try { await body(); passed++ } catch (error) { error.message = `${name}: ${error.message}`; throw error }
}

await check('clean surface keeps the five-minute background close', async () => {
  const h = fixture(); await h.settle(); h.report(false, owner()); h.focus(false)
  await h.advance(299_999); assert.equal(h.closes, 0)
  await h.advance(1); assert.equal(h.closes, 1); await h.unmount()
})
await check('dirty surface survives unbounded background time without re-render loops', async () => {
  const h = fixture(), first = owner(); await h.settle()
  const report = h.renderer.onUnsavedChangesChange, hostReport = h.guard.onUnsavedChangesReport
  h.report(true, first); await h.settle(); h.focus(false)
  assert.equal(h.timerCount, 0); assert.equal(h.listenerCount, 0)
  const renders = h.renders
  for (let i = 0; i < 10; i++) h.report(true, first)
  await h.settle(); assert.equal(h.renders, renders, 'identical reports are deduplicated')
  h.rerender(); await h.settle()
  assert.equal(h.renderer.onUnsavedChangesChange, report, 'parent re-render keeps the renderer report callback stable')
  assert.equal(h.guard.onUnsavedChangesReport, hostReport)
  await h.advance(30 * 60_000); assert.equal(h.closes, 0); await h.unmount()
})
await check('299s dirty report synchronously defeats an already-armed timer before commit', async () => {
  const h = fixture(), first = owner(); await h.settle(); h.focus(false); await h.advance(299_000)
  h.report(true, first)
  assert.equal(h.guard.isPaused(), true)
  await h.advance(1_000, { commit: false }); assert.equal(h.closes, 0)
  await h.settle(); assert.equal(h.timerCount, 0)
  await h.advance(600_000); assert.equal(h.closes, 0); await h.unmount()
})
await check('dirty becoming clean probes background focus and starts a fresh full interval', async () => {
  const h = fixture(), first = owner(); await h.settle(); h.focus(false); await h.advance(299_000)
  h.report(true, first); await h.advance(600_000)
  h.report(false, first); await h.settle(); assert.equal(h.timerCount, 1)
  await h.advance(299_999); assert.equal(h.closes, 0)
  await h.advance(1); assert.equal(h.closes, 1); await h.unmount()
})
for (const fireBeforeCommit of [false, true]) await check(`batched dirty -> clean restarts idle, old timer fires before commit=${fireBeforeCommit}`, async () => {
  const h = fixture(), first = owner(); await h.settle(); h.focus(false); await h.advance(299_000)
  h.report(true, first); h.report(false, first)
  assert.equal(h.guard.isPaused(), true, 'pending restart blocks the previous deadline synchronously')
  if (fireBeforeCommit) { await h.advance(1_000, { commit: false }); assert.equal(h.closes, 0) }
  await h.settle(); assert.equal(h.guard.paused, false); assert.equal(h.timerCount, 1)
  await h.advance(299_999); assert.equal(h.closes, 0)
  await h.advance(1); assert.equal(h.closes, 1); await h.unmount()
})
await check('dirty-guarded timer followed by batched clean still re-arms', async () => {
  const h = fixture(), first = owner(); await h.settle(); h.focus(false); await h.advance(299_000)
  h.report(true, first); await h.advance(1_000, { commit: false }); assert.equal(h.closes, 0)
  h.report(false, first); await h.settle(); assert.equal(h.timerCount, 1)
  await h.advance(300_000); assert.equal(h.closes, 1); await h.unmount()
})
await check('replacement target rejects old report and release', async () => {
  const h = fixture(), first = owner(); await h.settle(); h.focus(false)
  const oldReport = h.renderer.onUnsavedChangesChange, oldTarget = h.target
  h.report(true, first); await h.settle(); h.replaceTarget(); await h.settle()
  const next = owner(); h.report(true, next); await h.settle()
  oldReport(false, first); oldReport(true, first)
  h.guard.onUnsavedChangesReport({ kind: 'release', target: oldTarget, owner: first })
  await h.advance(600_000); assert.equal(h.closes, 0); assert.equal(h.guard.isPaused(), true)
  h.report(false, next); await h.advance(300_000); assert.equal(h.closes, 1); await h.unmount()
})
await check('same-target replacement owner cannot be cleared by late old cleanup', async () => {
  const h = fixture(), first = owner(), next = owner(); await h.settle(); h.focus(false)
  h.report(true, first); await h.settle(); first.active = false
  h.report(true, next); await h.settle(); h.report(false, first)
  h.guard.onUnsavedChangesReport({ kind: 'release', target: h.target, owner: first })
  await h.advance(600_000); assert.equal(h.closes, 0); assert.equal(h.guard.isPaused(), true)
  next.active = false; h.report(false, next); await h.advance(299_999); assert.equal(h.closes, 0)
  await h.advance(1); assert.equal(h.closes, 1); await h.unmount()
})
await check('hidden or missing surface drops protection and cannot resurrect a stale dirty record', async () => {
  const h = fixture(), first = owner(); await h.settle(); h.focus(false)
  h.report(true, first); await h.settle(); h.showSurface(false); await h.settle()
  assert.equal(h.guard.isPaused(), false); h.report(true, first); await h.settle()
  h.showSurface(true); await h.settle(); assert.equal(h.guard.isPaused(), false)
  await h.advance(300_000); assert.equal(h.closes, 1); await h.unmount()
})
await check('owner invalidation on a host render clears a paused timer without a fresh report', async () => {
  const h = fixture(), first = owner(); await h.settle(); h.focus(false); h.report(true, first); await h.settle()
  first.active = false; h.rerender(); await h.settle(); assert.equal(h.guard.isPaused(), false)
  await h.advance(300_000); assert.equal(h.closes, 1); await h.unmount()
})
await check('focus regain cancels idle and clean foreground surfaces stay open', async () => {
  const h = fixture(), first = owner(); await h.settle(); h.focus(false); await h.advance(299_000)
  h.focus(true); await h.advance(600_000); assert.equal(h.closes, 0)
  h.report(true, first); await h.settle(); h.report(false, first); await h.settle()
  assert.equal(h.timerCount, 0); await h.advance(600_000); assert.equal(h.closes, 0)
  h.focus(false); await h.advance(300_000); assert.equal(h.closes, 1); await h.unmount()
})
await check('stale asynchronous focus probe cannot arm after regained focus or dirty pause', async () => {
  const h = fixture({ initiallyFocused: false }), first = owner()
  const resolve = h.holdProbe(); await h.settle(); h.focus(true); resolve(false); await h.settle()
  assert.equal(h.timerCount, 0)
  h.report(true, first); await h.settle(); const resolveClean = h.holdProbe()
  h.report(false, first); await h.settle(); h.report(true, first); await h.settle(); resolveClean(false)
  await h.advance(600_000); assert.equal(h.closes, 0); assert.equal(h.timerCount, 0); await h.unmount()
})
for (const cleanFirst of [false, true]) await check(`paste lease interleave, clean before release=${cleanFirst}`, async () => {
  const h = fixture(), first = owner(); await h.settle(); h.focus(false); await h.advance(299_000)
  const scope = h.recovery.createPasteRecoveryScope()
  const attempt = h.recovery.createPasteRecoveryAttempt(scope.capture(() => true), false)
  await attempt.prepare(); attempt.startHandoff(); h.report(true, first); await h.advance(600_000)
  if (cleanFirst) { h.report(false, first); await h.settle(); assert.equal(h.timerCount, 0) }
  attempt.finish(false); await h.advance(cleanFirst ? 0 : 600_000)
  assert.equal(h.closes, 0)
  if (!cleanFirst) { assert.equal(h.guard.isPaused(), true); h.report(false, first); await h.settle() }
  await h.advance(299_999); assert.equal(h.closes, 0)
  await h.advance(1); assert.equal(h.closes, 1); await h.unmount()
})
await check('native dialog release cannot bypass dirty protection', async () => {
  const h = fixture(), first = owner(); await h.settle(); h.focus(false)
  const release = h.focusGuard.acquireLauncherNativeDialogFocus(); h.report(true, first); await h.settle()
  release(); await h.advance(600_000); assert.equal(h.closes, 0)
  h.report(false, first); await h.advance(300_000); assert.equal(h.closes, 1); await h.unmount()
})
await check('closed and non-standalone hosts never arm the background timer', async () => {
  const h = fixture({ initiallyFocused: false }); await h.settle(); h.setOpen(false); await h.settle()
  assert.equal(h.timerCount, 0); await h.advance(600_000); assert.equal(h.closes, 0)
  h.setStandalone(false); h.setOpen(true); await h.settle(); assert.equal(h.timerCount, 0)
  await h.advance(600_000); assert.equal(h.closes, 0); await h.unmount()
})
await check('unmount while focus probe or lease is pending leaves no timer or listener', async () => {
  const h = fixture({ initiallyFocused: false }), first = owner()
  const resolve = h.holdProbe(); await h.settle()
  const report = h.renderer.onUnsavedChangesChange
  const release = h.focusGuard.acquireLauncherNativeDialogFocus()
  await h.unmount(); resolve(false); release(); report(true, first); await h.advance(600_000)
  assert.equal(h.closes, 0); assert.equal(h.timerCount, 0); assert.equal(h.listenerCount, 0)
})
console.log(`Launcher surface background idle: ${passed} production hook scenarios passed`)
