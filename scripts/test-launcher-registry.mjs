#!/usr/bin/env node
/** Launcher registry static contract. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'

const registry = readFileSync('src/workspace/launcher/registry.ts', 'utf8')
const normalize = readFileSync('src/workspace/launcher/normalizeContribution.ts', 'utf8')
assert.match(registry, /export function|register|listLauncher|getLauncher/i, 'registry API')
assert.match(registry, /normalizeContribution|tool|plugin/i, 'normalizes contributions')
assert.match(normalize, /normalizeContribution|export function/, 'normalize contribution module')

const item = (id) => ({ id, display: { title: id }, execute: () => ({ ok: true }) })
const storage = { getItem: () => null, setItem() {}, removeItem() {} }
globalThis.window = {
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  localStorage: storage, sessionStorage: storage,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
}
globalThis.localStorage = storage
globalThis.sessionStorage = storage

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const slowPluginId = 'test-launcher-registry-slow'
const fastPluginId = 'test-launcher-registry-fast'
let pluginRegistry
let releaseSlow
let fastCalled = false
try {
  const registryApi = await vite.ssrLoadModule('/src/workspace/launcher/registry.ts')
  ;({ pluginRegistry } = await vite.ssrLoadModule('/src/workspace/pluginRegistry.ts'))
  pluginRegistry.registerProductionPlugin(slowPluginId, [], [], [], [], {
    launcher: { dynamicItems: () => new Promise((resolve) => { releaseSlow = resolve }) },
  })
  pluginRegistry.registerProductionPlugin(fastPluginId, [], [], [], [], {
    launcher: { dynamicItems: () => { fastCalled = true; return [item('fast')] } },
  })

  const partials = new Map()
  const pending = registryApi.collectDynamicItems('query', 'global-launcher', 'en', () => ({}), undefined, {
    includeHost: false,
    onPartial(update) { if (update.kind === 'plugin') partials.set(update.pluginId, update.items) },
  })
  assert.equal(fastCalled, false, 'provider invocation must be deferred past the caller stack')
  await Promise.resolve()
  assert.equal(fastCalled, true, 'provider should run in a microtask')
  releaseSlow([
    item('kept'), item('kept'), item('bad id'),
    ...Array.from({ length: 30 }, (_, index) => item(`row-${index}`)),
  ])
  const dynamicItems = await pending
  const slowItems = dynamicItems.filter((entry) => entry.pluginId === slowPluginId)
  assert.ok(slowItems.length <= 20, 'one provider must not exceed its item cap')
  assert.equal(slowItems.filter((entry) => entry.systemKey.endsWith(':kept')).length, 1, 'systemKey must be unique')
  assert.equal(slowItems.some((entry) => entry.systemKey.includes('bad id')), false, 'invalid ids must be rejected')
  assert.deepEqual([...partials.keys()], [slowPluginId, fastPluginId], 'partial order must follow registration')
} finally {
  pluginRegistry?.unregisterProductionPlugin(slowPluginId)
  pluginRegistry?.unregisterProductionPlugin(fastPluginId)
  await vite.close()
}
console.log('launcher registry (static) checks passed')
