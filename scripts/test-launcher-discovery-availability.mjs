#!/usr/bin/env node
/** Discovery availability is stricter than ordinary search; no UI is mounted. */
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const storage = { getItem: () => null, setItem() {}, removeItem() {} }
globalThis.window = {
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  localStorage: storage, sessionStorage: storage,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
}
globalThis.localStorage = storage
globalThis.sessionStorage = storage

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const pluginId = 'test-discovery-availability'
let pluginRegistry
let permissionStore
try {
  const { filterAvailableLauncherItems, filterDynamicForSurface } = await vite.ssrLoadModule('/src/workspace/launcher/registry.ts')
  ;({ pluginRegistry } = await vite.ssrLoadModule('/src/workspace/pluginRegistry.ts'))
  ;({ usePluginPermissionStore: permissionStore } = await vite.ssrLoadModule('/src/workspace/pluginPermissions.ts'))
  const surface = { id: 'main', title: 'Main', render: () => null }
  pluginRegistry.registerDevPlugin(pluginId, [], [], [], [], { ui: { surfaces: [surface] } }, ['clipboard.read'])
  const action = {
    systemKey: `plugin:${pluginId}:launcher:action`, kind: 'plugin', source: 'dev', pluginId,
    display: { title: 'Action' }, behavior: { type: 'perform' }, execute: () => ({ ok: true }),
  }
  const available = (rows, host = 'global-launcher') => filterAvailableLauncherItems(rows, host)
  assert.deepEqual(available([action]), [], 'ungranted plugins must not be discovered')
  assert.equal(filterDynamicForSurface([action], 'global-launcher').length, 1, 'ordinary search eligibility is unchanged')
  permissionStore.getState().grantPermissions('dev', pluginId, ['clipboard.read'])
  assert.deepEqual(available([action]), [action], 'granted registered action is available')
  const disabled = { ...action, disabledReason: { code: 'disabled', message: 'Disabled' } }
  assert.deepEqual(available([disabled]), [], 'disabled actions are excluded')
  assert.equal(filterDynamicForSurface([disabled], 'global-launcher').length, 1, 'ordinary disabled rows are still surfaced')
  assert.deepEqual(available([{ ...action, surfaces: ['quick-editor-command'] }]), [], 'wrong host is excluded')
  assert.deepEqual(available([{ ...action, requiredCapabilities: ['plugin-surfaces'] }], 'quick-editor-command'), [], 'missing host capability is excluded')
  const surfaceItem = { ...action, systemKey: `plugin-surface:dev:${pluginId}:main`, requiredCapabilities: ['plugin-surfaces'] }
  assert.deepEqual(available([surfaceItem]), [surfaceItem], 'valid permitted surface is included')
  for (const key of [`plugin-surface:dev:${pluginId}:missing`, `plugin-surface:dev:${pluginId}:main:extra`, `plugin-surface:builtin:${pluginId}:main`]) {
    assert.deepEqual(available([{ ...surfaceItem, systemKey: key }]), [], `invalid surface target excluded: ${key}`)
  }
  permissionStore.getState().revokePermissions('dev', pluginId, ['clipboard.read'])
  assert.deepEqual(available([action, surfaceItem]), [], 'revocation also removes previously available candidates')
  permissionStore.getState().grantPermissions('dev', pluginId, ['clipboard.read'])
  pluginRegistry.registerDevPlugin(pluginId, [], [], [], [], { ui: { surfaces: [{ ...surface, entry: { launcher: { surfaces: ['quick-editor-command'] } } }] } }, ['clipboard.read'])
  assert.deepEqual(available([surfaceItem]), [], 'current surface host declaration overrides stale candidate eligibility')
  pluginRegistry.registerDevPlugin(pluginId, [], [], [], [], { ui: { surfaces: [{ ...surface, entry: { launcher: false } }] } }, ['clipboard.read'])
  assert.deepEqual(available([surfaceItem]), [], 'surface with launcher entry disabled is excluded')
  pluginRegistry.unregisterDevPlugin(pluginId)
  assert.deepEqual(available([action, surfaceItem]), [], 'unregistered plugin cannot survive through stale candidates')
  const hostAction = { systemKey: 'host:action:available', kind: 'host', display: { title: 'Host' }, behavior: { type: 'perform' }, execute: () => ({ ok: true }) }
  assert.deepEqual(available([hostAction]), [hostAction], 'host-owned available actions remain discoverable')
  console.log('launcher discovery availability contracts passed')
} finally {
  pluginRegistry?.unregisterDevPlugin(pluginId)
  permissionStore?.getState().clearPluginPermissions('dev', pluginId)
  await vite.close()
}
