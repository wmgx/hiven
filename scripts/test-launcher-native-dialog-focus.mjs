#!/usr/bin/env node
/** Actual lifecycle hooks and focus leases; synthetic native events and a fake clock. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
function fixture() {
  let now = 1_700_000_000_000, nextTimer = 0, focused = true, closes = 0
  const timers = new Map(), focusListeners = new Set(), cleanups = []
  class Clock extends Date { static now() { return now } }
  const window = {
    __TAURI_INTERNALS__: {},
    setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { at: now + delay, callback }); return id },
    clearTimeout: (id) => timers.delete(id),
  }
  function load(path, modules = {}) {
    const code = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const exports = {}
    vm.runInNewContext(code, {
      exports, module: { exports }, console, Date: Clock, window, AbortController,
      require(name) { assert.ok(Object.hasOwn(modules, name), `Unexpected dependency ${name}`); return modules[name] },
    }, { filename: path })
    return exports
  }
  const nativeWindow = { getCurrentWindow: () => ({ isFocused: async () => focused }) }
  const guard = load('src/workspace/launcherBlurGuard.ts', {
    '@tauri-apps/api/window': nativeWindow,
    '@tauri-apps/api/webviewWindow': { getAllWebviewWindows: async () => [] },
  })
  const recovery = load('src/workspace/pasteRecovery.ts', {
    '../store': { useAppStore: {} },
    './pluginSettingsStore': { usePluginSettingsStore: {} },
    './telemetry': { trackBehavior() {} },
    '@tauri-apps/api/core': { invoke: async () => 'attempt' },
  })
  const lifecycle = load('src/components/launcher/GlobalLauncherWindowLifecycle.ts', {
    react: {
      useRef: (value) => ({ current: value }),
      useCallback: (callback) => callback,
      useLayoutEffect: (effect) => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup) },
    },
    '../../workspace/windowManager/launcherWindow': {
      onCurrentLauncherWindowFocusChanged: async (callback) => {
        focusListeners.add(callback)
        return () => focusListeners.delete(callback)
      },
    },
    '../../workspace/launcherBlurGuard': guard,
    './GlobalLauncherLayout': {}, '../../workspace/launcher/perf': {},
    '@tauri-apps/api/window': nativeWindow,
    '../../workspace/pasteRecovery': recovery,
    '../../workspace/launcherWindowEvents': { LAUNCHER_NEW_SESSION_EVENT: 'hiven:launcher-new-session' },
  })
  return {
    guard, lifecycle, recovery,
    get closes() { return closes },
    onClose: () => { closes++ },
    focus(value, emit = true) { focused = value; if (emit) for (const listener of focusListeners) listener(value) },
    async advance(milliseconds) {
      const target = now + milliseconds
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) break
        const [id, timer] = next
        now = timer.at; timers.delete(id); timer.callback(); await flush()
      }
      now = target; await flush()
    },
    unmount() { for (const cleanup of cleanups) cleanup() },
  }
}

// Native focus loss is synchronously protected, without a duration limit.
{
  const test = fixture()
  test.lifecycle.useCloseStandaloneLauncherOnBlur({ open: true, standaloneLauncher: true, closeLauncher: test.onClose })
  test.lifecycle.useAutoCloseStandaloneLauncherOnBackgroundIdle({ open: true, standaloneLauncher: true, closeLauncher: test.onClose })
  await flush()
  const release = test.guard.acquireLauncherNativeDialogFocus()
  assert.equal(test.guard.launcherNativeDialogFocus.isActive(), true)
  test.focus(false)
  await test.advance(20 * 60 * 1000)
  assert.equal(test.closes, 0, 'chooser remains safe beyond the five-minute idle limit')
  test.focus(true, false)
  release(); release()
  assert.equal(test.guard.launcherNativeDialogFocus.isActive(), false, 'release is idempotent')
  await test.advance(100)
  assert.equal(test.closes, 0, 'return to launcher does not dismiss it')
  test.focus(false)
  await test.advance(100)
  assert.equal(test.closes, 1, 'ordinary blur closes after the chooser lifetime ends')
  test.unmount()
}

// Existing background time is discarded, and release starts a fresh idle interval.
{
  const test = fixture()
  test.lifecycle.useAutoCloseStandaloneLauncherOnBackgroundIdle({ open: true, standaloneLauncher: true, closeLauncher: test.onClose })
  await flush()
  test.focus(false)
  await test.advance(299_000)
  const release = test.guard.acquireLauncherNativeDialogFocus()
  await test.advance(700_000)
  assert.equal(test.closes, 0)
  release(); await flush()
  await test.advance(299_999)
  assert.equal(test.closes, 0, 'picker dismissal cannot inherit the old idle deadline')
  await test.advance(1)
  assert.equal(test.closes, 1, 'normal five-minute background closure resumes')
  test.unmount()
}

// A blur already being checked cannot race a new lease, nor can one release
// cancel another dialog's protection. Release rechecks external focus normally.
{
  const test = fixture()
  test.lifecycle.useCloseStandaloneLauncherOnBlur({ open: true, standaloneLauncher: true, closeLauncher: test.onClose })
  await flush()
  test.focus(false)
  const first = test.guard.acquireLauncherNativeDialogFocus()
  const second = test.guard.acquireLauncherNativeDialogFocus()
  await test.advance(100)
  assert.equal(test.closes, 0)
  first(); await test.advance(100)
  assert.equal(test.closes, 0)
  second(); await test.advance(100)
  assert.equal(test.closes, 1)
  test.unmount()
}

// Regained focus invalidates a pending blur check, even if the native focus
// probe's response belongs to a previous blur. Cleanup leaves no live listener.
{
  const test = fixture()
  test.lifecycle.useCloseStandaloneLauncherOnBlur({ open: true, standaloneLauncher: true, closeLauncher: test.onClose })
  test.lifecycle.useAutoCloseStandaloneLauncherOnBackgroundIdle({ open: true, standaloneLauncher: true, closeLauncher: test.onClose })
  await flush()
  test.focus(false); test.focus(true)
  await test.advance(100)
  assert.equal(test.closes, 0)
  const release = test.guard.acquireLauncherNativeDialogFocus()
  test.focus(false)
  test.unmount(); release()
  await test.advance(600_000)
  assert.equal(test.closes, 0, 'late release cannot close an unmounted session')
}

// Quick Editor and other explicit closeOnBlur:false surfaces retain their policy.
{
  const test = fixture()
  test.lifecycle.useCloseStandaloneLauncherOnBlur({ open: true, standaloneLauncher: true, closeOnBlur: false, closeLauncher: test.onClose })
  await flush()
  test.focus(false)
  await test.advance(100)
  const release = test.guard.acquireLauncherNativeDialogFocus()
  release(); await test.advance(100)
  assert.equal(test.closes, 0, 'dialog dismissal honors the current surface blur policy')
  test.unmount()
}

console.log('Native dialog focus passed: synchronous lease, long chooser, blur races, idle reset, idempotent release and cleanup')

// Paste handoff protects exactly its own native blur and background interval.
// A restored surface follows ordinary blur policy immediately, without grace.
{
  const test = fixture()
  test.lifecycle.useCloseStandaloneLauncherOnBlur({ open: true, standaloneLauncher: true, closeLauncher: test.onClose })
  test.lifecycle.useAutoCloseStandaloneLauncherOnBackgroundIdle({ open: true, standaloneLauncher: true, closeLauncher: test.onClose })
  await flush()
  const scope = test.recovery.createPasteRecoveryScope()
  const attempt = test.recovery.createPasteRecoveryAttempt(scope.capture(() => true), false)
  await attempt.prepare()
  attempt.startHandoff()
  test.focus(false)
  await test.advance(20 * 60 * 1000)
  assert.equal(test.closes, 0, 'native handoff keeps the original tree for the entire operation')
  test.focus(true)
  attempt.finish(false)
  await test.advance(100)
  assert.equal(test.closes, 0, 'restored failure does not replay the expected blur')
  test.focus(false)
  await test.advance(100)
  assert.equal(test.closes, 1, 'ordinary blur works immediately after failure')
  test.unmount()
}

{
  const test = fixture()
  test.lifecycle.useCloseStandaloneLauncherOnBlur({ open: true, standaloneLauncher: true, closeLauncher: test.onClose })
  await flush()
  const scope = test.recovery.createPasteRecoveryScope()
  const attempt = test.recovery.createPasteRecoveryAttempt(scope.capture(() => true), false)
  await attempt.prepare()
  attempt.startHandoff()
  test.focus(false)
  await test.advance(100)
  assert.equal(test.closes, 0)
  test.focus(true)
  test.focus(false)
  await test.advance(100)
  assert.equal(attempt.isCurrent(), false, 'real leave revokes recovery before a late native result')
  assert.equal(test.closes, 1, 'a second blur cannot be swallowed by the paste lease')
  test.unmount()
}
console.log('Paste focus passed: one expected blur, unbounded handoff, immediate normal blur and real-leave cancellation')
