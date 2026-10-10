#!/usr/bin/env node
/** Execute the real surface saver and its renderer binding with synthetic native I/O. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { createServer } from 'vite'

const storage = { getItem: () => null, setItem() {}, removeItem() {} }
globalThis.window = {
  localStorage: storage, sessionStorage: storage, location: { search: '' },
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
}
globalThis.localStorage = storage
globalThis.sessionStorage = storage
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const rejects = (promise, name) => assert.rejects(promise, (error) => error instanceof Error && error.name === name && !error.message.includes('/private/'))

try {
  const { createPluginSurfaceTextSaver, nativeSurfaceTextSave, SURFACE_TEXT_SAVE_MAX_BYTES } = await vite.ssrLoadModule('/src/workspace/pluginSurfaceTextSave.ts')
  const { createPasteRecoveryScope, combinePasteRecoveryOwners } = await vite.ssrLoadModule('/src/workspace/pasteRecovery.ts')
  const focus = await vite.ssrLoadModule('/src/workspace/launcherBlurGuard.ts')
  function harness() {
    const h = { current: true, session: 1, registered: [], revoked: [], prepared: [], committed: [], discarded: [], focusCount: 0 }
    const listeners = new Set()
    h.owner = { isCurrent: () => h.current, subscribeInvalidation: (fn) => { listeners.add(fn); return () => listeners.delete(fn) } }
    h.invalidate = () => { h.current = false; for (const fn of listeners) fn() }
    h.native = {
      isSupported: () => true,
      register: async (ownerId) => { const owner = { ownerId, ownerToken: 11 }; h.registered.push(owner); return owner },
      revoke: async (owner) => { h.revoked.push(owner) },
      prepare: async (owner, text, dialogTitle, suggestedFilename) => { h.prepared.push({ owner, text, dialogTitle, suggestedFilename }); return { status: 'prepared', exportId: 41 } },
      commit: async (owner, exportId) => { h.committed.push({ owner, exportId }); return { status: 'saved' } },
      discard: async (owner, exportId) => { h.discarded.push({ owner, exportId }) },
    }
    h.save = createPluginSurfaceTextSaver(h.native)
    h.context = () => {
      const session = h.session
      return { owner: h.owner, dialogTitle: 'Save text as', acquireFocusLease: () => { h.focusCount++; return focus.acquireLauncherNativeDialogFocus(() => h.session === session) } }
    }
    return h
  }
  const snapshot = ' \r\nα🙂中文\r\n /synthetic/source.csv\r\n'
  for (const text of ['', ' ', '\ufeffa,b\r\n1,2\r\n', snapshot]) {
    const h = harness()
    assert.deepEqual(await h.save(text, { suggestedFilename: '结果.csv' }, h.context()), { status: 'saved' })
    assert.equal(h.prepared[0].text, text)
    assert.equal(h.prepared[0].suggestedFilename, '结果.csv')
    assert.equal(h.committed.length, 1)
    assert.equal(h.revoked.length, 1, 'each owner is released after completion')
    assert.equal(h.discarded.length, 0)
  }
  for (const text of ['x'.repeat(SURFACE_TEXT_SAVE_MAX_BYTES), '🙂'.repeat(SURFACE_TEXT_SAVE_MAX_BYTES / 4)]) {
    const h = harness()
    assert.equal((await h.save(text, {}, h.context())).status, 'saved')
  }
  for (const text of ['x'.repeat(SURFACE_TEXT_SAVE_MAX_BYTES + 1), '🙂'.repeat(SURFACE_TEXT_SAVE_MAX_BYTES / 4) + '中']) {
    const h = harness()
    await rejects(h.save(text, {}, h.context()), 'TextTooLargeError')
    assert.equal(h.registered.length, 0); assert.equal(h.focusCount, 0)
  }
  for (const name of ['', '.', '..', ' ', '../result.csv', '/tmp/result.csv', 'C:result.csv', 'a\\b.csv', 'a\0b', 'a\u0085b', 'x'.repeat(256), '中'.repeat(86), 'NUL.txt', 'Com1.csv', 'LPT9', 'result.', 'result ', 'a?b.csv']) {
    const h = harness()
    await rejects(h.save(snapshot, { suggestedFilename: name }, h.context()), 'InvalidFilenameError')
    assert.equal(h.registered.length, 0, name)
  }
  {
    const h = harness()
    await rejects(h.save({ text: snapshot }, {}, h.context()), 'TypeError')
    const aborted = new AbortController(); aborted.abort()
    await rejects(h.save(snapshot, { signal: aborted.signal }, h.context()), 'AbortError')
    h.current = false
    await rejects(h.save(snapshot, {}, h.context()), 'AbortError')
    assert.equal(h.registered.length, 0)
  }
  for (const invalidate of ['owner', 'abort']) {
    const h = harness(), registration = deferred(), signal = new AbortController()
    h.native.register = () => registration.promise
    const pending = h.save(snapshot, { signal: signal.signal }, h.context())
    const rejected = rejects(pending, 'AbortError')
    if (invalidate === 'owner') h.invalidate(); else signal.abort()
    registration.resolve({ ownerId: 'late', ownerToken: 22 })
    await rejected
    assert.deepEqual(h.revoked, [{ ownerId: 'late', ownerToken: 22 }])
    assert.equal(h.prepared.length, 0); assert.equal(h.focusCount, 0)
  }
  for (const invalidate of ['owner', 'abort', 'reopen']) {
    const h = harness(), chooser = deferred(), signal = new AbortController(), context = h.context()
    h.native.prepare = async (...args) => { h.prepared.push(args); return chooser.promise }
    const pending = h.save(snapshot, { signal: signal.signal }, context)
    const rejected = rejects(pending, 'AbortError')
    await flush()
    assert.equal(focus.launcherNativeDialogFocus.isActive(), true)
    await rejects(h.save('second', {}, context), 'BusyError')
    if (invalidate === 'abort') signal.abort(); else h.invalidate()
    if (invalidate === 'reopen') h.session++
    assert.equal(h.revoked.length, 1, 'revocation does not wait for the native chooser')
    assert.equal(focus.launcherNativeDialogFocus.isActive(), invalidate !== 'reopen')
    h.current = true
    await rejects(h.save('new attempt', {}, h.context()), 'BusyError')
    chooser.resolve({ status: 'prepared', exportId: 42 })
    await rejected
    assert.equal(h.committed.length, 0)
    assert.equal(h.discarded[0].exportId, 42)
    assert.equal(focus.launcherNativeDialogFocus.isActive(), false)
    h.native.prepare = async () => ({ status: 'cancelled' })
    assert.deepEqual(await h.save('retry', {}, h.context()), { status: 'cancelled' })
  }
  {
    const h = harness()
    h.native.prepare = async () => ({ status: 'cancelled' })
    assert.deepEqual(await h.save(snapshot, {}, h.context()), { status: 'cancelled' })
    assert.equal(h.committed.length, 0)
    assert.equal(h.discarded.length, 0)
  }
  {
    const h = harness()
    const context = { ...h.context(), acquireFocusLease: () => () => h.invalidate() }
    await rejects(h.save(snapshot, {}, context), 'AbortError')
    assert.equal(h.committed.length, 0, 'focus-release listener invalidation is checked before commit')
    assert.equal(h.discarded[0].exportId, 41)
  }
  for (const [nativeError, name] of [
    ['TEXT_EXPORT_TOO_LARGE', 'TextTooLargeError'], ['TEXT_EXPORT_INVALID_FILENAME', 'InvalidFilenameError'],
    ['TEXT_EXPORT_INVALID_LEASE', 'AbortError'], ['TEXT_EXPORT_BUSY', 'BusyError'],
    ['TEXT_EXPORT_UNAVAILABLE', 'SaveUnavailableError'], ['TEXT_EXPORT_WRITE_FAILED', 'SaveFailedError'],
    [new Error('write /private/user/file.csv failed'), 'SaveFailedError'],
  ]) {
    const h = harness()
    h.native.prepare = async () => { throw nativeError }
    await rejects(h.save(snapshot, {}, h.context()), name)
    assert.equal(focus.launcherNativeDialogFocus.isActive(), false)
  }
  for (const outcome of ['saved', 'failed', 'revoked-before-accept']) {
    const h = harness(), write = deferred(), signal = new AbortController()
    h.native.commit = async (owner, exportId) => { h.committed.push({ owner, exportId }); return write.promise }
    const pending = h.save(snapshot, { signal: signal.signal }, h.context())
    const result = outcome === 'saved' ? pending : rejects(pending, outcome === 'failed' ? 'SaveFailedError' : 'AbortError')
    await flush()
    assert.equal(h.committed.length, 1)
    h.invalidate(); signal.abort()
    assert.equal(h.revoked.length, 1, 'dispatch is not acceptance: native revoke still races with consume')
    if (outcome === 'saved') write.resolve({ status: 'saved' })
    else write.reject(outcome === 'failed' ? 'TEXT_EXPORT_WRITE_FAILED' : 'TEXT_EXPORT_INVALID_LEASE')
    const actual = await result
    if (outcome === 'saved') assert.deepEqual(actual, { status: 'saved' }, 'accepted write is not rewritten to cancelled after abort')
  }
  // Actual browser and relay gates never invoke a fake download or native write.
  for (const relay of [false, true]) {
    let calls = 0
    if (relay) window.__TAURI_INTERNALS__ = { invoke: async () => { calls++ } }
    else delete window.__TAURI_INTERNALS__
    window.__HIVEN_WEB_NATIVE_BRIDGE__ = relay
    const h = harness()
    await rejects(createPluginSurfaceTextSaver()(snapshot, {}, h.context()), 'NotSupportedError')
    assert.equal(calls, 0)
  }
  // Native adapter only exposes immutable text + safe suggested name to the host kernel.
  for (const label of ['launcher', 'editor:synthetic', 'plugin-surface:installed:csv:tool']) {
    const calls = []
    window.__HIVEN_WEB_NATIVE_BRIDGE__ = false
    window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label } }, invoke: async (command, args) => {
      calls.push({ command, args })
      if (command === 'get_launcher_window_resize_session') return { session: 7 }
      if (command === 'register_host_surface_text_export_owner') return { ownerToken: 19 }
      if (command === 'prepare_host_surface_text_export') return { status: 'prepared', exportId: 73 }
      if (command === 'commit_host_surface_text_export') return { status: 'saved' }
    } }
    const h = harness()
    assert.deepEqual(await createPluginSurfaceTextSaver()(snapshot, { suggestedFilename: 'result.csv' }, h.context()), { status: 'saved' })
    const register = calls.find((call) => call.command === 'register_host_surface_text_export_owner')
    assert.equal(register.args.expectedSession, label === 'launcher' ? 7 : undefined)
    const owner = { ownerId: register.args.ownerId, ownerToken: 19 }
    assert.deepEqual(calls.find((call) => call.command === 'prepare_host_surface_text_export').args, { ...owner, text: snapshot, dialogTitle: 'Save text as', suggestedFilename: 'result.csv' })
    assert.deepEqual(calls.find((call) => call.command === 'commit_host_surface_text_export').args, { ...owner, exportId: 73 })
    assert.deepEqual(calls.at(-1), { command: 'revoke_host_surface_text_export_owner', args: owner })
    await nativeSurfaceTextSave.discard(owner, 74)
    assert.deepEqual(calls.at(-1), { command: 'discard_host_surface_text_export', args: { ...owner, exportId: 74 } })
  }
  // Execute the production memo binding, not React or UI rendering. Its identity
  // stays stable across ordinary rerenders and is sealed to the original owner.
  {
    const path = 'src/components/pluginSurface/PluginSurfaceRenderer.tsx'
    const source = readFileSync(path, 'utf8')
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
    const fn = file.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === 'PluginSurfaceRenderer')
    const declaration = fn.body.statements.find((n) => ts.isVariableStatement(n) && n.declarationList.declarations.some((d) => d.name.getText(file) === 'saveText'))
    const code = ts.transpileModule(`${declaration.getText(file)}; saveText`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
    const target = { pluginId: 'csv', source: 'installed' }, ready = { status: 'ready', target }, lifetime = { active: true }
    let launcherCurrent = true, memo
    const calls = []
    const context = {
      target, surfaceState: ready, presentation: 'global-launcher', pasteOwnerVersion: 0,
      appSettingsSession: null, launcherSettingsTarget: null, launcherSessionId: 1,
      activeTargetRef: { current: target }, activeStateRef: { current: ready }, mountedRef: { current: true },
      hiddenRef: { current: false }, sessionRef: { current: null }, ownedSettingsTargetRef: { current: null }, localeRef: { current: 'en' },
      pasteScope: createPasteRecoveryScope(), pluginRegistry: { getPluginLifetime: () => lifetime },
      combinePasteRecoveryOwners, captureLauncherPasteOwner: () => { const valid = launcherCurrent; return { isCurrent: () => valid && launcherCurrent, subscribeInvalidation: () => () => {} } },
      useAppStore: { getState: () => ({ globalLauncherOpen: launcherCurrent, globalLauncherSessionId: 1 }) },
      usePluginSettingsStore: { getState: () => ({ settingsDialogTarget: null }) },
      t: () => 'Save text as', acquireLauncherNativeDialogFocus: focus.acquireLauncherNativeDialogFocus,
      textSaverRef: { current: (text, options, request) => { calls.push(request); return request.owner.isCurrent() } },
      useMemo: (factory, deps) => { if (!memo || deps.some((dep, i) => dep !== memo.deps[i])) memo = { deps, value: factory() }; return memo.value },
    }
    const render = () => vm.runInNewContext(code, { ...context })
    const first = render()
    assert.equal(first, render(), 'theme/status rerender preserves save owner identity')
    assert.equal(first('text'), true)
    launcherCurrent = false
    assert.equal(first('text'), false, 'old launcher lifetime cannot save')
    launcherCurrent = true
    context.pasteScope.invalidate()
    assert.equal(first('text'), false, 'scope revocation is terminal')
    context.pasteOwnerVersion++
    const second = render()
    assert.notEqual(first, second)
    assert.equal(second('text'), true)
    context.activeTargetRef.current = { ...target }
    assert.equal(second('text'), false, 'replacement renderer rejects its retained callback')
    assert.ok(calls.length > 0)

    const feedback = new Map()
    function findFeedback(node) {
      if (ts.isPropertyAssignment(node) && ['showToast', 'showMessage'].includes(node.name.getText(file))) feedback.set(node.name.getText(file), node.initializer)
      ts.forEachChild(node, findFeedback)
    }
    findFeedback(fn)
    for (const name of ['showToast', 'showMessage']) {
      let currentLauncher = true, shown = 0
      const callbackCode = ts.transpileModule(`const feedback = ${feedback.get(name).getText(file)}; feedback`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
      const callback = vm.runInNewContext(callbackCode, {
        surfaceOwner: { isCurrent: () => true }, presentation: 'global-launcher',
        launcherPasteOwner: { isCurrent: () => currentLauncher }, showToast: () => { shown++; return 'toast-id' },
      })
      callback('saved', 'success')
      assert.equal(shown, 1)
      currentLauncher = false
      callback('old write completed', 'success')
      assert.equal(shown, 1, `${name}: stale accepted-save feedback cannot reach a replacement launcher session before React renders`)
    }
  }
  console.log('PASS surface text save: SDK host binding, exact/empty snapshots, 10 MiB UTF-8, basename validation, owner/abort races, single-flight, focus sessions, real commit results, sanitized errors, browser/relay rejection, and native adapter')
} finally {
  await vite.close()
}
