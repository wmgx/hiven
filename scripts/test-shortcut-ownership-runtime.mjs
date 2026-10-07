#!/usr/bin/env node
// Actual registrars, stores, plugin registry and translations share one native owner table.
// This checks a fresh application lifecycle, without using OS shortcuts or user data.
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'

const scratch = await mkdtemp(join(tmpdir(), 'hiven-shortcut-ownership-'))
const storage = new Map()
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
}
const routeMocks = {
  '/workspace/quickEditor/quickEditorRequests': `export const showQuickEditorSurface = async () => globalThis.__ownerNative.routes.push('quick');`,
  '/workspace/pluginSurfaceOpenRequest': `export const requestOpenPluginSurfaceTool = async (target) => globalThis.__ownerNative.routes.push('surface:' + target.pluginId);`,
  '/workspace/windowManager/pluginSurfaceWindows': `export const getPluginSurfaceShortcutPresentation = () => 'window'; export const showPluginSurfaceWindow = async (target) => globalThis.__ownerNative.routes.push('window:' + target.pluginId);`,
}
const entry = join(scratch, 'entry.ts')
await writeFile(entry, [
  ...['appHotkeys', 'quickEditor', 'pluginSurfaceShortcuts'].map((name) => `export * from '${resolve('src/hotkeys', name + '.ts')}';`),
  `export { useAppStore } from '${resolve('src/store.ts')}';`,
  `export { usePluginSurfaceShortcutStore, pluginSurfaceShortcutKey } from '${resolve('src/workspace/pluginSurfaceShortcuts.ts')}';`,
  `export { usePluginPermissionStore } from '${resolve('src/workspace/pluginPermissions.ts')}';`,
  `export { pluginRegistry } from '${resolve('src/workspace/pluginRegistry.ts')}';`,
  `export { translate } from '${resolve('src/i18n/index.ts')}';`,
].join('\n'))
const deferred = () => {
  let resolve
  const promise = new Promise((yes) => { resolve = yes })
  return { promise, resolve }
}
const tick = () => new Promise((resolve) => setImmediate(resolve))
async function until(test) {
  for (let count = 0; count < 200; count++) {
    if (test()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail('Timed out waiting for shortcut state')
}
const A = 'Ctrl+Shift+A', B = 'Ctrl+Shift+B', C = 'Ctrl+Shift+C', D = 'Ctrl+Shift+D'
const target = { source: 'dev', pluginId: 'owner-test', surfaceId: 'main' }
const binding = (accelerator, appId = 'app-a') => ({ appId, name: appId, accelerator, enabled: true })
try {
  await build({
    configFile: false, logLevel: 'silent',
    plugins: [{
      name: 'native-and-window-boundaries', enforce: 'pre',
      resolveId(id, importer) {
        if (id === '@tauri-apps/plugin-global-shortcut') {
          const owner = importer?.includes('/hotkeys/appHotkeys') ? 'app'
            : importer?.includes('/hotkeys/quickEditor') ? 'quick'
              : importer?.includes('/hotkeys/pluginSurfaceShortcuts') ? 'surface' : 'unexpected'
          return '\0shortcut:' + owner
        }
        if (id === '@tauri-apps/api/core') return '\0core'
        const resolved = importer && id.startsWith('.') ? resolve(importer, '..', id).replace(/\.(tsx?|jsx?)$/, '') : ''
        const route = Object.keys(routeMocks).find((key) => resolved.endsWith(key))
        if (route) return '\0route:' + route
      },
      load(id) {
        if (id.startsWith('\0shortcut:')) {
          const owner = JSON.stringify(id.slice(10))
          return `export const register = (...args) => globalThis.__ownerNative.register(${owner}, ...args);
            export const unregister = (...args) => globalThis.__ownerNative.unregister(${owner}, ...args);
            export const isRegistered = (...args) => globalThis.__ownerNative.isRegistered(${owner}, ...args);`
        }
        if (id === '\0core') return `export const invoke = async (command, args) => {
          if (command !== 'toggle_installed_app') throw new Error(command);
          globalThis.__ownerNative.routes.push('app:' + args.appId);
        }; export class Channel { constructor() { throw new Error('Unexpected native channel'); } }`
        if (id.startsWith('\0route:')) return routeMocks[id.slice(7)]
      },
    }],
    build: { outDir: scratch, emptyOutDir: false, minify: false,
      lib: { entry, formats: ['es'], fileName: () => 'runtime.mjs' },
    },
  })

  let fixtureId = 0
  async function fixture(requestedPermissions = []) {
    storage.clear()
    globalThis.window = Object.assign(new EventTarget(), { localStorage, __TAURI_INTERNALS__: {} })
    const native = globalThis.__ownerNative = {
      owners: new Map(), calls: [], routes: [], gate: null,
      async wait(owner, key, action) {
        if (this.gate?.owner !== owner || this.gate.key !== key || this.gate.action !== action) return
        const gate = this.gate
        this.gate = null
        gate.started.resolve()
        await gate.release.promise
      },
      async isRegistered(owner, key) {
        await this.wait(owner, key, 'check')
        return this.owners.has(key.toLowerCase())
      },
      async register(owner, key, callback) {
        this.calls.push({ action: 'register', caller: owner, key })
        await this.wait(owner, key, 'register')
        if (this.owners.has(key.toLowerCase())) throw new Error('Native shortcut already registered')
        this.owners.set(key.toLowerCase(), { owner, callback })
      },
      async unregister(owner, key) {
        this.calls.push({ action: 'unregister', caller: owner, key,
          previousOwner: this.owners.get(key.toLowerCase())?.owner ?? null })
        this.owners.delete(key.toLowerCase())
      },
    }
    const api = await import(`${pathToFileURL(join(scratch, 'runtime.mjs')).href}?fixture=${++fixtureId}`)
    api.useAppStore.getState().updateSetting('globalPinnedLauncherShortcut', { kind: 'disabled' })
    api.useAppStore.getState().updateSetting('quickEditorShortcut', { kind: 'disabled' })
    api.useAppStore.getState().updateSetting('appHotkeys', [binding(A)])
    if (requestedPermissions.length > 0) {
      api.usePluginPermissionStore.getState().grantPermissions(target.source, target.pluginId, requestedPermissions)
    }
    api.pluginRegistry.registerDevPlugin(target.pluginId, [], [], [], [], {
      id: target.pluginId, ui: { surfaces: [{ id: target.surfaceId, entry: { shortcutBindable: true } }] },
    }, requestedPermissions)
    const stops = {
      app: api.installAppHotkeys(), quick: api.installQuickEditorHotkeys(), surface: api.installPluginSurfaceShortcutHotkeys(),
    }
    const owner = (key) => native.owners.get(key.toLowerCase())
    const quick = () => api.useAppStore.getState().settings.quickEditorShortcut
    const surface = () => api.usePluginSurfaceShortcutStore.getState().shortcuts[api.pluginSurfaceShortcutKey(target)]
    const set = (who, accelerator) => {
      if (who === 'quick') api.useAppStore.getState().updateSetting('quickEditorShortcut', { kind: 'accelerator', accelerator })
      else api.usePluginSurfaceShortcutStore.getState().setShortcut(target, accelerator)
    }
    const status = (who) => who === 'quick' ? quick().registrationStatus : surface()?.registrationStatus
    const waitStatus = (who, expected) => until(() => status(who) === expected)
    const stop = (who) => { stops[who]?.(); delete stops[who] }
    await until(() => owner(A)?.owner === 'app' && quick().registrationStatus === 'Disabled')
    await tick()
    return { ...api, native, owner, quick, surface, set, waitStatus, stop,
      async press(key) { assert.ok(owner(key), 'key must remain registered'); owner(key).callback({ state: 'Pressed' }); await tick() },
      async setAndWait(who, key, expected = who === 'quick' ? 'Registered' : 'registered') {
        set(who, key)
        await waitStatus(who, expected)
        await tick()
      },
      gate(who, key, action = 'register') {
        const gate = { owner: who, key, action, started: deferred(), release: deferred() }
        native.gate = gate
        return gate
      },
      async finish() {
        for (const who of Object.keys(stops)) stop(who)
        await until(() => [...native.owners.values()].every(({ owner }) => owner === 'global-launcher'))
        await tick()
        assert.deepEqual(native.calls.filter((call) => call.action === 'unregister' &&
          call.previousOwner && call.previousOwner !== call.caller), [], 'no registrar may unregister another owner')
      },
    }
  }

  // Both attempted takeovers leave the app binding, persisted settings and original callback intact.
  {
    const f = await fixture()
    const original = f.owner(A)
    await f.setAndWait('quick', A, 'Registration failed')
    await f.setAndWait('surface', A, 'conflict')
    assert.equal(f.quick().registrationError, 'Shortcut is already registered')
    assert.equal(f.surface().registrationError, 'Shortcut is already registered')
    assert.equal(f.owner(A), original)
    assert.deepEqual(f.useAppStore.getState().settings.appHotkeys, [binding(A)])
    assert.deepEqual(JSON.parse(storage.get('hiven-settings')).state.settings.appHotkeys, [binding(A)])
    await f.press(A)
    assert.deepEqual(f.native.routes, ['app:app-a'])
    f.stop('quick'); f.stop('surface')
    await tick()
    assert.equal(f.owner(A), original, 'rejected registrars must not remove the owner during disposal')
    await f.press(A)
    assert.deepEqual(f.native.routes, ['app:app-a', 'app:app-a'])
    f.useAppStore.getState().removeAppHotkey('app-a')
    await until(() => !f.owner(A))
    await f.finish()
  }

  // Quick Editor and plugin surfaces also cannot replace each other's successful registrations.
  for (const first of ['quick', 'surface']) {
    const f = await fixture()
    const second = first === 'quick' ? 'surface' : 'quick'
    await f.setAndWait(first, B)
    const original = f.owner(B)
    assert.equal(await f.saveAppHotkey(binding(B)), 'conflict')
    await f.setAndWait(second, B, second === 'quick' ? 'Registration failed' : 'conflict')
    assert.equal(f.owner(B), original)
    f.stop(second)
    await tick()
    assert.equal(f.owner(B), original)
    await f.press(B)
    assert.deepEqual(f.native.routes, [first === 'quick' ? 'quick' : 'window:owner-test'])
    assert.deepEqual(f.useAppStore.getState().settings.appHotkeys, [binding(A)])
    await f.finish()
  }

  // Independent shortcuts keep their real routes; resync/replacement may still release owned keys.
  {
    const f = await fixture()
    await f.setAndWait('quick', B)
    await f.setAndWait('surface', C)
    await f.press(A); await f.press(B); await f.press(C)
    assert.deepEqual(f.native.routes, ['app:app-a', 'quick', 'window:owner-test'])
    const registrations = () => f.native.calls.filter((call) => call.action === 'register' && call.caller === 'surface').length
    const before = registrations()
    f.pluginRegistry.registerDevPlugin('another-plugin', [], [], [], [], { id: 'another-plugin' }, [])
    await until(() => registrations() === before + 1 && f.owner(C)?.owner === 'surface')
    await f.setAndWait('quick', D)
    assert.equal(f.owner(B), undefined)
    assert.equal(f.owner(D)?.owner, 'quick')
    assert.ok(f.native.calls.some((call) => call.action === 'unregister' && call.caller === 'quick' && call.previousOwner === 'quick'))
    assert.ok(f.native.calls.some((call) => call.action === 'unregister' && call.caller === 'surface' && call.previousOwner === 'surface'))
    f.useAppStore.getState().removeAppHotkey('app-a')
    await until(() => !f.owner(A))
    await f.press(D); await f.press(C)
    assert.deepEqual(f.native.routes.slice(-2), ['quick', 'window:owner-test'])
    await f.finish()
  }

  // Preserve the existing Global Launcher reservation/protection.
  {
    const f = await fixture()
    const launcher = { owner: 'global-launcher', callback: () => f.native.routes.push('global-launcher') }
    f.native.owners.set(B.toLowerCase(), launcher)
    f.useAppStore.getState().updateSetting('globalPinnedLauncherShortcut', { kind: 'accelerator', accelerator: B })
    await f.setAndWait('quick', B, 'Registration failed')
    await f.setAndWait('surface', B, 'conflict')
    assert.equal(f.quick().registrationError, 'Shortcut is already used by Global Launcher')
    assert.equal(f.owner(B), launcher)
    await f.press(B)
    assert.deepEqual(f.native.routes, ['global-launcher'])
    await f.finish()
    assert.equal(f.owner(B), launcher)
  }

  // The native register call can lose a race after an unoccupied check. Never clean up the winner.
  for (const who of ['quick', 'surface']) {
    const f = await fixture()
    const gate = f.gate(who, B)
    f.set(who, B)
    await gate.started.promise
    assert.equal(await f.saveAppHotkey(binding(B, 'app-b')), 'saved')
    const original = f.owner(B)
    gate.release.resolve()
    await f.waitStatus(who, who === 'quick' ? 'Registration failed' : 'failed')
    assert.equal(f.owner(B), original)
    await f.press(B)
    assert.deepEqual(f.native.routes, ['app:app-b'])
    f.stop(who)
    await tick()
    assert.equal(f.owner(B), original, 'late native rejection does not create cleanup ownership')
    await f.finish()
  }

  // A newer shortcut during the occupancy check ignores its stale result and registers independently.
  for (const who of ['quick', 'surface']) {
    const f = await fixture()
    const gate = f.gate(who, A, 'check')
    f.set(who, A)
    await gate.started.promise
    f.set(who, B)
    gate.release.resolve()
    await f.waitStatus(who, who === 'quick' ? 'Registered' : 'registered')
    assert.equal(f.owner(A)?.owner, 'app')
    assert.equal(f.owner(B)?.owner, who)
    assert.ok(!f.native.calls.some((call) => call.action === 'register' && call.caller === who && call.key === A))
    await f.finish()
  }

  // Generation cleanup removes only a late registration that this registrar actually acquired.
  for (const who of ['quick', 'surface']) {
    const f = await fixture()
    const gate = f.gate(who, B)
    f.set(who, B)
    await gate.started.promise
    f.stop(who)
    gate.release.resolve()
    await until(() => f.native.calls.some((call) => call.action === 'unregister' && call.caller === who && call.key === B))
    assert.equal(f.owner(A)?.owner, 'app')
    assert.equal(f.owner(B), undefined)
    await f.press(A)
    assert.deepEqual(f.native.routes, ['app:app-a'])
    await f.finish()
  }

  // Native delivery may already be queued when disposal unregisters a key.
  for (const who of ['quick', 'surface']) {
    const f = await fixture()
    await f.setAndWait(who, B)
    const retired = f.owner(B)
    f.stop(who)
    retired.callback({ state: 'Pressed' })
    await until(() => !f.owner(B))
    retired.callback({ state: 'Pressed' })
    await tick()
    assert.deepEqual(f.native.routes, [], `${who}: disposal must reject queued and late callbacks`)
    await f.press(A)
    assert.deepEqual(f.native.routes, ['app:app-a'])
    await f.finish()
  }

  // Reusing the same accelerator must not revive a callback from an earlier binding.
  for (const who of ['quick', 'surface']) {
    const f = await fixture()
    await f.setAndWait(who, B)
    const retired = f.owner(B)
    await f.setAndWait(who, C)
    await f.setAndWait(who, B)
    assert.notEqual(f.owner(B), retired)
    retired.callback({ state: 'Pressed' })
    await tick()
    assert.deepEqual(f.native.routes, [], `${who}: the original callback remains retired after changing back`)
    await f.press(B)
    assert.deepEqual(f.native.routes, [who === 'quick' ? 'quick' : 'window:owner-test'])
    await f.finish()
  }

  // Registry resync replaces even an unchanged surface shortcut with a fresh callback.
  {
    const f = await fixture()
    await f.setAndWait('surface', B)
    const retired = f.owner(B)
    f.pluginRegistry.registerDevPlugin('another-plugin', [], [], [], [], { id: 'another-plugin' }, [])
    retired.callback({ state: 'Pressed' })
    await until(() => f.owner(B) && f.owner(B) !== retired)
    retired.callback({ state: 'Pressed' })
    await tick()
    assert.deepEqual(f.native.routes, [], 'resync must retire the old callback before native cleanup completes')
    await f.press(B)
    assert.deepEqual(f.native.routes, ['window:owner-test'])
    await f.finish()
  }

  // An enabled shortcut record can remain after its plugin is removed from the registry.
  {
    const f = await fixture()
    await f.setAndWait('surface', B)
    const retired = f.owner(B)
    const lifetime = f.pluginRegistry.getPluginLifetime(target.pluginId, target.source)
    f.pluginRegistry.unregisterDevPlugin(target.pluginId)
    retired.callback({ state: 'Pressed' })
    await f.waitStatus('surface', 'disabled')
    assert.equal(lifetime.active, false)
    assert.equal(f.surface().enabled, true, 'registry removal preserves the configured binding')
    assert.equal(f.surface().registrationError, 'Plugin surface is not registered')
    assert.equal(f.owner(B), undefined)
    retired.callback({ state: 'Pressed' })
    await tick()
    assert.deepEqual(f.native.routes, [], 'a removed plugin must not reopen through its old shortcut')
    await f.finish()
  }

  // Permission revocation retires the callback while retaining the shortcut for a later grant.
  {
    const f = await fixture(['globalShortcut.register'])
    await f.setAndWait('surface', B)
    const retired = f.owner(B)
    f.usePluginPermissionStore.getState().revokePermissions(target.source, target.pluginId, ['globalShortcut.register'])
    retired.callback({ state: 'Pressed' })
    await f.waitStatus('surface', 'failed')
    assert.equal(f.surface().enabled, true)
    assert.equal(f.surface().registrationError, 'Missing permission: globalShortcut.register')
    assert.equal(f.owner(B), undefined)
    retired.callback({ state: 'Pressed' })
    await tick()
    assert.deepEqual(f.native.routes, [], 'revoked permission must block queued and late callbacks')
    f.usePluginPermissionStore.getState().grantPermissions(target.source, target.pluginId, ['globalShortcut.register'])
    await f.waitStatus('surface', 'registered')
    assert.notEqual(f.owner(B), retired)
    retired.callback({ state: 'Pressed' })
    await tick()
    assert.deepEqual(f.native.routes, [], 'a later grant must not revive the retired callback')
    await f.press(B)
    assert.deepEqual(f.native.routes, ['window:owner-test'])
    await f.finish()
  }

  // Existing disabled/cleared settings still reject saved native callbacks.
  for (const action of ['quick-disabled', 'surface-disabled', 'surface-cleared']) {
    const f = await fixture()
    const who = action.startsWith('quick') ? 'quick' : 'surface'
    await f.setAndWait(who, B)
    const retired = f.owner(B)
    if (action === 'quick-disabled') {
      f.useAppStore.getState().updateSetting('quickEditorShortcut', { kind: 'disabled' })
      await f.waitStatus('quick', 'Disabled')
    } else if (action === 'surface-disabled') {
      f.usePluginSurfaceShortcutStore.getState().setShortcutEnabled(target, false)
      await f.waitStatus('surface', 'disabled')
      assert.equal(f.surface().enabled, false)
    } else {
      f.usePluginSurfaceShortcutStore.getState().clearShortcut(target)
      assert.equal(f.surface(), undefined)
    }
    await until(() => !f.owner(B))
    retired.callback({ state: 'Pressed' })
    await tick()
    assert.deepEqual(f.native.routes, [], action)
    await f.finish()
  }

  // Both UI consumers use these actual locale mappings, including native-race failures.
  {
    const f = await fixture()
    for (const locale of ['en', 'zh']) {
      const conflict = f.translate(locale, 'settings', 'hotkeyShortcutConflict')
      const failed = f.translate(locale, 'settings', 'hotkeyRegistrationRetry')
      const quickFailure = f.translate(locale, 'settings', 'hotkeyRegistrationFailed', { message: conflict })
      assert.match(conflict, locale === 'zh' ? /已被占用.*其他快捷键/ : /already in use.*another shortcut/)
      assert.match(failed, locale === 'zh' ? /注册失败/ : /Registration failed/)
      assert.match(quickFailure, locale === 'zh' ? /注册失败.*已被占用/ : /Registration failed.*already in use/)
    }
    await f.finish()
  }
  console.log('✓ shortcut-ownership-runtime: shared registrars, original routes, conflicts, disposal, retired callbacks, races, owned cleanup and locales passed')
} finally {
  await rm(scratch, { recursive: true, force: true })
}
