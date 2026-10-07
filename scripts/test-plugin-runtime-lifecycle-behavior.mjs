#!/usr/bin/env node
// Exercise the actual runtime, stores, registry and permission resolution against
// disposable ESM packages. Native calls never touch user directories or network.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'

const scratch = await mkdtemp(join(tmpdir(), 'hiven-runtime-lifecycle-'))
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const storage = new Map()
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
}
globalThis.window = { localStorage: globalThis.localStorage }
const state = globalThis.__hivenLifecycle = {
  entries: new Map(), reads: new Map(), deletions: [], stops: [], cleanups: [], clears: [],
  removeGate: null, removeError: null, cleanupError: null,
  async invoke(command, args) {
    if (command === 'get_config_dir') return scratch
    if (command === 'read_plugin_file') {
      assert.ok(resolve(args.path).startsWith(`${scratch}/`), 'read must stay in the disposable package directory')
      const gate = this.reads.get(args.path)
      if (gate) {
        gate.started.resolve()
        await gate.release.promise
        if (gate.error) throw gate.error
        if (gate.value !== undefined) return gate.value
      }
      return readFile(args.path, 'utf8')
    }
    if (command === 'remove_plugin_dir') {
      assert.equal(args.rootPath, `${scratch}/plugins/installed`)
      this.deletions.push(args)
      if (this.removeGate) { this.removeGate.started.resolve(); await this.removeGate.release.promise }
      if (this.removeError) throw this.removeError
      return
    }
    throw new Error(`Unexpected native command: ${command}`)
  },
}
const mocks = {
  './editorBridge': `export function cleanupEditorPluginContributions(value) { const s = globalThis.__hivenLifecycle; s.cleanups.push(value); if (s.cleanupError) throw s.cleanupError; return Promise.resolve() }`,
  './toast': 'export function showToast() {}',
  './pluginScaffold.ts': 'export function createPluginScaffoldFiles() { throw new Error("Unused scaffold") }',
  './pluginDebugRunner.ts': 'export function parsePluginDefinitionSource() { throw new Error("Unused dev loader") }',
  '../pluginHostSdk.ts': 'export function createPluginHostSdk() { return {} }',
  './pluginBackgroundManager.ts': 'export function stopPluginBackground(...args) { globalThis.__hivenLifecycle.stops.push(args); return Promise.resolve() }',
  './pluginStorage.ts': 'export function clearPluginPrivateStorage(...args) { globalThis.__hivenLifecycle.clears.push(["storage", ...args]) }',
  './pluginSurfaceShortcuts.ts': 'export const usePluginSurfaceShortcutStore = { getState: () => ({ clearPluginShortcuts: (...args) => globalThis.__hivenLifecycle.clears.push(["shortcuts", ...args]) }) }',
  '@tauri-apps/api/core': 'export const invoke = (...args) => globalThis.__hivenLifecycle.invoke(...args); export const convertFileSrc = (path) => new URL(`file://${path}`).href',
  '@tauri-apps/plugin-fs': 'export function watch() { throw new Error("Unexpected watch") }',
  '@tauri-apps/plugin-dialog': 'export function open() { throw new Error("Unexpected dialog") }',
}
const bundlePath = join(scratch, 'runtime.mjs')
const entryPath = join(scratch, 'entry.ts')
await writeFile(entryPath, [
  `export * from '${resolve('src/workspace/pluginRuntime.ts')}';`,
  `export { usePluginStore } from '${resolve('src/workspace/pluginStore.ts')}';`,
  `export { pluginRegistry } from '${resolve('src/workspace/pluginRegistry.ts')}';`,
  `export { usePluginPermissionStore, getPluginPermissionSnapshot } from '${resolve('src/workspace/pluginPermissions.ts')}';`,
  `export { usePluginSettingsStore } from '${resolve('src/workspace/pluginSettingsStore.ts')}';`,
  `export { resolvePluginSettingsSource } from '${resolve('src/workspace/launcher/pluginSource.ts')}';`,
  `export { getMessages } from '${resolve('src/i18n/registry.ts')}';`,
].join('\n'))
await build({
  configFile: false, logLevel: 'silent',
  plugins: [{ name: 'native-and-ui-boundaries', enforce: 'pre',
    resolveId(id) { return Object.hasOwn(mocks, id) ? `\0mock:${id}` : undefined },
    load(id) { return id.startsWith('\0mock:') ? mocks[id.slice(6)] : undefined },
  }],
  build: { outDir: scratch, emptyOutDir: false, minify: false,
    lib: { entry: entryPath, formats: ['es'], fileName: () => 'runtime.mjs' },
  },
})
let sequence = 0
async function fixture(status = 'disabled', options = {}) {
  storage.clear()
  Object.assign(state, { deletions: [], stops: [], cleanups: [], clears: [], removeGate: null, removeError: null, cleanupError: null })
  const id = `lifecycle-${++sequence}`
  const folder = join(scratch, 'plugins', 'installed', id)
  await mkdir(join(folder, 'locales'), { recursive: true })
  await writeFile(join(folder, 'manifest.json'), JSON.stringify({ pluginId: id, version: '1.0.0', permissions: ['network.request'] }))
  await writeFile(join(folder, 'index.mjs'), `const entry = globalThis.__hivenLifecycle.entries.get(${JSON.stringify(id)}); entry.calls++; entry.started.resolve(); await entry.release.promise; export default { commands: [{ id: '${id}.command', title: 'command.title' }], renderers: [{ id: '${id}.renderer', title: 'Renderer' }], panels: [{ id: '${id}.panel', title: 'Panel' }], toolbar: [{ id: '${id}.toolbar', title: 'Toolbar' }] };`)
  await writeFile(join(folder, 'locales', 'en.json'), JSON.stringify({ 'command.title': 'Localized command' }))
  await writeFile(join(folder, 'locales', 'zh.json'), JSON.stringify({ 'command.title': '本地化命令' }))
  const entry = { calls: 0, started: deferred(), release: deferred() }
  state.entries.set(id, entry)
  if (!options.blockEntry) entry.release.resolve()
  const api = await import(`${pathToFileURL(bundlePath).href}?fixture=${sequence}`)
  api.usePluginStore.getState().installPlugin({ pluginId: id, displayName: id, version: '1.0.0', entry: 'index.mjs', folderPath: folder, packagePath: folder, source: options.source ?? 'local', status, permissions: ['network.request'], capabilities: [], installedAt: 1, updatedAt: 1 })
  return { ...api, id, folder, entry, record: () => api.usePluginStore.getState().plugins[id] }
}
function blockRead(path) {
  const gate = { started: deferred(), release: deferred() }
  state.reads.set(path, gate)
  return gate
}
function absent(f) {
  assert.equal(f.pluginRegistry.getPluginDefinition(f.id, 'production'), undefined, 'no ghost definition')
  assert.deepEqual(f.pluginRegistry.getPluginPermissions(f.id, 'production'), [], 'no ghost permission declarations')
  assert.equal(f.pluginRegistry.getAllProductionCommands().length, 0)
  assert.equal(f.pluginRegistry.production.renderers.getAll().length, 0)
  assert.equal(f.pluginRegistry.production.panels.getAll().length, 0)
  assert.equal(f.pluginRegistry.production.toolbar.getAll().length, 0)
}
const tests = []
function test(name, run) { tests.push({ name, run }) }

test('cold bootstrap restores persisted enabled and loading records; registered enable is idempotent', async () => {
  for (const status of ['enabled', 'loading']) {
    const f = await fixture(status)
    await f.loadInstalledPluginsFromStore()
    assert.ok(f.pluginRegistry.getPluginDefinition(f.id, 'production'), `${status} must load into an empty registry`)
    assert.equal(f.record().status, 'enabled')
    assert.equal(f.pluginRegistry.resolveCommand(`${f.id}.command`).contribution.title, 'Localized command')
    const version = f.pluginRegistry.getVersion()
    await f.enablePlugin(f.id)
    assert.equal(f.pluginRegistry.getVersion(), version, 'repeat enable must not re-register')
  }
})

test('concurrent enables share a single activation', async () => {
  const f = await fixture('disabled', { blockEntry: true })
  const results = Promise.allSettled([f.enablePlugin(f.id), f.enablePlugin(f.id)])
  await f.entry.started.promise
  f.entry.release.resolve()
  const settled = await results
  assert.ok(settled.every((item) => item.status === 'fulfilled'), JSON.stringify(settled))
  assert.equal(f.pluginRegistry.getVersion(), 1)
  assert.equal(f.entry.calls, 1)
})

test('disable invalidates a pending import and stops its runtime immediately', async () => {
  const f = await fixture('disabled', { blockEntry: true })
  const enable = f.enablePlugin(f.id)
  await f.entry.started.promise
  f.disablePlugin(f.id)
  const immediateStatus = f.record().status
  f.entry.release.resolve()
  await enable
  assert.equal(immediateStatus, 'disabled')
  assert.equal(f.record().status, 'disabled')
  absent(f)
  assert.deepEqual(state.stops, [[f.id, 'installed']])
})

test('uninstall cancels late import, blocks re-entry and deduplicates deletion', async () => {
  const f = await fixture('disabled', { blockEntry: true })
  const enable = f.enablePlugin(f.id)
  await f.entry.started.promise
  const gate = state.removeGate = { started: deferred(), release: deferred() }
  const remove = f.uninstallPlugin(f.id)
  const again = f.uninstallPlugin(f.id)
  await gate.started.promise
  const reentry = Promise.allSettled([f.enablePlugin(f.id), f.reloadPlugin(f.id)])
  f.entry.release.resolve()
  await enable
  const attempts = await reentry
  gate.release.resolve()
  await Promise.all([remove, again])
  assert.ok(attempts.every((item) => item.status === 'rejected'), 'enable/reload must reject while deleting')
  assert.equal(state.deletions.length, 1)
  assert.equal(f.record(), undefined)
  absent(f)
  const source = f.resolvePluginSettingsSource(f.id, 'production')
  assert.equal(source, 'builtin', 'keep the existing unknown-source fallback')
  assert.equal(f.getPluginPermissionSnapshot(source, f.id, f.pluginRegistry.getPluginPermissions(f.id, 'production'))['network.request'].granted, false)
})

test('native deletion failure retains a disabled record for explicit retry', async () => {
  const f = await fixture()
  await f.enablePlugin(f.id)
  f.usePluginPermissionStore.getState().grantPermissions('installed', f.id, ['network.request'])
  f.usePluginPermissionStore.getState().grantPermissions('builtin', f.id, ['clipboard.read'])
  state.removeError = new Error('synthetic deletion failure')
  await assert.rejects(f.uninstallPlugin(f.id), /synthetic deletion failure/)
  assert.equal(f.record().status, 'disabled')
  absent(f)
  assert.equal(state.clears.length, 0, 'failed deletion preserves stored data for retry')
  state.removeError = null
  await f.uninstallPlugin(f.id)
  assert.equal(f.record(), undefined)
  assert.equal(state.deletions.length, 2)
  assert.equal(f.usePluginPermissionStore.getState().permissions.installed[f.id], undefined)
  assert.ok(f.usePluginPermissionStore.getState().permissions.builtin[f.id], 'cleanup must retain unrelated source grants')
  assert.deepEqual(state.clears, [['shortcuts', 'installed', f.id], ['storage', 'installed', f.id]])
})

test('record replacement invalidates an old import without overwriting the newer record', async () => {
  const f = await fixture('disabled', { blockEntry: true })
  const enable = f.enablePlugin(f.id)
  await f.entry.started.promise
  f.usePluginStore.getState().updatePluginMetadata(f.id, { version: '2.0.0', status: 'disabled' })
  const nextRecord = f.record()
  f.entry.release.resolve()
  await enable
  assert.equal(f.record(), nextRecord)
  absent(f)
})

for (const operation of ['enablePlugin', 'reloadPlugin']) {
  test(`${operation} ignores locale completion after disable`, async () => {
    const f = await fixture()
    const gate = blockRead(join(f.folder, 'locales', 'en.json'))
    const loading = f[operation](f.id)
    await gate.started.promise
    f.disablePlugin(f.id)
    gate.release.resolve()
    await loading
    assert.equal(f.record().status, 'disabled')
    absent(f)
    assert.equal(f.getMessages(f.id), undefined, 'stale locale load must not publish messages')
  })
}

test('reload ignores a stale manifest and does not begin import after disable', async () => {
  const f = await fixture()
  const gate = blockRead(join(f.folder, 'manifest.json'))
  const loading = f.reloadPlugin(f.id)
  await gate.started.promise
  f.disablePlugin(f.id)
  gate.release.resolve()
  await loading
  absent(f)
  assert.equal(f.record().status, 'disabled')
  assert.equal(f.entry.calls, 0)
})

test('bootstrap does not resurrect a plugin disabled while its summary was loading', async () => {
  const f = await fixture('enabled')
  const gate = blockRead(join(f.folder, 'manifest.json'))
  const loading = f.loadInstalledPluginsFromStore()
  await gate.started.promise
  f.disablePlugin(f.id)
  gate.release.resolve()
  await loading
  assert.equal(f.record().status, 'disabled')
  absent(f)
})

for (const failure of ['status', 'cleanup']) {
  test(`synchronous ${failure} failure cannot leave scheduled native deletion behind`, async () => {
    const f = await fixture()
    await f.enablePlugin(f.id)
    const update = f.usePluginStore.getState().updatePluginStatus
    if (failure === 'status') f.usePluginStore.setState({ updatePluginStatus: () => { throw new Error('synthetic status failure') } })
    else state.cleanupError = new Error('synthetic cleanup failure')
    await assert.rejects(f.uninstallPlugin(f.id), /synthetic .* failure/)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(state.deletions.length, 0, 'failed preparation must never delete later')
    assert.ok(f.record())
    absent(f)
    f.usePluginStore.setState({ updatePluginStatus: update })
    state.cleanupError = null
    await f.uninstallPlugin(f.id)
    assert.equal(state.deletions.length, 1, 'failed preparation must release the uninstall lock')
  })
}

test('unrelated metadata refresh during enable preserves activation intent', async () => {
  const f = await fixture('disabled', { blockEntry: true })
  const activation = f.enablePlugin(f.id)
  await f.entry.started.promise
  f.usePluginStore.getState().updatePluginMetadata(f.id, { displayName: 'Refreshed display name', capabilities: [...f.record().capabilities], permissions: [...f.record().permissions], update: { status: 'up-to-date' } })
  f.entry.release.resolve()
  await activation
  assert.equal(f.record().status, 'enabled', 'a metadata-only refresh must not strand the plugin in loading')
  assert.equal(f.record().displayName, 'Refreshed display name')
  assert.ok(f.pluginRegistry.getPluginDefinition(f.id, 'production'))
})

test('unrelated metadata refresh during bootstrap does not skip enabled plugin', async () => {
  const f = await fixture('enabled')
  const gate = blockRead(join(f.folder, 'manifest.json'))
  const boot = f.loadInstalledPluginsFromStore()
  await gate.started.promise
  f.usePluginStore.getState().updatePluginMetadata(f.id, { displayName: 'Refreshed display name' })
  gate.release.resolve()
  await boot
  assert.ok(f.pluginRegistry.getPluginDefinition(f.id, 'production'), 'persisted enabled intent still needs actual registration')
})

test('deletion failure while import is pending stays disabled through late completion and retries', async () => {
  const f = await fixture('disabled', { blockEntry: true })
  const activation = f.enablePlugin(f.id)
  await f.entry.started.promise
  state.removeError = new Error('synthetic disk busy')
  await assert.rejects(f.uninstallPlugin(f.id), /synthetic disk busy/)
  assert.equal(f.record().status, 'disabled')
  f.entry.release.resolve()
  await activation
  absent(f)
  assert.equal(f.record().status, 'disabled')
  assert.equal(f.getMessages(f.id), undefined)
  state.removeError = null
  await f.uninstallPlugin(f.id)
  assert.equal(f.record(), undefined)
})

test('old locale completion cannot remove or overwrite a newer enabled generation', async () => {
  const f = await fixture()
  const path = join(f.folder, 'locales', 'en.json')
  const gate = blockRead(path)
  gate.value = JSON.stringify({ 'command.title': 'STALE TITLE' })
  const old = f.enablePlugin(f.id)
  await gate.started.promise
  f.disablePlugin(f.id)
  state.reads.delete(path)
  await writeFile(path, JSON.stringify({ 'command.title': 'NEW TITLE' }))
  await f.enablePlugin(f.id)
  assert.equal(f.pluginRegistry.resolveCommand(`${f.id}.command`).contribution.title, 'NEW TITLE')
  gate.release.resolve()
  await old
  assert.equal(f.record().status, 'enabled')
  assert.equal(f.pluginRegistry.resolveCommand(`${f.id}.command`).contribution.title, 'NEW TITLE')
  assert.equal(f.getMessages(f.id).en['command.title'], 'NEW TITLE')
  assert.deepEqual(f.pluginRegistry.getPluginPermissions(f.id, 'production'), ['network.request'])
})

test('old reload manifest rejection cannot corrupt a newer enabled generation', async () => {
  const f = await fixture()
  const path = join(f.folder, 'manifest.json')
  const gate = blockRead(path)
  gate.error = new Error('old manifest unavailable')
  const old = f.reloadPlugin(f.id)
  await gate.started.promise
  state.reads.delete(path)
  await writeFile(path, JSON.stringify({ pluginId: f.id, version: '2.0.0', permissions: ['clipboard.read'] }))
  await f.reloadPlugin(f.id)
  const current = f.record()
  gate.release.resolve()
  await old
  assert.equal(f.record(), current)
  assert.equal(f.record().version, '2.0.0')
  assert.equal(f.record().status, 'enabled')
  assert.deepEqual(f.pluginRegistry.getPluginPermissions(f.id, 'production'), ['clipboard.read'])
})

test('old bootstrap rejection cannot mark a later disabled record errored', async () => {
  const f = await fixture('enabled')
  const gate = blockRead(join(f.folder, 'manifest.json'))
  gate.error = new Error('old manifest unavailable')
  const boot = f.loadInstalledPluginsFromStore()
  await gate.started.promise
  f.disablePlugin(f.id)
  gate.release.resolve()
  await boot
  assert.equal(f.record().status, 'disabled')
  assert.equal(f.record().error, undefined)
  absent(f)
})

test('reload does not register after a synchronous subscriber starts uninstall', async () => {
  const f = await fixture()
  await f.enablePlugin(f.id)
  const gate = state.removeGate = { started: deferred(), release: deferred() }
  let uninstall
  let armed = true
  const unsubscribe = f.pluginRegistry.subscribe(() => {
    if (armed) {
      armed = false
      uninstall = f.uninstallPlugin(f.id)
    }
  })
  const reloading = f.reloadPlugin(f.id)
  await gate.started.promise
  const result = await Promise.allSettled([reloading])
  assert.equal(result[0].status, 'rejected', 'reload must reject when synchronous cleanup starts uninstall')
  unsubscribe()
  const during = f.pluginRegistry.getPluginDefinition(f.id, 'production')
  gate.release.resolve()
  await uninstall
  assert.equal(during, undefined, 'new uninstall intent must block reload activation during deletion')
  absent(f)
  assert.equal(f.record(), undefined)
})

test('failed contribution validation cleans locale registration and preserves the existing owner', async () => {
  const f = await fixture()
  const command = { id: `${f.id}.command`, title: 'Existing command' }
  f.pluginRegistry.registerProductionPlugin('existing-owner', [command], [], [], [], { commands: [command] })
  await assert.rejects(f.enablePlugin(f.id), /already registered/)
  assert.equal(f.record().status, 'error')
  assert.equal(f.getMessages(f.id), undefined)
  assert.equal(f.pluginRegistry.getPluginDefinition(f.id, 'production'), undefined)
  assert.deepEqual(f.pluginRegistry.getPluginPermissions(f.id, 'production'), [])
  assert.equal(f.pluginRegistry.resolveCommand(command.id).meta.pluginId, 'existing-owner')
})

let failures = 0
try {
  for (const { name, run } of tests) {
    try { await run(); console.log(`PASS ${name}`) }
    catch (error) { failures++; console.error(`FAIL ${name}\n${error.stack}`) }
  }
} finally {
  delete globalThis.__hivenLifecycle
  delete globalThis.window
  delete globalThis.localStorage
  await rm(scratch, { recursive: true, force: true })
}
assert.equal(failures, 0, `${failures}/${tests.length} lifecycle scenarios failed`)
console.log(`plugin runtime lifecycle behavior: ${tests.length} scenarios passed`)
