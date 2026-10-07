#!/usr/bin/env node
/** Real host launch/error/controller code, with native IPC stubbed. No UI or app launches. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function load(path, dependencies = {}, globals = {}) {
  const exports = {}
  const compiled = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(compiled, {
    exports, module: { exports }, Error, Promise, setTimeout, clearTimeout, console,
    ...globals,
    require(id) {
      assert.ok(Object.hasOwn(dependencies, id), `Unexpected import ${id} from ${path}`)
      return dependencies[id]
    },
  }, { filename: path })
  return exports
}

const i18n = load('src/i18n/registry.ts')
const messages = load('src/i18n/locales/appLauncher.ts').default
i18n.registerMessages('appLauncher', messages)
let locale = 'en'
const errors = load('src/workspace/appLauncher/appLaunchError.ts', {
  '../../i18n': i18n,
  '../../store': { useAppStore: { getState: () => ({ locale }) } },
})
const appId = 'linux:desktop-entry:org.example.Synthetic.desktop'
const nativeCalls = []
let nativeLaunch = async () => {}
const native = {
  async invoke(command, payload) {
    assert.equal(command, 'launch_installed_app')
    assert.equal(payload.appId, appId)
    nativeCalls.push([command, payload.appId])
    return nativeLaunch()
  },
}
const host = load('src/workspace/appLauncher/hostAppLauncher.ts', {
  '../searchRanking': { searchableFieldsMatch: () => true },
  '../launcher/perf': { launcherPerfNow: () => 0, logLauncherPerfDuration() {} },
  './hostAppIndex': load('src/workspace/appLauncher/hostAppIndex.ts'),
  './appLaunchError': errors,
  '@tauri-apps/api/core': native,
}, {
  window: {
    __TAURI_INTERNALS__: {},
    localStorage: {
      getItem: () => JSON.stringify({
        version: 1, refreshedAt: Date.now(),
        apps: [{ appId, name: 'Synthetic', platform: 'linux', source: 'desktop-entry' }],
      }),
    },
  },
})
let id = 0
const { LauncherController } = load('src/workspace/launcher/controller.ts', {
  '../../i18n': i18n,
  '../usageJournal': { appendUsageJournal: async () => {} },
  './output': { isOutputResult: (result) => result.ok && Boolean(result.output) },
  './foregroundSelectionCapture': {},
  '../telemetry': { TelemetryEvents: {}, itemTelemetryProps: () => ({}), trackBehavior() {}, trackLatencyFrom() {}, telemetryNow: () => 0 },
  '../experience/journal': { newExperienceId: () => String(++id) },
  '../experience/errorType': load('src/workspace/experience/errorType.ts'),
  '../contentBoundary': { isSafeExperienceIdentifier: () => false },
  '../experience/saveableParams': {},
  '../experience/miningFingerprint': {},
  '../savedActions/lastSaveableRun': {},
  '../savedActions/store': {},
})
function harness() {
  const h = { closed: 0, selections: 0 }
  h.controller = new LauncherController({
    surfaceId: 'global-launcher', locale, api: { getSelectionText: () => '', getActiveText: () => '' },
    makeT: () => (key) => key, getSettings: () => ({}), onChange() {},
    requestClose: () => { h.closed++ }, recordSelection: () => { h.selections++ },
  })
  return h
}
const [item] = await host.getHostAppLauncherDynamicItems({ query: '', locale: 'en', surfaceId: 'global-launcher' })
assert.ok(item, 'real app index must produce the tested launcher item')
const codes = {
  APP_LAUNCH_UNAVAILABLE: 'unavailable', APP_LAUNCH_HELPER_MISSING: 'helperMissing',
  APP_LAUNCH_START_FAILED: 'startFailed', APP_LAUNCH_REJECTED: 'rejected',
  APP_LAUNCH_INTERRUPTED: 'interrupted', APP_LAUNCH_UNCONFIRMED: 'unconfirmed',
}

for (locale of ['en', 'zh']) {
  for (const [code, key] of Object.entries(codes)) {
    const before = nativeCalls.length
    nativeLaunch = async () => { throw code }
    const h = harness()
    await h.controller.selectItem(item)
    assert.equal(h.controller.getState().error, messages[locale][key], `${code} uses current ${locale}, even for a cached row`)
    assert.equal(h.controller.getState().busy, false)
    assert.equal(h.controller.getState().frames.at(-1).kind, 'list')
    assert.equal(h.closed, 0, 'failure/uncertainty keeps the launcher open')
    assert.equal(h.selections, 0, 'failure/uncertainty cannot record successful use')
    assert.equal(nativeCalls.length, before + 1, 'no fallback or automatic retry')
  }
}

locale = 'en'
let rejectPending
nativeLaunch = () => new Promise((_resolve, reject) => { rejectPending = reject })
const pending = harness()
const firstSelection = pending.controller.selectItem(item)
await new Promise((resolve) => setImmediate(resolve))
assert.equal(pending.controller.getState().busy, true)
const pendingCount = nativeCalls.length
await pending.controller.selectItem(item)
assert.equal(nativeCalls.length, pendingCount, 'repeat Enter while waiting cannot launch twice')
rejectPending('APP_LAUNCH_UNCONFIRMED')
await firstSelection
await new Promise((resolve) => setImmediate(resolve))
assert.equal(pending.closed, 0)
assert.equal(pending.selections, 0)
assert.equal(nativeCalls.length, pendingCount, 'an uncertain result never retries on its own')

nativeLaunch = async () => {}
const accepted = harness()
await accepted.controller.selectItem(item)
assert.equal(accepted.closed, 1, 'confirmed helper acceptance follows existing close behavior')
assert.equal(accepted.selections, 1)
assert.equal(accepted.controller.getState().error, null)

// The object workflow calls this export rather than the app-row execute function.
locale = 'zh'
nativeLaunch = async () => { throw 'APP_LAUNCH_UNCONFIRMED' }
await assert.rejects(host.launchHostAppObject(appId), { message: messages.zh.unconfirmed })

// PluginAppsApi is also a host boundary and must not leak raw native codes.
const pluginDependencies = Object.fromEntries([
  '../effectRunner', '../toast', '../launcherHostSurfaceBridge', '../pluginSurfaceOpenRequest',
  '../pluginRegistry', '../pluginStorage', '../pluginPermissions', '../editorBridge',
  '../quickEditor/quickEditorRequests', '../quickEditor/quickEditorPaneSnapshot',
  '../nativeClipboard', '../pluginPaste', '../pluginClipboard',
].map((name) => [name, {}]))
const { createPluginAppsApi } = load('src/workspace/launcher/pluginApi.ts', {
  ...pluginDependencies, '../appLauncher/appLaunchError': errors, '@tauri-apps/api/core': native,
})
await assert.rejects(createPluginAppsApi().launchApp(appId), { message: messages.zh.unconfirmed })

const existingError = new Error('existing platform-specific failure')
nativeLaunch = async () => { throw existingError }
await assert.rejects(host.launchHostAppObject(appId), (error) => error === existingError)
assert.equal(errors.appLaunchErrorMessage('toString', 'en'), undefined)
assert.equal(errors.appLaunchErrorMessage(new Error('APP_LAUNCH_REJECTED'), 'en'), messages.en.rejected)
console.log('app launch feedback: 12 localized failures, pending deduplication, no automatic retry, success, workflow and plugin host passed')
