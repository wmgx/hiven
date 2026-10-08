#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

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
    console, URLSearchParams, setTimeout, clearTimeout,
    ...globals,
    require: (specifier) => {
      if (Object.hasOwn(imports, specifier)) return imports[specifier]
      throw new Error(`Unexpected import in ${path}: ${specifier}`)
    },
  }
  vm.runInNewContext(out, sandbox, { filename: path })
  return sandbox.module.exports
}

const workspaceMessages = loadModule('src/i18n/locales/workspace.ts').default
const i18n = loadModule('src/i18n/registry.ts')
i18n.registerMessages('workspace', workspaceMessages)
i18n.registerMessages('palette', loadModule('src/i18n/locales/palette.ts').default)
i18n.t = (locale, dottedKey) => {
  const dot = dottedKey.indexOf('.')
  return i18n.translate(locale, dottedKey.slice(0, dot), dottedKey.slice(dot + 1))
}

function loadPluginPaste({
  invokeImpl, writeTextImpl, writeImageImpl, navigatorClipboard,
  windowSearch, locale = 'en', availability = 'can-attempt', availabilityImpl,
  timers = {},
} = {}) {
  const calls = []
  const availabilityCalls = []
  const state = { open: true }
  const core = {
    invoke: async (command, args) => {
      if (command === 'get_paste_availability') {
        availabilityCalls.push(command)
        return availabilityImpl ? await availabilityImpl() : availability
      }
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
  const api = loadModule('src/workspace/pluginPaste.ts', {
    './pluginPermissions': permissionApi,
    './pluginClipboard': clipboardApi,
    '../i18n': i18n,
    '../store': { useAppStore: { getState: () => ({ locale, setGlobalLauncherOpen: (open) => { state.open = open; calls.push(['setOpen', open]) } }) } },
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
  return { api, calls, availabilityApi, availabilityCalls, state, launcherModule, router, output }
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
    ['setOpen', false],
    ['invoke', 'hide_launcher_and_paste'],
  ], 'pasteText must write clipboard then invoke the combined hide-and-paste command exactly once')
  assert.deepEqual(plain(invoked), [['hide_launcher_and_paste', { keepOpen: false }]])
  assert.ok(
    !calls.some((call) => call[0] === 'delay'),
    'pasteText must not rely on any JS-side delay; a hidden WKWebView throttles timers, so the hide+paste sequence must run entirely inside the Rust command',
  )
  await api.createPluginPaste(undefined, undefined, { keepOpen: true }).pasteText('standalone output')
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
    ['tauri.writeText', 'legacy host'], ['setOpen', false], ['invoke', 'hide_launcher_and_paste'],
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
      assert.equal(h.state.open, false, 'a genuine native attempt preserves existing session-close behavior')
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
      const result = await run()
      if (entry === 'workflow') assert.equal(result.ok, true, 'copied fallback retains the existing workflow completion contract')
      assert.equal(h.calls.filter(([kind]) => kind === 'invoke').length, 1)
      assert.equal(h.state.open, false)
    } else {
      const key = availability === 'unsupported' ? 'paste.unsupported' : 'paste.permissionRequired'
      await assert.rejects(run(), (error) => error.message === workspaceMessages.en[key])
      assert.deepEqual(h.calls, [], `${entry}: blocked output must not reach clipboard or native hide`)
      assert.equal(h.state.open, true)
    }
  }
}

console.log('plugin paste behavior checks passed (real availability, paste, launcher/output adapters; fake I/O)')
