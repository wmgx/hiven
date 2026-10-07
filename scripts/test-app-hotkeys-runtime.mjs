#!/usr/bin/env node
// Actual registrar + Zustand persistence + localization. Only native APIs are stubbed.
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'

const scratch = await mkdtemp(join(tmpdir(), 'hiven-app-hotkeys-'))
const storage = new Map()
let storageFailure = null
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => {
    if (storageFailure) throw storageFailure
    storage.set(key, value)
  },
  removeItem: (key) => storage.delete(key),
}
globalThis.window = Object.assign(new EventTarget(), { localStorage: globalThis.localStorage, __TAURI_INTERNALS__: {} })
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const tick = () => new Promise((resolve) => setImmediate(resolve))
async function until(test) {
  for (let count = 0; count < 200; count++) {
    if (test()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail('Timed out waiting for the native stub')
}
const A = 'Ctrl+Shift+A', B = 'Ctrl+Shift+B', C = 'Ctrl+Shift+C', D = 'Ctrl+Shift+D'
const binding = (appId, accelerator) => ({ appId, name: appId, accelerator, enabled: true })
const mocks = {
  '@tauri-apps/plugin-global-shortcut': `
    export const register = (...args) => globalThis.__appHotkeysNative.register(...args);
    export const unregister = (...args) => globalThis.__appHotkeysNative.unregister(...args);
    export const isRegistered = (...args) => globalThis.__appHotkeysNative.isRegistered(...args);
  `,
  '@tauri-apps/api/core': `
    export const invoke = (...args) => globalThis.__appHotkeysNative.invoke(...args);
    export class Channel { constructor() { throw new Error('Unexpected native channel'); } }
  `,
}
const entry = join(scratch, 'entry.ts')
await writeFile(entry, [
  `export * from '${resolve('src/hotkeys/appHotkeys.ts')}';`,
  `export { useAppStore } from '${resolve('src/store.ts')}';`,
  `export { useToastStore } from '${resolve('src/workspace/toast.ts')}';`,
].join('\n'))
try {
  await build({
    configFile: false, logLevel: 'silent',
    plugins: [{ name: 'native-boundary', enforce: 'pre',
      resolveId(id) { return Object.hasOwn(mocks, id) ? `\0mock:${id}` : undefined },
      load(id) { return id.startsWith('\0mock:') ? mocks[id.slice(6)] : undefined },
    }],
    build: { outDir: scratch, emptyOutDir: false, minify: false,
      lib: { entry, formats: ['es'], fileName: () => 'runtime.mjs' },
    },
  })
  let fixtureId = 0
  async function fixture(bindings = [binding('app-a', A)]) {
    storage.clear()
    globalThis.window = Object.assign(new EventTarget(), { localStorage: globalThis.localStorage, __TAURI_INTERNALS__: {} })
    const native = globalThis.__appHotkeysNative = {
      registered: new Map(), calls: [], invocations: [], registerGate: null, checkGate: null,
      rejectKey: null, failUnregister: false,
      async isRegistered(key) {
        if (this.checkGate?.key === key) {
          const gate = this.checkGate
          this.checkGate = null
          gate.started.resolve()
          await gate.release.promise
        }
        return this.registered.has(key.toLowerCase())
      },
      async register(key, callback) {
        this.calls.push(['register', key])
        if (this.registerGate?.key === key) {
          const gate = this.registerGate
          this.registerGate = null
          gate.callback = callback
          gate.started.resolve()
          await gate.release.promise
        }
        if (key === this.rejectKey) throw new Error('Synthetic OS rejection')
        assert.equal(this.registered.has(key.toLowerCase()), false, 'never replace another native registration')
        this.registered.set(key.toLowerCase(), callback)
      },
      async unregister(key) {
        this.calls.push(['unregister', key])
        if (this.failUnregister) throw new Error('Synthetic cleanup rejection')
        this.registered.delete(key.toLowerCase())
      },
      async invoke(command, args) {
        assert.equal(command, 'toggle_installed_app')
        this.invocations.push(args.appId)
      },
    }
    const api = await import(`${pathToFileURL(join(scratch, 'runtime.mjs')).href}?fixture=${++fixtureId}`)
    api.useAppStore.getState().updateSetting('appHotkeys', bindings)
    let stop = api.installAppHotkeys()
    await until(() => native.registered.size === bindings.length)
    await tick()
    const list = () => api.useAppStore.getState().settings.appHotkeys
    const persisted = () => JSON.parse(storage.get('hiven-settings')).state.settings.appHotkeys
    const gate = (key, type = 'registerGate') => {
      const value = { key, started: deferred(), release: deferred() }
      native[type] = value
      return value
    }
    return { ...api, native, list, persisted, gate,
      stop: () => stop(),
      reinstall: () => { stop = api.installAppHotkeys() },
      async finish() {
        stop()
        await until(() => native.registered.size === 0)
        await tick()
      },
    }
  }

  // Occupied launcher key and native rejection preserve the working key and persisted list.
  {
    const f = await fixture()
    const oldCallback = f.native.registered.get(A.toLowerCase())
    const reserved = 'Ctrl+Shift+Space'
    f.native.registered.set(reserved.toLowerCase(), () => {})
    assert.equal(await f.saveAppHotkey(binding('app-a', reserved)), 'conflict')
    assert.deepEqual(f.list(), [binding('app-a', A)])
    assert.deepEqual(f.persisted(), f.list())
    assert.deepEqual(f.native.calls, [['register', A]])
    f.native.rejectKey = B
    assert.equal(await f.saveAppHotkey(binding('app-a', B)), 'failed')
    assert.deepEqual(f.list(), [binding('app-a', A)])
    assert.deepEqual(f.persisted(), f.list())
    oldCallback({ state: 'Pressed' })
    await until(() => f.native.invocations.length === 1)
    assert.deepEqual(f.native.invocations, ['app-a'])
    f.native.rejectKey = null
    assert.equal(await f.saveAppHotkey(binding('app-a', B)), 'saved')
    assert.deepEqual(f.persisted(), [binding('app-a', B)])
    assert.equal(f.native.registered.has(A.toLowerCase()), false)
    assert.ok(f.native.calls.findLastIndex(([action, key]) => action === 'register' && key === B) <
      f.native.calls.findIndex(([action, key]) => action === 'unregister' && key === A))
    oldCallback({ state: 'Pressed' })
    await tick()
    assert.equal(f.native.invocations.length, 1, 'retired callback must not launch')
    f.native.registered.delete(reserved.toLowerCase())
    await f.finish()
  }

  // A successful transfer keeps the existing native key and unrelated persisted rows.
  {
    const f = await fixture([binding('app-a', A), binding('app-b', B), binding('app-c', C)])
    const transferredCallback = f.native.registered.get(B.toLowerCase())
    assert.equal(await f.saveAppHotkey(binding('app-a', B)), 'saved')
    assert.deepEqual(f.list(), [binding('app-a', B), binding('app-c', C)])
    assert.deepEqual(f.persisted(), f.list())
    assert.equal(f.native.calls.filter(([, key]) => key === B).length, 1, 'transfer does not unregister or reregister')
    transferredCallback({ state: 'Pressed' })
    await until(() => f.native.invocations.length === 1)
    assert.deepEqual(f.native.invocations, ['app-a'])
    f.useAppStore.getState().removeAppHotkey('app-a')
    transferredCallback({ state: 'Pressed' })
    await tick()
    assert.equal(f.native.invocations.length, 1, 'remove suppresses callbacks immediately')
    await f.finish()
  }

  // Changes through the actual store during native registration cannot be rolled back.
  {
    const f = await fixture([binding('app-a', A), binding('app-c', C)])
    const gate = f.gate(B)
    const pending = f.saveAppHotkey(binding('app-a', B))
    await gate.started.promise
    f.useAppStore.getState().setAppHotkey(binding('app-c', D))
    gate.release.resolve()
    assert.equal(await pending, 'cancelled')
    await until(() => f.native.registered.has(D.toLowerCase()) && !f.native.registered.has(C.toLowerCase()))
    assert.deepEqual(f.list(), [binding('app-c', D), binding('app-a', A)])
    assert.deepEqual(f.persisted(), f.list())
    assert.equal(f.native.registered.has(B.toLowerCase()), false)
    await f.finish()
  }

  // A newer save wins even if the older OS request fails later.
  {
    const f = await fixture()
    const gate = f.gate(B)
    f.native.rejectKey = B
    const oldSave = f.saveAppHotkey(binding('app-a', B))
    await gate.started.promise
    const newSave = f.saveAppHotkey(binding('app-a', C))
    gate.release.resolve()
    assert.equal(await oldSave, 'cancelled')
    assert.equal(await newSave, 'saved')
    assert.deepEqual(f.persisted(), [binding('app-a', C)])
    await f.finish()
  }

  // Persistence publishes memory first: storage rejection restores displaced rows,
  // leaves old native routes intact, and returns a terminal failure for the UI.
  for (const accelerator of [B, C]) {
    const f = await fixture([binding('app-a', A), binding('app-b', B)])
    storageFailure = new Error('Synthetic storage quota')
    assert.equal(await f.saveAppHotkey(binding('app-a', accelerator)), 'failed')
    storageFailure = null
    await tick()
    assert.deepEqual(f.list(), [binding('app-a', A), binding('app-b', B)])
    assert.deepEqual(f.persisted(), f.list())
    assert.deepEqual([...f.native.registered.keys()].sort(), [A, B].map((key) => key.toLowerCase()).sort())
    f.native.registered.get(B.toLowerCase())({ state: 'Pressed' })
    await until(() => f.native.invocations.length === 1)
    assert.deepEqual(f.native.invocations, ['app-b'], 'failed transfer must preserve its prior owner')
    await f.finish()
  }

  // A synchronous subscriber's newer edit must survive the older write's rejection.
  {
    const f = await fixture()
    let reentered = false
    const unsubscribe = f.useAppStore.subscribe((state) => {
      if (reentered || state.settings.appHotkeys[0]?.accelerator !== B) return
      reentered = true
      f.useAppStore.getState().setAppHotkey(binding('app-a', C))
      storageFailure = new Error('Synthetic older write rejection')
    })
    assert.equal(await f.saveAppHotkey(binding('app-a', B)), 'failed')
    storageFailure = null
    unsubscribe()
    await until(() => f.native.registered.has(C.toLowerCase()) && !f.native.registered.has(A.toLowerCase()))
    assert.deepEqual(f.list(), [binding('app-a', C)])
    assert.deepEqual(f.persisted(), f.list())
    assert.equal(f.native.registered.has(B.toLowerCase()), false)
    await f.finish()
  }

  // A reentrant removal is not reported as a successful save.
  {
    const f = await fixture()
    const unsubscribe = f.useAppStore.subscribe((state) => {
      if (state.settings.appHotkeys[0]?.accelerator === B) f.useAppStore.getState().removeAppHotkey('app-a')
    })
    assert.equal(await f.saveAppHotkey(binding('app-a', B)), 'cancelled')
    unsubscribe()
    await until(() => f.native.registered.size === 0)
    assert.deepEqual(f.persisted(), [])
    await f.finish()
  }

  // Editing/cancelling the draft while saving cannot commit or leak the new key.
  {
    const f = await fixture()
    let current = true
    const gate = f.gate(B)
    const pending = f.saveAppHotkey(binding('app-a', B), () => current)
    await gate.started.promise
    current = false
    gate.release.resolve()
    assert.equal(await pending, 'cancelled')
    assert.deepEqual(f.persisted(), [binding('app-a', A)])
    assert.equal(f.native.registered.has(B.toLowerCase()), false)
    await f.finish()
  }

  // Deletion during registration keeps the deletion and suppresses a late callback.
  {
    const f = await fixture()
    const gate = f.gate(B)
    const pending = f.saveAppHotkey(binding('app-a', B))
    await gate.started.promise
    f.useAppStore.getState().removeAppHotkey('app-a')
    gate.release.resolve()
    assert.equal(await pending, 'cancelled')
    await until(() => f.native.registered.size === 0)
    gate.callback({ state: 'Pressed' })
    await tick()
    assert.deepEqual(f.native.invocations, [])
    assert.deepEqual(f.persisted(), [])
    await f.finish()
  }

  // Uninstall/reinstall serializes cleanup behind a late native success.
  {
    const f = await fixture()
    const oldCallback = f.native.registered.get(A.toLowerCase())
    const gate = f.gate(B)
    const pending = f.saveAppHotkey(binding('app-a', B))
    await gate.started.promise
    f.stop()
    f.reinstall()
    gate.release.resolve()
    assert.equal(await pending, 'cancelled')
    await until(() => f.native.calls.filter(([action, key]) => action === 'register' && key === A).length === 2)
    await tick()
    assert.equal(f.native.registered.has(B.toLowerCase()), false)
    oldCallback({ state: 'Pressed' })
    gate.callback({ state: 'Pressed' })
    await tick()
    assert.deepEqual(f.native.invocations, [])
    f.native.registered.get(A.toLowerCase())({ state: 'Pressed' })
    await until(() => f.native.invocations.length === 1)
    await f.finish()
  }

  // Disposal during the occupancy check never starts a late registration.
  {
    const f = await fixture()
    const gate = f.gate(B, 'checkGate')
    const pending = f.saveAppHotkey(binding('app-a', B))
    await gate.started.promise
    f.stop()
    gate.release.resolve()
    assert.equal(await pending, 'cancelled')
    await until(() => f.native.registered.size === 0)
    assert.equal(f.native.calls.some(([action, key]) => action === 'register' && key === B), false)
    await f.finish()
  }

  // Direct settings/rehydration failures keep an old registration and show real localized errors.
  for (const locale of ['en', 'zh']) {
    const f = await fixture()
    f.useAppStore.getState().setLocale(locale)
    f.native.registered.set(B.toLowerCase(), () => {})
    f.useAppStore.getState().setAppHotkey(binding('app-a', B))
    await until(() => f.useToastStore.getState().toasts.length === 1)
    const message = f.useToastStore.getState().toasts[0].message
    assert.match(message, locale === 'zh' ? /已被占用/ : /already in use/)
    assert.ok(message.includes('app-a') && message.includes(B))
    assert.ok(f.native.registered.has(A.toLowerCase()), 'failed replacement preserves old native key')
    f.native.registered.delete(B.toLowerCase())
    await f.finish()
  }

  console.log('✓ app-hotkeys-runtime: conflict, retry, transfer, persistence, stale edits and lifecycle passed')
} finally {
  await rm(scratch, { recursive: true, force: true })
}
