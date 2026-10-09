#!/usr/bin/env node
// Exercise the real host export transaction with deferred native dialog/write boundaries.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function load(path, imports = {}, globals = {}) {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(code, {
    module, exports: module.exports, console, ...globals,
    require(id) {
      if (Object.hasOwn(imports, id)) return imports[id]
      throw new Error(`Unexpected dependency: ${id}`)
    },
  }, { filename: path })
  return module.exports
}
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const tick = () => new Promise(setImmediate)
function fixture(source = 'builtin') {
  const deps = {
    zustand: require('zustand'),
    'zustand/middleware': { persist: config => config },
    '../utils/persistMigration': { migrateLocalStorageKey() {} },
  }
  const registry = load('src/workspace/pluginRegistry.ts', { react: { useSyncExternalStore() {} } })
  const permission = load('src/workspace/pluginPermissions.ts', deps)
  const store = load('src/workspace/pluginStore.ts', deps)
  const pluginSource = load('src/workspace/launcher/pluginSource.ts', { '../pluginStore': store })
  const window = { __TAURI_INTERNALS__: {} }
  const focus = load('src/workspace/launcherBlurGuard.ts', {}, { window })
  const id = 'export-test'
  const requested = ['storage.blob']
  const register = (definition = {}, permissions = requested) => source === 'dev'
    ? registry.pluginRegistry.registerDevPlugin(id, [], [], [], [], definition, permissions)
    : registry.pluginRegistry.registerProductionPlugin(id, [], [], [], [], definition, permissions)
  const definition = {}
  register(definition)
  if (source !== 'dev') store.usePluginStore.getState().installPlugin({ pluginId: id, source: source === 'builtin' ? 'builtin' : 'local' })
  permission.usePluginPermissionStore.getState().grantPermissions(source, id, requested)
  let epoch = 1
  let visible = true
  const prepare = deferred()
  const preparedStarted = deferred()
  const commit = deferred()
  const commitStarted = deferred()
  const calls = []
  const native = { invoke: (command, args) => {
    calls.push({ command, args })
    if (command === 'plugin_blob_prepare_png_export') { preparedStarted.resolve(); return prepare.promise }
    if (command === 'plugin_blob_commit_png_export') { commitStarted.resolve(); return commit.promise }
    if (command === 'plugin_blob_discard_png_export') return Promise.resolve()
    throw new Error(`Unexpected native call: ${command}`)
  } }
  const exports = load('src/workspace/pluginBlobExport.ts', {
    './pluginPermissions': permission,
    './pluginRegistry': registry,
    './pluginStore': store,
    './launcher/pluginSource': pluginSource,
    './launcherBlurGuard': focus,
    '@tauri-apps/api/core': native,
  }, { window })
  const save = exports.createPluginPngSaver(source, id, permission.getPluginPermissionSnapshot(source, id, requested), {
    capture() { const started = epoch; return () => visible && epoch === started },
  })
  return {
    save, calls, window, prepare, preparedStarted, commit, commitStarted, focus,
    register, definition, requested, source, id, registry, permission, store,
    interrupt() { visible = false; epoch += 1 },
    reopen() { visible = true },
    count(command) { return calls.filter(call => call.command === command).length },
  }
}

for (const source of ['builtin', 'installed', 'dev']) {
  const f = fixture(source)
  let settled = false
  const result = f.save('own-blob', { suggestedFilename: 'chosen.png', path: '/untrusted/path' }).then(value => { settled = true; return value })
  await f.preparedStarted.promise
  assert.equal(f.focus.launcherNativeDialogFocus.isActive(), true)
  assert.equal(f.count('plugin_blob_commit_png_export'), 0, 'opening a dialog must not write')
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].args)), { source, pluginId: f.id, blobId: 'own-blob', suggestedFilename: 'chosen.png' })
  f.prepare.resolve({ status: 'prepared', exportId: 42 })
  await f.commitStarted.promise
  assert.equal(settled, false, 'commit dispatch cannot report successful save')
  assert.equal(f.focus.launcherNativeDialogFocus.isActive(), true, 'focus is held through actual write')
  f.commit.resolve({ status: 'saved' })
  assert.equal((await result).status, 'saved')
  assert.equal(f.count('plugin_blob_discard_png_export'), 1)
  assert.equal(f.focus.launcherNativeDialogFocus.isActive(), false)
}

{
  const f = fixture()
  const result = f.save('own-blob')
  await f.preparedStarted.promise
  f.prepare.resolve({ status: 'cancelled' })
  assert.equal((await result).status, 'cancelled')
  assert.equal(f.count('plugin_blob_commit_png_export'), 0)
  assert.equal(f.count('plugin_blob_discard_png_export'), 0)
  assert.equal(f.focus.launcherNativeDialogFocus.isActive(), false)
}

for (const invalidate of [
  f => { f.interrupt(); f.reopen() },
  f => f.permission.usePluginPermissionStore.getState().revokePermissions(f.source, f.id, f.requested),
  f => {
    f.permission.usePluginPermissionStore.getState().revokePermissions(f.source, f.id, f.requested)
    f.permission.usePluginPermissionStore.getState().grantPermissions(f.source, f.id, f.requested)
  },
  f => f.register({ replacement: true }),
  f => { f.register(f.definition, []); f.register(f.definition, f.requested) },
  f => {
    f.store.usePluginStore.getState().updatePluginMetadata(f.id, { source: 'local' })
    f.store.usePluginStore.getState().updatePluginMetadata(f.id, { source: 'builtin' })
  },
]) {
  const f = fixture()
  const result = f.save('own-blob')
  const rejected = assert.rejects(result, /interrupted|permission|no longer active/)
  await f.preparedStarted.promise
  invalidate(f)
  f.prepare.resolve({ status: 'prepared', exportId: 43 })
  await rejected
  assert.equal(f.count('plugin_blob_commit_png_export'), 0, 'late dialog cannot authorize a write')
  assert.equal(f.count('plugin_blob_discard_png_export'), 1)
  assert.equal(f.focus.launcherNativeDialogFocus.isActive(), false)
}

for (const phase of ['prepare', 'commit']) {
  const f = fixture()
  const rejected = assert.rejects(f.save('own-blob'), /native failure/)
  await f.preparedStarted.promise
  if (phase === 'prepare') f.prepare.reject(new Error('native failure'))
  else {
    f.prepare.resolve({ status: 'prepared', exportId: 44 })
    await f.commitStarted.promise
    f.commit.reject(new Error('native failure'))
  }
  await rejected
  assert.equal(f.focus.launcherNativeDialogFocus.isActive(), false)
  assert.equal(f.count('plugin_blob_discard_png_export'), phase === 'commit' ? 1 : 0)
}

{
  const f = fixture()
  const result = f.save('own-blob')
  await f.preparedStarted.promise
  f.prepare.resolve({ status: 'prepared', exportId: 45 })
  await f.commitStarted.promise
  f.interrupt()
  f.permission.usePluginPermissionStore.getState().revokePermissions(f.source, f.id, f.requested)
  f.commit.resolve({ status: 'saved' })
  assert.equal((await result).status, 'saved', 'later revocation cannot relabel an accepted successful write')
}

for (const unavailable of [f => { delete f.window.__TAURI_INTERNALS__ }, f => { f.window.__HIVEN_WEB_NATIVE_BRIDGE__ = true }]) {
  const f = fixture()
  unavailable(f)
  await assert.rejects(f.save('own-blob'), { name: 'NotSupportedError' })
  assert.equal(f.calls.length, 0, 'browser preview cannot request a native ticket')
  assert.equal(f.focus.launcherNativeDialogFocus.isActive(), false)
}

{
  const f = fixture('installed')
  f.store.usePluginStore.getState().updatePluginMetadata(f.id, { source: 'builtin' })
  await assert.rejects(f.save('own-blob'), /no longer active/)
  assert.equal(f.calls.length, 0, 'mismatched source cannot borrow another namespace')
}

{
  const f = fixture()
  f.register({ replacement: true })
  await assert.rejects(f.save('own-blob'), /no longer active/)
  assert.equal(f.calls.length, 0, 'retained storage must belong to its original registration')
}

await tick()
console.log('plugin PNG export transaction checks passed')
