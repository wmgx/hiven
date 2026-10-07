#!/usr/bin/env node
// Real bundled loader, registry, legacy update entry and installed update check.
// Only the native boundary and browser storage are controlled; no network or UI.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createServer } from 'vite'

const values = new Map(), calls = []
const storage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: key => values.delete(key),
}
const root = '/controlled/hiven/plugins/builtin'
const manifest = JSON.parse(fs.readFileSync('src/plugins/json-tools/manifest.json', 'utf8'))
const staleManifest = { ...manifest, version: '99.0.0', permissions: ['shell.exec'] }
const disk = new Map([[`${root}/json-tools/manifest.json`, JSON.stringify(staleManifest)]])
const originalDisk = [...disk]
const native = { async invoke(command, args) {
  calls.push({ command, ...args })
  if (command === 'read_plugin_file' && disk.has(args.path)) return disk.get(args.path)
  if (command === 'list_plugin_dirs' && args.path === root) return [staleManifest]
  if (command === 'fetch_url' && args.url.startsWith('https://raw.githubusercontent.com/controlled/plugin/')) {
    return JSON.stringify({ pluginId: 'external-fixture', version: '2.0.0' })
  }
  throw new Error(`Unexpected native command ${command}`)
} }
globalThis.localStorage = globalThis.sessionStorage = storage
globalThis.window = {
  localStorage: storage, sessionStorage: storage, __TAURI_INTERNALS__: native,
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
}
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
try {
  const loader = await vite.ssrLoadModule('/src/workspace/bundledPluginLoader.ts')
  const { pluginRegistry } = await vite.ssrLoadModule('/src/workspace/pluginRegistry.ts')
  const { makePluginT } = await vite.ssrLoadModule('/src/i18n/pluginI18nRegistry.ts')
  const { checkBuiltinPluginsUpdate } = await vite.ssrLoadModule('/src/configInit.ts')
  loader.registerBundledPluginPackages()
  const definition = pluginRegistry.getPluginDefinition('json-tools', 'production')
  const tool = definition.tools.find(candidate => candidate.id === 'json.prettify')
  const context = { input: { text: '{"a":1}' }, params: {}, locale: 'en', t: makePluginT('json-tools', 'en') }
  const before = await tool.explicitTextPreview.run(context)
  assert.equal(before.ok, true)

  for (const isNative of [true, false]) {
    window.__TAURI_INTERNALS__ = isNative ? native : undefined
    const results = await Promise.all([checkBuiltinPluginsUpdate(), checkBuiltinPluginsUpdate()])
    for (const result of results) assert.deepEqual(result, { status: 'application-managed', updated: false })
  }
  assert.equal(calls.length, 0, 'legacy checks must perform no native reads, downloads, replacements or writes')
  assert.deepEqual([...disk], originalDisk, 'even stale released sources must remain untouched by an update check')
  assert.equal(pluginRegistry.getPluginDefinition('json-tools', 'production'), definition)
  assert.deepEqual(await tool.explicitTextPreview.run(context), before)
  console.log('PASS legacy native/browser checks report application-managed without IO or changing running code')

  const summaries = loader.listBundledPluginPackageSummaries(root)
  const json = summaries.find(pkg => pkg.pluginId === manifest.pluginId)
  assert.equal(json.version, manifest.version)
  assert.notEqual(json.version, staleManifest.version)
  assert.deepEqual(json.permissions, manifest.permissions)
  assert.deepEqual(json.permissions, pluginRegistry.getPluginPermissions(manifest.pluginId, 'production'))
  assert.equal(json.folderPath, `${root}/${manifest.pluginId}`)
  assert.equal(json.entry, 'index.ts', 'the summary must describe the actual compiled entry')
  const sourceSummaries = loader.listBundledPluginPackageSummaries()
  assert.deepEqual(summaries.map(({ folderPath, ...metadata }) => metadata), sourceSummaries.map(({ folderPath, ...metadata }) => metadata))
  for (const summary of summaries) {
    assert.deepEqual(summary.permissions, pluginRegistry.getPluginPermissions(summary.pluginId, 'production'))
    assert.equal(summary.folderPath, `${root}/${summary.pluginId}`)
  }
  assert.equal(calls.length, 0, 'displaying compiled metadata must not consult released manifests')
  console.log(`PASS all ${summaries.length} compiled summaries retain their runtime metadata with released paths`)

  window.__TAURI_INTERNALS__ = native
  const { usePluginStore } = await vite.ssrLoadModule('/src/workspace/pluginStore.ts')
  const { checkInstalledPluginUpdate } = await vite.ssrLoadModule('/src/workspace/pluginRuntime.ts')
  usePluginStore.getState().installPlugin({
    pluginId: 'external-fixture', displayName: 'External fixture', version: '1.0.0',
    entry: 'index.mjs', capabilities: [], permissions: [], source: 'github',
    sourceUrl: 'https://github.com/controlled/plugin', status: 'disabled', installedAt: 1, updatedAt: 1,
  })
  assert.deepEqual(await checkInstalledPluginUpdate('external-fixture'), { status: 'available', latestVersion: '2.0.0' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, 'fetch_url')
  assert.equal(usePluginStore.getState().plugins['external-fixture'].update.status, 'available')
  assert.deepEqual([...disk], originalDisk)
  console.log('PASS external GitHub plugin checks still use their own update path')
} finally {
  await vite.close()
  delete globalThis.window
  delete globalThis.localStorage
  delete globalThis.sessionStorage
}
