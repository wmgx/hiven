import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import vm from 'node:vm'
import ts from 'typescript'
import * as zustand from 'zustand'
import * as middleware from 'zustand/middleware'

const compiled = new Map()
export function load(path, dependencies, globals = {}) {
  if (!compiled.has(path)) compiled.set(path, ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
  }).outputText)
  const exports = {}
  vm.runInNewContext(compiled.get(path), {
    exports, module: { exports }, AbortController, Error, Promise, setTimeout, clearTimeout,
    crypto: { randomUUID }, console, ...globals,
    require: (id) => {
      assert.ok(id in dependencies, `Unexpected dependency ${id} in ${path}`)
      return dependencies[id]
    },
  }, { filename: path })
  return exports
}

export function permissionHarness() {
  const stored = new Map()
  const storage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
    removeItem: (key) => stored.delete(key),
  }
  // Zustand's actual persist middleware resolves localStorage in its own realm.
  const previous = globalThis.localStorage
  const previousWindow = globalThis.window
  let permissions
  try {
    globalThis.localStorage = storage
    globalThis.window = { localStorage: storage }
    permissions = load('src/workspace/pluginPermissions.ts', { zustand, 'zustand/middleware': middleware }, { localStorage: storage })
  } finally {
    if (previous === undefined) delete globalThis.localStorage
    else globalThis.localStorage = previous
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
  const store = permissions.usePluginPermissionStore
  const subscribe = store.subscribe
  const subscriptions = new Set()
  store.subscribe = (listener) => {
    const unsubscribe = subscribe(listener)
    subscriptions.add(listener)
    return () => { subscriptions.delete(listener); unsubscribe() }
  }
  return {
    permissions, store, storage, subscriptions,
    snapshot: (source, id, declared = ['ai.use']) => permissions.getPluginPermissionSnapshot(source, id, declared),
    grant: (source, id) => store.getState().grantPermissions(source, id, ['ai.use']),
    revoke: (source, id) => store.getState().revokePermissions(source, id, ['ai.use']),
  }
}

export function registryHarness() {
  const { pluginRegistry } = load('src/workspace/pluginRegistry.ts', { react: { useSyncExternalStore() { throw new Error('Unexpected React render') } } })
  const subscriptions = new Set()
  const subscribe = pluginRegistry.subscribe.bind(pluginRegistry)
  pluginRegistry.subscribe = (listener) => {
    const unsubscribe = subscribe(listener)
    subscriptions.add(listener)
    return () => { subscriptions.delete(listener); unsubscribe() }
  }
  return { pluginRegistry, subscriptions }
}
