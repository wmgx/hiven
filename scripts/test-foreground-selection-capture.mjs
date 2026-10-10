#!/usr/bin/env node
/** Actual capture/runtime/adapter modules, synthetic IPC only; no desktop or clipboard I/O. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function load(path, dependencies = {}, globals = {}) {
  const exports = {}
  // The bridge has Vite's build-time DEV flag; its runtime guard stays unmodified.
  const source = readFileSync(path, 'utf8').replaceAll('import.meta.env.DEV', 'false')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(compiled, {
    exports, module: { exports }, Error, Promise, setTimeout, clearTimeout,
    console: { warn() {} }, crypto: { randomUUID: () => 'synthetic' },
    ...globals,
    require(id) {
      assert.ok(Object.hasOwn(dependencies, id), `Unexpected import ${id} from ${path}`)
      return dependencies[id]
    },
  }, { filename: path })
  return exports
}

const i18n = load('src/i18n/registry.ts')
i18n.registerMessages('workspace', load('src/i18n/locales/workspace.ts').default)
i18n.registerMessages('palette', load('src/i18n/locales/palette.ts').default)
i18n.t = (locale, key) => {
  const dot = key.indexOf('.')
  return i18n.translate(locale, key.slice(0, dot), key.slice(dot + 1))
}

function harness({ runtime = 'native', availability = 'can-attempt', capture = '  selected text\r\n', timers = {} } = {}) {
  const window = runtime === 'ssr' ? undefined : runtime === 'browser' ? {} : {
    __TAURI_INTERNALS__: {}, __HIVEN_WEB_NATIVE_BRIDGE__: runtime === 'relay',
  }
  const calls = [], messages = []
  const globals = { window, ...timers }
  const bridge = load('src/workspace/webNativeBridge.ts', {}, globals)
  const captureApi = load('src/workspace/launcher/foregroundSelectionCapture.ts', {
    '../../i18n': i18n,
    '../webNativeBridge': bridge,
    '@tauri-apps/api/core': {
      async invoke(command, args) {
        calls.push([command, args])
        if (command === 'get_selection_capture_availability') return typeof availability === 'function' ? availability() : availability
        if (command === 'hide_launcher_and_capture_selection') return typeof capture === 'function' ? capture() : capture
        assert.equal(command, 'show_launcher_window', 'No copy/paste/clipboard commands are allowed')
        assert.equal(args.resume, true)
      },
    },
  }, globals)
  const api = {
    getSelectionText: () => '', getActiveText: () => '',
    getClipboardText() { assert.fail('No clipboard fallback') },
    showMessage: (text, tone) => messages.push({ text, tone }),
  }
  return { calls, messages, api, captureApi, run: (locale = 'en', options) => captureApi.captureForegroundSelectionText(api, locale, options) }
}

for (const locale of ['en', 'zh']) {
  for (const options of [{}, { restoreLauncher: true }]) {
    const h = harness({ availability: 'unsupported' })
    assert.equal(await h.run(locale, options), undefined)
    assert.deepEqual(h.calls.map(([command]) => command), ['get_selection_capture_availability'], 'Linux never hides, captures, reads, or restores')
    assert.deepEqual(h.messages, [{ text: i18n.t(locale, 'workspace.captureSelection.unsupported'), tone: 'warning' }])
  }
  const note = i18n.t(locale, 'palette.captureSelectionUnavailable')
  assert.ok(note && !note.includes('captureSelectionUnavailable'), 'Footer manual-paste note exists in both locales')
}

for (const runtime of ['browser', 'relay', 'ssr']) {
  const h = harness({ runtime })
  assert.equal(await h.captureApi.readSelectionCaptureAvailability(), 'unsupported')
  assert.equal(await h.run(), undefined)
  assert.deepEqual(h.calls, [], `${runtime} must not query or execute against a desktop transport`)
}

for (const availability of [null, true, 'linux', 'unknown', () => { throw new Error('missing native command') }]) {
  const h = harness({ availability })
  assert.equal(await h.run(), undefined)
  assert.deepEqual(h.calls.map(([command]) => command), ['get_selection_capture_availability'])
  assert.equal(h.messages[0].text, i18n.t('en', 'workspace.captureSelection.unavailable'))
}

{
  let expire, resolveCapability
  let cleared = false
  const h = harness({
    availability: () => new Promise((resolve) => { resolveCapability = resolve }),
    timers: {
      setTimeout: (callback, delay) => { assert.equal(delay, 300); expire = callback; return 1 },
      clearTimeout: (id) => { assert.equal(id, 1); cleared = true },
    },
  })
  const pending = h.run()
  await Promise.resolve()
  expire()
  assert.equal(await pending, undefined)
  assert.equal(cleared, true)
  resolveCapability('can-attempt')
  await Promise.resolve()
  assert.deepEqual(h.calls.map(([command]) => command), ['get_selection_capture_availability'], 'Late preflight support never starts a timed-out capture')
}

for (const restoreLauncher of [false, true]) {
  const h = harness()
  assert.equal(await h.run('en', { restoreLauncher }), 'selected text', 'Mac/Win capture retains the existing trim contract')
  assert.deepEqual(h.calls.map(([command]) => command), [
    'get_selection_capture_availability', 'hide_launcher_and_capture_selection',
    ...(restoreLauncher ? ['show_launcher_window'] : []),
  ])
  assert.deepEqual(h.messages, [])
}

for (const capture of [null, '', ' \r\n ']) {
  const h = harness({ capture })
  assert.equal(await h.run(), undefined)
  assert.equal(h.calls.at(-1)[0], 'show_launcher_window', 'Empty supported capture still restores silently')
  assert.deepEqual(h.messages, [])
}

for (const [error, key, restore] of [
  ['SELECTION_CAPTURE_UNSUPPORTED', 'unsupported', false],
  [new Error('SELECTION_CAPTURE_UNSUPPORTED'), 'unsupported', false],
  [new Error('Accessibility permission not granted'), 'accessibilityRequired', true],
  ['native capture failed', 'failed', true],
]) {
  for (const restoreLauncher of [false, true]) {
    const h = harness({ capture: () => { throw error } })
    assert.equal(await h.run('en', { restoreLauncher }), undefined)
    assert.equal(h.calls.some(([command]) => command === 'show_launcher_window'), restore, 'Only the stable pre-hide rejection skips restoration')
    assert.equal(h.messages[0].text, i18n.t('en', `workspace.captureSelection.${key}`))
  }
}

function adapter(h, run) {
  const types = load('src/workspace/launcher/types.ts')
  const { adaptToolToLauncherItem } = load('src/workspace/launcher/toolAdapter.ts', {
    './types': types, './output': {}, './normalizeContribution': { toDirectAnswer: () => undefined },
    './contractFingerprint': { computeContractFingerprint: () => 'synthetic' },
    './toolContract': { assertLearnableToolSaveableContract() {} },
    './foregroundSelectionCapture': h.captureApi, '../../i18n': i18n,
    '../pluginPermissions': { getPluginPermissionSnapshot: () => ({}) },
    '../pluginShell': { createPluginShell: () => ({}) },
    '../pluginRegistry': { pluginRegistry: { getPluginPermissions: () => [], getPluginLifetime: () => undefined } },
    '../bundledPluginIdentity': { resolveBundledTextPreviewRunner: () => undefined },
  })
  return adaptToolToLauncherItem({
    id: 'synthetic', title: 'Synthetic', inputPolicy: { mode: 'selection' }, run,
  }, { pluginId: 'synthetic', source: 'dev', systemKey: 'synthetic' })
}

{
  const h = harness({ availability: 'unsupported' })
  const inputs = []
  const item = adapter(h, ({ input }) => { inputs.push(input); return { ok: true } })
  const ctx = { api: h.api, locale: 'en', surfaceId: 'global-launcher', settings: {} }
  await item.execute(ctx)
  assert.deepEqual(h.calls.map(([command]) => command), ['get_selection_capture_availability'], 'Real toolAdapter direct fallback shares the no-hide guard')
  assert.equal(h.messages[0].text, i18n.t('en', 'workspace.captureSelection.unsupported'))
  assert.equal(inputs[0].source, 'empty')
  h.calls.length = 0
  h.messages.length = 0
  await item.execute({ ...ctx, input: { text: '  manual text\r\n' } })
  assert.equal(inputs[1].text, '  manual text\r\n', 'Manual input remains untouched and bypasses capture')
  assert.deepEqual(h.calls, [])
  assert.deepEqual(h.messages, [])
}

// Native build is intentionally not run here. These source contracts make the
// non-Mac/Win branch exclusive and incapable of calling any side-effect helper.
const native = readFileSync('src-tauri/src/lib.rs', 'utf8')
const captureCommand = native.slice(native.indexOf('async fn hide_launcher_and_capture_selection('), native.indexOf('\n#[cfg(target_os = "macos")]\nfn wait_for_foreground_handoff_then_capture'))
const body = captureCommand.slice(captureCommand.indexOf(') -> Result<Option<String>, String> {') + ') -> Result<Option<String>, String> {'.length).replace(/\/\/[^\n]*/g, '').trim()
const branches = body.match(/^#\[cfg\(not\(any\(target_os = "macos", target_os = "windows"\)\)\)\]\s*\{([^{}]*)\}\s*#\[cfg\(any\(target_os = "macos", target_os = "windows"\)\)\]\s*\{([\s\S]*)\}\s*\}$/)
assert.ok(branches, 'Native capture must have only mutually exclusive unsupported and Mac/Win branches')
assert.equal(branches[1].replace(/\s+/g, ' ').trim(), 'let _ = (window, app); Err("SELECTION_CAPTURE_UNSUPPORTED".to_string())', 'Unsupported branch cannot invalidate recovery, hide, read clipboard, or invoke copy')
assert.match(branches[2], /^\s*paste_recovery::invalidate_all\(\);\s*let \(target_pid, target_is_self\) =\s*hide_window_and_resolve_foreground_target\(window, app.clone\(\), false, None\)\?;/)
assert.match(branches[2], /spawn_blocking\(move \|\| \{\s*wait_for_foreground_handoff_then_capture\(app, target_pid, target_is_self\)/)
assert.match(native, /fn get_selection_capture_availability\(\) -> &'static str \{\s*if cfg!\(any\(target_os = "macos", target_os = "windows"\)\) \{\s*"can-attempt"\s*\} else \{\s*"unsupported"\s*\}\s*\}/, 'Read-only preflight matches actual capture platforms')
assert.match(native, /generate_handler!\[[\s\S]*get_selection_capture_availability,/, 'Native capability must be registered')

console.log('foreground selection capture passed: fail-closed capability, no-hide unsupported, direct adapter fallback, supported restore/trim, native cfg contract')
