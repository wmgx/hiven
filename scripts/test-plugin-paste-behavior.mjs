#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { createStore } from 'zustand/vanilla'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const refactorSuite = readFileSync('scripts/test-refactor-suite.mjs', 'utf8')

assert.equal(
  packageJson.scripts?.['test:plugin-paste-behavior'],
  'node scripts/test-plugin-paste-behavior.mjs',
  'package.json must expose plugin paste behavior coverage',
)
assert.match(
  refactorSuite,
  /test:plugin-paste-behavior/,
  'refactor suite must include plugin paste behavior coverage',
)


function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

function loadModule(path, imports = {}, globals = {}) {
  const out = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
      esModuleInterop: true,
    },
  }).outputText
  const moduleExports = {}
  const sandbox = {
    exports: moduleExports,
    module: { exports: moduleExports },
    console, URLSearchParams, setTimeout, clearTimeout, AbortController,
    ...globals,
    require: (specifier) => {
      if (Object.hasOwn(imports, specifier)) return imports[specifier]
      throw new Error(`Unexpected import in ${path}: ${specifier}`)
    },
  }
  vm.runInNewContext(out, sandbox, { filename: path })
  return sandbox.module.exports
}

const telemetryBoundary = loadModule('src/workspace/contentBoundary.ts')
const workspaceMessages = loadModule('src/i18n/locales/workspace.ts').default
const i18n = loadModule('src/i18n/registry.ts')
i18n.registerMessages('workspace', workspaceMessages)
i18n.registerMessages('palette', loadModule('src/i18n/locales/palette.ts').default)
i18n.t = (locale, dottedKey) => {
  const dot = dottedKey.indexOf('.')
  return i18n.translate(locale, dottedKey.slice(0, dot), dottedKey.slice(dot + 1))
}

function loadPluginPaste({
  invokeImpl, beginImpl, writeTextImpl, writeImageImpl, navigatorClipboard,
  windowSearch, locale = 'en', availability = 'can-attempt', availabilityImpl,
  timers = {},
} = {}) {
  const calls = []
  const telemetry = []
  const telemetryApi = { trackBehavior: (event, details) => telemetry.push([event, telemetryBoundary.sanitizeNoContentDetails(details)]) }
  const availabilityCalls = []
  // Run the real store transitions; unrelated persistence/data helpers are I/O stubs.
  const appStore = loadModule('src/store.ts', {
    zustand: { create: () => (initialize) => createStore(initialize) },
    'zustand/middleware': { persist: (initialize) => initialize },
    './workspace/ai/jev': { JEV_PRESETS: { tencent: {} } },
    './utils/persistMigration': { migrateLocalStorageKey() {} },
    './workspace/launcher/persistableRecents': { emptyPersistableRecents: () => [] },
    './workspace/launcher/usage': { emptyUsageBySurface: () => ({}) },
    './workspace/launcher/favorites': { emptyLauncherFavorites: () => [] },
    './workspace/appHotkeys': { emptyAppHotkeys: () => [] },
    './workspace/appLauncher/appSearchAliases': {},
  }).useAppStore
  appStore.setState({ globalLauncherOpen: true, locale })
  appStore.subscribe((next, previous) => {
    if (next.globalLauncherOpen !== previous.globalLauncherOpen) calls.push(['setOpen', next.globalLauncherOpen])
  })
  const state = { get open() { return appStore.getState().globalLauncherOpen } }
  const settingsStore = createStore(() => ({ settingsDialogTarget: null }))
  const ownershipCalls = []
  let nextAttempt = 0
  const core = {
    invoke: async (command, args) => {
      if (command === 'get_paste_availability') {
        availabilityCalls.push(command)
        return availabilityImpl ? await availabilityImpl() : availability
      }
      if (command === 'begin_paste_attempt') { ownershipCalls.push([command]); return beginImpl ? beginImpl() : `paste-${++nextAttempt}` }
      if (command === 'cancel_paste_attempt') { ownershipCalls.push([command, args.attemptId]); return }
      if (command !== 'hide_launcher_and_paste') throw new Error(`Unexpected native command: ${command}`)
      if (invokeImpl) return invokeImpl(command, args)
      calls.push(['invoke', command])
    },
  }
  const availabilityApi = loadModule('src/workspace/pasteAvailability.ts', {
    '@tauri-apps/api/core': core,
  }, timers)
  const permissionApi = {
    requirePluginPermissions: (snapshot, required) => {
      calls.push(['require', required])
      if (snapshot?.deny) throw new Error(`denied:${required.join(',')}`)
    },
  }
  const clipboardApi = {
    writeClipboardImageBytes: async (bytes) => {
      const image = { kind: 'image', bytes: Array.from(bytes) }
      if (writeImageImpl) await writeImageImpl(image)
      else calls.push(['tauri.writeImage', image])
    },
  }
  const recovery = loadModule('src/workspace/pasteRecovery.ts', {
    '../store': { useAppStore: appStore },
    './pluginSettingsStore': { usePluginSettingsStore: settingsStore },
    './telemetry': telemetryApi,
    '@tauri-apps/api/core': core,
  })
  const api = loadModule('src/workspace/pluginPaste.ts', {
    './pluginPermissions': permissionApi,
    './pluginClipboard': clipboardApi,
    '../i18n': i18n,
    '../store': { useAppStore: appStore },
    './pasteRecovery': recovery,
    './telemetry': telemetryApi,
    './pasteAvailability': availabilityApi,
    './nativeClipboard': { writeText: writeTextImpl ?? (async (text) => calls.push(['tauri.writeText', text])) },
    '@tauri-apps/api/core': core,
  }, {
    window: windowSearch === undefined ? undefined : { location: { search: windowSearch } },
    navigator: { clipboard: navigatorClipboard ?? { writeText: async (text) => calls.push(['navigator.writeText', text]) } },
    setTimeout: (fn, ms) => { calls.push(['delay', ms]); fn(); return 0 },
  })
  const forbidden = () => { throw new Error('Unexpected unrelated I/O') }
  const launcherModule = loadModule('src/workspace/launcher/pluginApi.ts', {
    '../effectRunner': { openExternalUrl: forbidden },
    '../toast': { showToast: forbidden },
    '../launcherHostSurfaceBridge': { requestOpenLauncherHostSurface: forbidden },
    '../pluginSurfaceOpenRequest': { openLauncherHostedPluginSurface: forbidden },
    '../pluginRegistry': { pluginRegistry: {} },
    '../pluginStorage': { createPluginPrivateStorage: forbidden },
    '../pluginPermissions': permissionApi,
    '../editorBridge': { getActiveEditorContextSnapshot: forbidden, getActiveEditorPaneSnapshot: forbidden },
    '../quickEditor/quickEditorRequests': { createQuickEditorPane: forbidden, overwriteQuickEditorText: forbidden, showQuickEditorSurface: forbidden },
    '../quickEditor/quickEditorPaneSnapshot': { readQuickEditorPaneSnapshot: forbidden },
    '../nativeClipboard': { readNativeClipboardText: forbidden },
    '../pluginPaste': api,
    '../appLauncher/appLaunchError': { rethrowAppLaunchError: forbidden },
    '../pluginClipboard': { writeClipboardText: forbidden },
  })
  const router = loadModule('src/workflow/outputRouter.ts', {
    '../workspace/pluginPaste': api,
    '../workspace/launcher/pluginApi': launcherModule,
    '../workspace/windowManager/pluginSurfaceWindows': { showPluginSurfaceWindow: forbidden },
    '../workspace/quickEditor/quickEditorRequests': { createQuickEditorPane: forbidden, overwriteQuickEditorText: forbidden },
  })
  const output = loadModule('src/workspace/launcher/output.ts', {
    './types': loadModule('src/workspace/launcher/types.ts'),
    '../../i18n': i18n,
  })
  return { api, calls, telemetry, availabilityApi, availabilityCalls, state, appStore, settingsStore, recovery, ownershipCalls, launcherModule, router, output }
}

{
  const invoked = []
  const { api, calls } = loadPluginPaste({
    windowSearch: '?window=launcher',
    invokeImpl: async (command, args) => { invoked.push([command, args]); calls.push(['invoke', command]) },
  })
  const paste = api.createPluginPaste()
  const result = await paste.pasteText('hello foreground')
  assert.deepEqual(plain(result), { ok: true })
  assert.deepEqual(plain(calls), [
    ['tauri.writeText', 'hello foreground'],
    ['invoke', 'hide_launcher_and_paste'],
    ['setOpen', false],
  ], 'pasteText must write clipboard then invoke the combined hide-and-paste command exactly once')
  assert.deepEqual(plain(invoked), [['hide_launcher_and_paste', { keepOpen: false, attemptId: 'paste-1' }]])
  assert.ok(
    !calls.some((call) => call[0] === 'delay'),
    'pasteText must not rely on any JS-side delay; a hidden WKWebView throttles timers, so the hide+paste sequence must run entirely inside the Rust command',
  )
  const independent = loadPluginPaste({ invokeImpl: async (command, args) => invoked.push([command, args]) })
  await independent.api.createPluginPaste(undefined, undefined, { keepOpen: true }).pasteText('standalone output')
  assert.deepEqual(plain(invoked[1]), ['hide_launcher_and_paste', { keepOpen: true }], 'independent tools must preserve their window when pasting')
  assert.equal(calls.filter(([kind]) => kind === 'setOpen').length, 1, 'keepOpen paste must not end the session')
}

{
  const { api, calls } = loadPluginPaste({
    invokeImpl: async (command) => {
      calls.push(['invoke', command])
      if (command === 'hide_launcher_and_paste') throw new Error('Accessibility permission required')
    },
  })
  const result = await api.createPluginPaste().pasteText('needs permission')
  assert.deepEqual(plain(result), {
    ok: false,
    fallback: 'copied',
    message: 'Copied to clipboard. Grant Accessibility access in System Settings → Privacy & Security → Accessibility to enable auto-paste.',
  }, 'Accessibility permission failures must return the explicit copied fallback message')
  assert.deepEqual(plain(calls), [
    ['tauri.writeText', 'needs permission'],
    ['invoke', 'hide_launcher_and_paste'],
  ], 'permission denial must surface from the single combined invoke, with no separate hide/simulate calls or JS delay')
}

{
  const { api, calls } = loadPluginPaste({
    writeTextImpl: async () => { throw new Error('tauri clipboard unavailable') },
    navigatorClipboard: { writeText: async (text) => calls.push(['navigator.writeText', text]) },
  })
  const result = await api.createPluginPaste({}).pasteFiles(['/tmp/a.txt', '/tmp/b.txt'])
  assert.deepEqual(plain(result), { ok: true })
  assert.deepEqual(plain(calls), [
    ['require', ['clipboard.write', 'clipboard.files', 'accessibility.paste']],
    ['navigator.writeText', '/tmp/a.txt\n/tmp/b.txt'],
    ['invoke', 'hide_launcher_and_paste'],
  ], 'pasteFiles must copy newline-separated file paths and invoke the combined hide-and-paste command exactly once')
}

{
  const storage = { blob: { get: async (blobId) => blobId === 'image-1' ? new Uint8Array([1, 2, 3]) : undefined } }
  const { api, calls } = loadPluginPaste()
  const result = await api.createPluginPaste(undefined, storage).pasteImage('image-1')
  assert.deepEqual(plain(result), { ok: true })
  assert.deepEqual(plain(calls), [
    ['tauri.writeImage', { kind: 'image', bytes: [1, 2, 3] }],
    ['invoke', 'hide_launcher_and_paste'],
  ], 'pasteImage must write image bytes then invoke the combined hide-and-paste command exactly once')
}

{
  const { api } = loadPluginPaste()
  const result = await api.createPluginPaste(undefined, undefined).pasteImage('missing')
  assert.deepEqual(plain(result), { ok: false, fallback: 'none', message: workspaceMessages.en['paste.imageStorageRequired'] })
}

{
  const { api } = loadPluginPaste({ writeTextImpl: async () => { throw new Error('write failed') }, navigatorClipboard: { writeText: async () => { throw new Error('write failed') } } })
  const result = await api.createPluginPaste().pasteText('cannot copy')
  assert.deepEqual(plain(result), { ok: false, fallback: 'none', message: 'Failed to write to clipboard' })
}

{
  const { api } = loadPluginPaste({
    locale: 'zh',
    writeTextImpl: async () => { throw new Error('write failed') },
    navigatorClipboard: { writeText: async () => { throw new Error('write failed') } },
  })
  const result = await api.createPluginPaste().pasteText('cannot copy')
  assert.deepEqual(plain(result), { ok: false, fallback: 'none', message: '无法写入剪贴板' })
}

// Exercise real module boundaries with fake native/clipboard I/O. Known blocked
// availability must reject all deliveries before reading blobs or closing a session.
const deliveries = [
  { method: 'pasteText', value: '  result to retain\n', fallbackKey: 'paste.copied' },
  { method: 'pasteImage', value: 'image-1', fallbackKey: 'paste.imageCopied' },
  { method: 'pasteFiles', value: ['/tmp/a.txt', '/tmp/b.txt'], fallbackKey: 'paste.filesCopied' },
]

for (const availability of ['unsupported', 'accessibility-required']) {
  for (const locale of ['en', 'zh']) {
    for (const { method, value } of deliveries) {
      for (const keepOpen of [false, true]) {
        const h = loadPluginPaste({ availability, locale, windowSearch: '?window=launcher' })
        const storage = { blob: { get: async () => { h.calls.push(['blob.get']); return new Uint8Array([1]) } } }
        const result = await h.api.createPluginPaste({}, storage, { keepOpen })[method](value)
        const key = availability === 'unsupported' ? 'paste.unsupported' : 'paste.permissionRequired'
        assert.deepEqual(plain(result), { ok: false, fallback: 'none', message: workspaceMessages[locale][key] })
        assert.deepEqual(h.availabilityCalls, ['get_paste_availability'])
        assert.equal(h.calls.length, 1, `${availability}: ${method} performs only the plugin permission check`)
        assert.equal(h.calls[0][0], 'require')
        assert.equal(h.state.open, true, `${availability}: ${method} must preserve the launcher session`)
      }
    }
  }
}

for (const { method, value } of deliveries) {
  const h = loadPluginPaste({ availability: 'unsupported' })
  await assert.rejects(h.api.createPluginPaste({ deny: true })[method](value), /denied:/)
  assert.equal(h.availabilityCalls.length, 0, 'plugin permissions must be checked before native preflight')
  assert.equal(h.calls.length, 1)
}

for (const response of [undefined, null, 'ready', 'unknown', { status: 'can-attempt' }]) {
  const h = loadPluginPaste({ availabilityImpl: async () => response, windowSearch: '?window=launcher' })
  assert.equal(await h.availabilityApi.readPasteAvailability(), 'unknown', 'unknown responses cannot claim paste is available')
  assert.equal(h.availabilityApi.pasteAvailabilityMessageKey('unknown'), undefined)
  assert.deepEqual(plain(await h.api.createPluginPaste().pasteText('legacy host')), { ok: true })
  assert.deepEqual(plain(h.calls), [
    ['tauri.writeText', 'legacy host'], ['invoke', 'hide_launcher_and_paste'], ['setOpen', false],
  ], 'unrecognized metadata preserves the existing native attempt')
}

{
  const h = loadPluginPaste({ availabilityImpl: async () => { throw new Error('Command get_paste_availability not found') } })
  assert.equal(await h.availabilityApi.readPasteAvailability(), 'unknown')
  assert.deepEqual(plain(await h.api.createPluginPaste().pasteText('old native')), { ok: true })
  assert.equal(h.calls.filter(([kind]) => kind === 'tauri.writeText').length, 1)
  assert.equal(h.calls.filter(([kind]) => kind === 'invoke').length, 1)
}

{
  const pendingTimers = new Map()
  let timerId = 0
  let rejectMetadata
  const metadata = new Promise((_resolve, reject) => { rejectMetadata = reject })
  const unhandled = []
  const onUnhandled = (error) => unhandled.push(error)
  process.on('unhandledRejection', onUnhandled)
  try {
    const h = loadPluginPaste({
      availabilityImpl: () => metadata,
      timers: {
        setTimeout: (fn, ms) => { assert.equal(ms, 300); pendingTimers.set(++timerId, fn); return timerId },
        clearTimeout: (id) => pendingTimers.delete(id),
      },
    })
    const paste = h.api.createPluginPaste().pasteText('slow metadata transport')
    await new Promise(setImmediate)
    assert.equal(h.calls.length, 0, 'paste waits for metadata before any side effects')
    assert.equal(pendingTimers.size, 1)
    for (const timeout of pendingTimers.values()) timeout()
    assert.deepEqual(plain(await paste), { ok: true }, 'bounded metadata timeout retains the original attempt')
    assert.equal(pendingTimers.size, 0, 'completed preflight cleans up its timer')
    rejectMetadata(new Error('late bridge disconnect'))
    await new Promise(setImmediate)
    assert.deepEqual(unhandled, [], 'late native rejections remain handled after timeout')
    assert.equal(h.calls.filter(([kind]) => kind === 'invoke').length, 1)
  } finally {
    process.removeListener('unhandledRejection', onUnhandled)
  }
}

for (const availability of ['can-attempt', 'unknown']) {
  for (const locale of ['en', 'zh']) {
    for (const { method, value, fallbackKey } of deliveries) {
      const h = loadPluginPaste({
        availability, locale, windowSearch: '?window=launcher',
        invokeImpl: async (command) => { h.calls.push(['invoke', command]); throw new Error('Native simulation failed') },
      })
      const storage = { blob: { get: async () => new Uint8Array([1, 2, 3]) } }
      const result = await h.api.createPluginPaste(undefined, storage)[method](value)
      assert.deepEqual(plain(result), { ok: false, fallback: 'copied', message: workspaceMessages[locale][fallbackKey] })
      assert.equal(h.calls.filter(([kind]) => kind.startsWith('tauri.write')).length, 1)
      assert.equal(h.calls.filter(([kind]) => kind === 'invoke').length, 1)
      assert.equal(h.state.open, true, 'copied fallback preserves the original launcher session')
    }
  }
}

{
  let availability = 'accessibility-required'
  const h = loadPluginPaste({ availabilityImpl: async () => availability })
  const paste = h.api.createPluginPaste()
  assert.equal((await paste.pasteText('retry')).fallback, 'none')
  availability = 'can-attempt'
  assert.deepEqual(plain(await paste.pasteText('retry')), { ok: true })
  assert.equal(h.availabilityCalls.length, 2, 'each attempt rechecks permission changes instead of caching blocked status')
}

// Host adapters used to discard fallback:none and turn it into a successful
// action. Follow the real output callbacks and workflow router through paste.
for (const availability of ['unsupported', 'accessibility-required', 'can-attempt']) {
  for (const entry of ['launcher-primary', 'launcher-secondary', 'workflow']) {
    const h = loadPluginPaste({
      availability, windowSearch: '?window=launcher',
      invokeImpl: async (command) => { h.calls.push(['invoke', command]); throw new Error('Native simulation failed') },
    })
    const text = '  retained output\n'
    const launcher = h.launcherModule.createPluginLauncherApi()
    let run
    if (entry === 'workflow') {
      const ctx = h.router.createDefaultOutputRouterContext()
      run = () => h.router.routeTextOutput(text, { kind: 'paste-to-foreground-app' }, ctx)
    } else if (entry === 'launcher-primary') {
      const result = h.output.foregroundPasteResult(text, launcher)
      run = result.output.choices[0].primaryAction
    } else {
      const result = h.output.textResult(text, launcher)
      run = result.output.choices[0].secondaryActions.find((action) => action.id === 'paste-to-foreground-app').run
    }
    if (availability === 'can-attempt') {
      await assert.rejects(run(), (error) => error.message === workspaceMessages.en['paste.copied'], 'copied fallback cannot consume the result as delivered')
      assert.equal(h.calls.filter(([kind]) => kind === 'invoke').length, 1)
      assert.equal(h.state.open, true)
    } else {
      const key = availability === 'unsupported' ? 'paste.unsupported' : 'paste.permissionRequired'
      await assert.rejects(run(), (error) => error.message === workspaceMessages.en[key])
      assert.deepEqual(h.calls, [], `${entry}: blocked output must not reach clipboard or native hide`)
      assert.equal(h.state.open, true)
    }
  }
}

console.log('plugin paste behavior checks passed (real availability, paste, launcher/output adapters; fake I/O)')

const deferred = () => {
  let resolve, reject
  const promise = new Promise((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }

// A native failure returns to the exact store generation and surface, retaining
// the same tree; only a delivered result is allowed to close that session.
for (const outcome of ['success', 'failure']) {
  const native = deferred()
  const h = loadPluginPaste({ windowSearch: '?window=launcher', invokeImpl: () => native.promise })
  const target = { pluginId: 'clipboard-history', surfaceId: 'history', source: 'builtin' }
  h.appStore.getState().openPluginSurfaceTool(target)
  const owner = h.recovery.captureLauncherPasteOwner()
  const result = h.api.createPluginPaste(undefined, undefined, { ownerSource: { capture: () => owner } }).pasteText('draft and selection')
  await settle()
  const generation = h.appStore.getState().globalLauncherSessionId
  assert.equal(h.state.open, true, 'native hide does not close the React tree')
  assert.equal(h.appStore.getState().pluginSurfaceToolTarget, target)
  assert.equal(h.recovery.observePasteRecoveryFocus(false), true, 'only handoff blur is consumed')
  h.recovery.observePasteRecoveryFocus(true)
  if (outcome === 'failure') native.reject(new Error('simulation failed'))
  else native.resolve()
  const delivered = await result
  assert.equal(delivered.ok, outcome === 'success')
  assert.equal(h.state.open, outcome === 'failure')
  assert.equal(h.recovery.pasteRecoveryFocus.isActive(), false)
  const terminal = h.telemetry.filter(([event]) => event === 'behavior:paste.result')
  assert.equal(terminal.length, 1, 'one terminal signal per paste result')
  assert.equal(terminal[0][1].status, outcome === 'success' ? 'ok' : 'copied')
  assert.equal(terminal[0][1].reason, 'none')
  if (outcome === 'failure') {
    assert.equal(delivered.fallback, 'copied')
    assert.equal(h.appStore.getState().globalLauncherSessionId, generation)
    assert.equal(h.appStore.getState().pluginSurfaceToolTarget, target)
  } else {
    assert.equal(owner.isCurrent(), true, 'authorized own close allows completion bookkeeping')
    h.appStore.getState().setGlobalLauncherOpen(true)
    assert.equal(owner.isCurrent(), false, 'a reopen invalidates even an already completed owner')
  }
}

// Every asynchronous boundary observes true→true reopen, close and replacement.
// These are the real store actions, not a reimplementation of generation logic.
for (const stage of ['availability', 'begin', 'clipboard', 'native']) {
  for (const leave of ['reopen', 'close', 'surface', 'settings']) {
    const pending = deferred()
    const h = loadPluginPaste({
      windowSearch: '?window=launcher',
      ...(stage === 'availability' ? { availabilityImpl: () => pending.promise } : {}),
      ...(stage === 'begin' ? { beginImpl: () => pending.promise } : {}),
      ...(stage === 'clipboard' ? { writeTextImpl: () => pending.promise } : {}),
      ...(stage === 'native' ? { invokeImpl: () => pending.promise } : {}),
    })
    const original = h.recovery.captureLauncherPasteOwner()
    const result = h.api.createPluginPaste(undefined, undefined, { ownerSource: { capture: () => original } }).pasteText('old content')
    await settle()
    if (leave === 'reopen') h.appStore.getState().setGlobalLauncherOpen(true)
    if (leave === 'close') h.appStore.getState().setGlobalLauncherOpen(false)
    if (leave === 'surface') h.appStore.getState().openLauncherHostSurface({ id: 'new-surface' })
    if (leave === 'settings') h.settingsStore.setState({ settingsDialogTarget: { pluginId: 'new-settings' } })
    const currentGeneration = h.appStore.getState().globalLauncherSessionId
    pending.resolve(stage === 'availability' ? 'can-attempt' : stage === 'begin' ? 'delayed-owner' : undefined)
    const cancelled = await result
    assert.equal(h.recovery.isPasteCancelled(cancelled), true, `${stage}/${leave}: late completion is cancelled`)
    assert.equal(cancelled.message, '')
    const terminal = h.telemetry.filter(([event]) => event === 'behavior:paste.result')
    assert.equal(terminal.length, 1)
    assert.equal(terminal[0][1].status, 'cancelled')
    assert.equal(terminal[0][1].reason, 'owner-invalidated')
    assert.equal(h.appStore.getState().globalLauncherSessionId, currentGeneration, `${stage}/${leave}: never closes the replacement`)
    assert.equal(h.state.open, leave !== 'close')
    if (stage !== 'native') assert.equal(h.calls.some(([kind]) => kind === 'invoke'), false, 'stale delivery never hides')
    if (stage === 'availability' || stage === 'begin') assert.equal(h.calls.some(([kind]) => kind.startsWith('tauri.write')), false, 'stale owner never writes')
    if (stage !== 'availability') assert.ok(h.ownershipCalls.some(([command]) => command === 'cancel_paste_attempt'))
  }
}

// Independent History and other surfaces use their instance scope, without
// accidentally capturing a global-launcher session in the same app store.
for (const keepOpen of [false, true]) {
  const native = deferred()
  const h = loadPluginPaste({ invokeImpl: () => native.promise })
  const scope = h.recovery.createPasteRecoveryScope()
  let completed = 0
  const owner = scope.capture(() => true, () => completed++)
  const paste = h.api.createPluginPaste(undefined, undefined, { keepOpen, ownerSource: { capture: () => owner } })
  const first = paste.pasteText('independent')
  await settle()
  native.resolve()
  assert.equal((await first).ok, true)
  assert.equal(completed, keepOpen ? 0 : 1)
  assert.equal(h.state.open, true)
  scope.invalidate()
  const oldCallback = await paste.pasteText('old callback after a reopen')
  assert.equal(h.recovery.isPasteCancelled(oldCallback), true, 'retained host cannot capture a new instance generation')
}

{
  const blob = deferred()
  const h = loadPluginPaste({ windowSearch: '?window=launcher' })
  const paste = h.api.createPluginPaste(undefined, { blob: { get: () => blob.promise } }).pasteImage('old-image')
  await settle()
  h.appStore.getState().setGlobalLauncherOpen(true)
  blob.resolve(new Uint8Array([1, 2]))
  assert.equal(h.recovery.isPasteCancelled(await paste), true)
  assert.equal(h.calls.some(([kind]) => kind === 'tauri.writeImage'), false, 'late blob read cannot overwrite the clipboard')
}

{
  const native = deferred()
  let material = 1
  const h = loadPluginPaste({ windowSearch: '?window=launcher', invokeImpl: () => native.promise })
  const owner = h.recovery.captureLauncherPasteOwner({ isCurrent: () => material === 1 })
  const pending = h.api.createPluginPaste(undefined, undefined, { ownerSource: { capture: () => owner } }).pasteText('old material')
  await settle()
  material++
  h.recovery.checkPendingPasteRecovery()
  assert.ok(h.ownershipCalls.some(([command]) => command === 'cancel_paste_attempt'), 'material publisher revokes native recovery synchronously')
  native.reject(new Error('late delivery failure'))
  assert.equal(h.recovery.isPasteCancelled(await pending), true)
}

{
  const h = loadPluginPaste({ windowSearch: '?window=launcher', invokeImpl: async () => { throw new Error('HIVEN_PASTE_ATTEMPT_CANCELLED: another window opened') } })
  const cancelled = await h.api.createPluginPaste().pasteText('cross-window')
  assert.equal(h.recovery.isPasteCancelled(cancelled), true, 'native cancellation is silent even before JS observes the other window')
  assert.equal(h.telemetry.at(-1)[1].reason, 'native-cancelled')
  assert.equal(h.state.open, true)
}

console.log('Paste recovery passed: real store/session ownership, four async boundaries, independent scope, image read, native cancellation and copied retention')

// Execute the actual renderer's host factory, without rendering or testing UI.
// Its fixed instance owner must survive async callbacks only in that instance.
const rendererSource = readFileSync('src/components/pluginSurface/PluginSurfaceRenderer.tsx', 'utf8')
const rendererAst = ts.createSourceFile('PluginSurfaceRenderer.tsx', rendererSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const hostDeclarations = new Map()
const pasteFactories = []
function visitRenderer(node) {
  if (ts.isVariableDeclaration(node) && ['lifetime', 'isCurrentSurface', 'surfaceOwner', 'launcherPasteOwner', 'pasteOwner'].includes(node.name.getText(rendererAst))) {
    hostDeclarations.set(node.name.getText(rendererAst), `const ${node.getText(rendererAst)};`)
  }
  if (ts.isCallExpression(node) && node.expression.getText(rendererAst) === 'createPluginPaste') pasteFactories.push(node.getText(rendererAst))
  ts.forEachChild(node, visitRenderer)
}
visitRenderer(rendererAst)
const hostFactorySource = ts.transpileModule(`exports.build = () => { ${[...hostDeclarations.values()].join('\n')} return { paste: ${pasteFactories.at(-1)}, isCurrentSurface }; }`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
}).outputText
{
  const native = deferred()
  const h = loadPluginPaste({ invokeImpl: () => native.promise })
  const target = { pluginId: 'clipboard-history', source: 'builtin' }, surfaceState = { permissions: undefined }
  const hiddenRef = { current: false }, lifetime = { active: true }
  const scope = h.recovery.createPasteRecoveryScope()
  const context = {
    exports: {}, target, surfaceState, hiddenRef, pasteScope: scope,
    mountedRef: { current: true }, activeTargetRef: { current: target }, activeStateRef: { current: surfaceState },
    presentation: 'plugin-surface-window', pluginRegistry: { getPluginLifetime: () => lifetime }, hostStorage: undefined,
    createPluginPaste: h.api.createPluginPaste, ...h.recovery,
  }
  vm.runInNewContext(hostFactorySource, context)
  const oldHost = context.exports.build()
  const pending = oldHost.paste.pasteText('original selection')
  await settle()
  scope.invalidate()
  hiddenRef.current = true
  hiddenRef.current = false
  const newHost = context.exports.build()
  assert.equal(oldHost.isCurrentSurface(), true, 'paste invalidation does not break the existing object-handoff lifecycle')
  native.reject(new Error('late failure after independent hide/reopen'))
  assert.equal(h.recovery.isPasteCancelled(await pending), true)
  assert.equal(h.recovery.isPasteCancelled(await oldHost.paste.pasteText('old retained callback')), true)
  // The new host can capture its own generation; the fake native still fails.
  const current = await newHost.paste.pasteText('new instance draft')
  assert.equal(current.fallback, 'copied')
  assert.equal(h.recovery.isPasteCancelled(current), false)
  lifetime.active = false
  assert.equal(h.recovery.isPasteCancelled(await newHost.paste.pasteText('disabled plugin')), true)
}
console.log('Renderer owner passed: actual host factory rejects retained callbacks after reopen and plugin removal')

{
  const h = loadPluginPaste({ windowSearch: '?window=launcher' })
  const owner = h.recovery.captureLauncherPasteOwner({ complete: false })
  const result = await h.api.createPluginPaste(undefined, undefined, { ownerSource: { capture: () => owner } }).pasteText('controller output')
  assert.equal(result.ok, true)
  assert.equal(h.state.open, true, 'caller-managed success remains current until output bookkeeping completes')
  assert.equal(owner.isCurrent(), true)
  h.appStore.getState().setGlobalLauncherOpen(false)
  assert.equal(owner.isCurrent(), false, 'caller can close after success without exempting normal session reset')
}
console.log('Caller-managed completion passed: native success keeps the session current until the controller consumes it')

// beforeOpen may retain its host through asynchronous plugin preparation. Its
// factory also owns the original instance, including an independent reopen.
const preparationNames = ['preparationScope', 'launcherOwner', 'preparationOwner']
const preparationDeclarations = new Map()
function visitPreparation(node) {
  if (ts.isVariableDeclaration(node) && preparationNames.includes(node.name.getText(rendererAst))) {
    preparationDeclarations.set(node.name.getText(rendererAst), `const ${node.getText(rendererAst)};`)
  }
  ts.forEachChild(node, visitPreparation)
}
visitPreparation(rendererAst)
const preparationFactorySource = ts.transpileModule(`exports.build = () => { ${[...preparationDeclarations.values()].join('\n')} return { paste: ${pasteFactories[0]}, scope: preparationScope }; }`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
}).outputText
for (const presentation of ['global-launcher', 'plugin-surface-window']) {
  const h = loadPluginPaste()
  const target = {}, mountedRef = { current: true }, activeTargetRef = { current: target }
  const context = {
    exports: {}, target, mountedRef, activeTargetRef, presentation, disposed: false,
    permissions: undefined, storage: undefined, createPluginPaste: h.api.createPluginPaste, ...h.recovery,
  }
  vm.runInNewContext(preparationFactorySource, context)
  const original = context.exports.build()
  if (presentation === 'global-launcher') h.appStore.getState().setGlobalLauncherOpen(true)
  else original.scope.invalidate()
  const result = await original.paste.pasteText('late beforeOpen callback')
  assert.equal(h.recovery.isPasteCancelled(result), true)
  assert.equal(h.ownershipCalls.length, 0, 'stale preparation cannot register a new native owner')
}
console.log('Preparation owner passed: beforeOpen cannot acquire a replacement launcher or independent window')

// Keep output bookkeeping ahead of the synchronous launcher close/reset.
{
const { createServer } = await import('vite')
const values = new Map()
const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
globalThis.window = { localStorage: storage, sessionStorage: storage, addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) }
globalThis.localStorage = storage
globalThis.sessionStorage = storage
const info = console.info
console.info = (...args) => { if (args[0] !== '[hiven:launcher-perf]') info(...args) }
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
try {
  const { LauncherController } = await server.ssrLoadModule('/src/workspace/launcher/controller.ts')
  const { textResult } = await server.ssrLoadModule('/src/workspace/launcher/output.ts')
  const { getLastSaveableRun, setLastSaveableRun } = await server.ssrLoadModule('/src/workspace/savedActions/lastSaveableRun.ts')
  for (const scenario of ['early-close-control', 'caller-completes-success', 'copied-keeps-result']) {
    const h = loadPluginPaste({ windowSearch: '?window=launcher', invokeImpl: async () => { if (scenario === 'copied-keeps-result') throw new Error('native insertion failed') } })
    const seed = { status: 'ready', runId: 'prior-run', actionKey: 'host:review:prior', inputBinding: 'prompt', outputIntent: 'copy', savedParams: {}, contractFingerprint: 'v1:prior', actionPolicy: { effect: 'pure', learnable: true }, completedAt: Date.now() }
    setLastSaveableRun(seed)
    let closed = 0
    let resets = 0
    const events = []
    const controller = new LauncherController({
      surfaceId: 'global-launcher', api: {}, locale: 'en', makeT: () => key => key, getSettings: () => ({}), recordSelection() {},
      onChange() { h.recovery.checkPendingPasteRecovery() },
      requestClose() { closed++; h.appStore.getState().setGlobalLauncherOpen(false) },
      appendExperienceEvent: event => events.push(event),
      makeApi(_item, isPasteCurrent) {
        const owner = h.recovery.captureLauncherPasteOwner({ isCurrent: isPasteCurrent, complete: scenario === 'early-close-control' })
        return h.launcherModule.createPluginLauncherApi({ pasteOwnerSource: { capture: () => owner } })
      },
    })
    // The same synchronous invalidation used by GlobalLauncherHost on external close.
    const stop = h.appStore.subscribe((next, previous) => {
      if (previous.globalLauncherOpen && !next.globalLauncherOpen) { resets++; controller.reset() }
    })
    const item = {
      systemKey: `host:review:${scenario}`, kind: 'host', display: { title: 'Paste integration' }, behavior: { type: 'perform' },
      actionPolicy: { effect: 'pure', learnable: true }, contractFingerprint: 'v1:paste-review',
      execute: context => {
        const result = textResult('keep complete draft\nsecond line', context.api, 'en')
        result.output.choices.push({ id: 'other', title: 'Other', primaryAction: async () => {} })
        return result
      },
    }
    await controller.selectItem(item, { objectBlockText: 'source material' })
    const frame = controller.getState().frames.at(-1)
    assert.equal(frame.kind, 'result')
    await controller.activateSecondary(frame.output.choices[0], 'paste-to-foreground-app')
    // Allow the controller's queued mining fingerprint/event chain to settle.
    for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 5))
    const last = await getLastSaveableRun()
    const applied = events.filter(event => event.eventType === 'output.applied')
    if (scenario === 'early-close-control') {
      assert.equal(closed, 0)
      assert.equal(resets, 1)
      assert.equal(last.actionKey, seed.actionKey)
      assert.equal(applied.length, 1)
    } else if (scenario === 'caller-completes-success') {
      assert.equal(closed, 1)
      assert.equal(resets, 1)
      assert.equal(h.state.open, false)
      assert.equal(last.actionKey, item.systemKey)
      assert.equal(last.outputIntent, 'paste-to-foreground-app')
      assert.equal(applied.length, 1)
    } else {
      assert.equal(closed, 0)
      assert.equal(resets, 0)
      assert.equal(h.state.open, true)
      assert.equal(controller.getState().frames.at(-1), frame)
      assert.match(controller.getState().error, /Copied/)
      assert.equal(last.actionKey, seed.actionKey)
      assert.equal(applied.length, 0)
    }
    stop()
    console.log(`PASS integrated actual store/recovery/paste/pluginApi/controller: ${scenario}`)
  }
} finally {
  await server.close()
  console.info = info
}

}

// Telemetry is a fixed vocabulary of lifecycle state, with no delivery data.
for (const reason of ['explicit-leave', 'replaced-attempt', 'unexpected-blur']) {
  const native = deferred()
  const h = loadPluginPaste({ windowSearch: '?window=launcher', invokeImpl: () => native.promise })
  const owner = h.recovery.captureLauncherPasteOwner({ complete: false })
  const pending = h.api.createPluginPaste(undefined, undefined, { ownerSource: { capture: () => owner } }).pasteText('PRIVATE_BODY https://private.invalid/PRIVATE_URL')
  await settle()
  let replacement
  if (reason === 'explicit-leave') h.recovery.cancelPendingPasteRecovery()
  if (reason === 'replaced-attempt') replacement = h.recovery.createPasteRecoveryAttempt(owner, false)
  if (reason === 'unexpected-blur') {
    h.recovery.observePasteRecoveryFocus(false)
    h.recovery.observePasteRecoveryFocus(true)
    h.recovery.observePasteRecoveryFocus(false)
  }
  native.resolve()
  assert.equal(h.recovery.isPasteCancelled(await pending), true)
  const cancelled = h.telemetry.filter(([event]) => event === 'behavior:paste.recovery.cancel')
  const terminal = h.telemetry.filter(([event]) => event === 'behavior:paste.result')
  assert.equal(cancelled.length, 1)
  assert.equal(cancelled[0][1].reason, reason)
  assert.equal(terminal.length, 1)
  assert.equal(terminal[0][1].status, 'cancelled')
  assert.equal(terminal[0][1].reason, reason)
  for (const [event, details] of h.telemetry) {
    const keys = Object.keys(details)
    const allowed = event === 'behavior:paste.result'
      ? ['status', 'reason', 'owned', 'keepOpen', 'current', 'hiding', 'expectedBlur']
      : event === 'behavior:paste.recovery.focus'
        ? ['focused', 'hiding', 'expectedBlur', 'current']
        : ['reason', 'hiding', 'expectedBlur', 'current']
    assert.deepEqual(keys.sort(), allowed.sort(), 'events expose only the approved fixed fields')
    for (const key of keys.filter(key => key !== 'status' && key !== 'reason')) assert.equal(typeof details[key], 'boolean')
  }
  assert.doesNotMatch(JSON.stringify(h.telemetry), /PRIVATE_BODY|PRIVATE_URL|private\.invalid|paste-1/)
  replacement?.cancel()
}
{
  const h = loadPluginPaste({ availability: 'unsupported', windowSearch: '?window=launcher' })
  assert.equal((await h.api.createPluginPaste().pasteText('not copied')).fallback, 'none')
  const terminal = h.telemetry.filter(([event]) => event === 'behavior:paste.result')
  assert.equal(terminal.length, 1)
  assert.equal(terminal[0][1].status, 'none')
}
console.log('Paste telemetry passed: fixed outcomes/cancel reasons/focus booleans, one terminal signal and no content/token/target data')
