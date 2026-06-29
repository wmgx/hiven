#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const refactorSuite = readFileSync('scripts/test-refactor-suite.mjs', 'utf8')

assert.equal(
  packageJson.scripts?.['test:surface-registry-behavior'],
  'node scripts/test-surface-registry-behavior.mjs',
  'package.json must expose test:surface-registry-behavior',
)
const tauriLib = readFileSync('src-tauri/src/lib.rs', 'utf8')
assert.match(tauriLib, /fn validate_surface_instance_kind/, 'Rust surface registry must validate surface kind inputs')
assert.match(tauriLib, /fn validate_surface_instance_state/, 'Rust surface registry must validate surface state inputs')
assert.match(tauriLib, /validate_surface_instance_kind\(&surface\.kind\)\?[\s\S]*validate_surface_instance_state\(&surface\.state\)\?/, 'Rust surface upsert must reject invalid kind/state values')
assert.match(tauriLib, /surface_registry_mark_state[\s\S]*validate_surface_instance_state\(&state\)\?/, 'Rust surface mark-state must reject invalid state values')
assert.match(
  refactorSuite,
  /test:surface-registry-behavior/,
  'refactor suite must include surface registry behavior coverage',
)

const SURFACE_REGISTRY_EVENT = 'hiven://surface-registry-sync'

async function flushAsyncWork() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function loadSurfaceRegistry({ rustSnapshot = [] } = {}) {
  let src = readFileSync('src/surfaces/registry.ts', 'utf8')
  src = src.replace(/import\s+\{\s*useSyncExternalStore\s*\}\s+from\s+['"]react['"]\s*;?\s*\n?/, '')
  src = src.replace(/import\(['"]@tauri-apps\/api\/core['"]\)/g, 'Promise.resolve(__tauriCore)')
  src = src.replace(/import\(['"]@tauri-apps\/api\/event['"]\)/g, 'Promise.resolve(__tauriEvent)')
  src = src.replace(/import\s+type\s*\{[\s\S]*?\}\s*from\s*['"][^'"]*['"]\s*;?\s*\n?/g, '')
  const out = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
      esModuleInterop: true,
    },
  }).outputText
  const moduleExports = {}
  const calls = { invoke: [], emit: [], listen: [] }
  const listeners = new Map()
  const sandbox = {
    exports: moduleExports,
    module: { exports: moduleExports },
    console,
    window: { __TAURI_INTERNALS__: {} },
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    __tauriCore: {
      invoke: async (command, payload) => {
        calls.invoke.push({ command, payload })
        if (command === 'surface_registry_snapshot') return rustSnapshot
        return undefined
      },
    },
    __tauriEvent: {
      listen: async (event, handler) => {
        calls.listen.push(event)
        listeners.set(event, handler)
        return () => listeners.delete(event)
      },
      emit: async (event, payload) => {
        calls.emit.push({ event, payload })
      },
    },
  }
  vm.runInNewContext(out, sandbox)
  return { registry: sandbox.module.exports, calls, listeners }
}

const rustEditorSurface = {
  id: 'editor',
  kind: 'editor',
  windowLabel: 'editor',
  title: 'Editor',
  state: 'visible',
  lastActiveAt: 10,
  canReceiveText: true,
}
const rustPluginSurface = {
  id: 'plugin-surface:builtin:clipboard-history:main',
  kind: 'plugin-surface',
  windowLabel: 'plugin-surface:builtin:clipboard-history:main',
  title: 'Clipboard History',
  pluginId: 'clipboard-history',
  surfaceId: 'main',
  state: 'hidden',
  lastActiveAt: 20,
  canProvideText: true,
}

const rustSnapshot = [rustEditorSurface, rustPluginSurface, { id: 'invalid' }]
const { registry, calls, listeners } = loadSurfaceRegistry({ rustSnapshot })
assert.deepEqual(JSON.parse(JSON.stringify(registry.getSurfaceInstances())), [], 'first access starts async Rust hydration and returns current in-memory state')
await flushAsyncWork()
assert.deepEqual(
  JSON.parse(JSON.stringify(registry.getSurfaceInstances().map((surface) => surface.id))),
  ['plugin-surface:builtin:clipboard-history:main', 'editor'],
  'surface registry must hydrate valid Rust snapshot records and sort by lastActiveAt descending',
)
assert.deepEqual(
  JSON.parse(JSON.stringify(calls.invoke[0])),
  { command: 'surface_registry_snapshot' },
  'surface registry must request the Rust-side snapshot once during sync startup',
)
assert.deepEqual(calls.listen, [SURFACE_REGISTRY_EVENT], 'surface registry must subscribe to cross-window Tauri sync events')

registry.upsertSurfaceInstance({
  id: 'launcher',
  kind: 'launcher',
  windowLabel: 'launcher',
  title: 'Launcher',
  state: 'visible',
  lastActiveAt: 30,
})
await flushAsyncWork()
assert.equal(registry.getSurfaceInstance('launcher').title, 'Launcher')
assert.deepEqual(
  JSON.parse(JSON.stringify(calls.invoke.at(-1))),
  {
    command: 'surface_registry_upsert',
    payload: {
      surface: {
        id: 'launcher',
        kind: 'launcher',
        windowLabel: 'launcher',
        title: 'Launcher',
        state: 'visible',
        lastActiveAt: 30,
      },
    },
  },
  'upsertSurfaceInstance must persist the complete surface record to Rust',
)
assert.equal(calls.emit.at(-1).event, SURFACE_REGISTRY_EVENT, 'upsertSurfaceInstance must broadcast a cross-window mutation')
assert.equal(calls.emit.at(-1).payload.type, 'upsert')

registry.markSurfaceInstanceState('launcher', 'hidden')
await flushAsyncWork()
assert.equal(registry.getSurfaceInstance('launcher').state, 'hidden')
assert.equal(calls.invoke.at(-1).command, 'surface_registry_mark_state')
assert.equal(calls.invoke.at(-1).payload.id, 'launcher')
assert.equal(calls.invoke.at(-1).payload.state, 'hidden')
assert.equal(typeof calls.invoke.at(-1).payload.lastActiveAt, 'number')
assert.equal(calls.emit.at(-1).payload.type, 'mark-state')

const localMutation = calls.emit.at(-1).payload
listeners.get(SURFACE_REGISTRY_EVENT)({ payload: { ...localMutation, state: 'destroyed' } })
assert.equal(registry.getSurfaceInstance('launcher').state, 'hidden', 'surface registry must ignore same-source echoed events')

listeners.get(SURFACE_REGISTRY_EVENT)({
  payload: {
    sourceId: 'remote-window',
    type: 'upsert',
    surface: {
      id: 'plugin-surface:builtin:json:main',
      kind: 'plugin-surface',
      windowLabel: 'plugin-surface:builtin:json:main',
      title: 'JSON',
      pluginId: 'json',
      surfaceId: 'main',
      state: 'visible',
      lastActiveAt: 40,
    },
  },
})
assert.equal(registry.getSurfaceInstance('plugin-surface:builtin:json:main').title, 'JSON', 'remote upsert mutations must update local registry state')

listeners.get(SURFACE_REGISTRY_EVENT)({
  payload: {
    sourceId: 'remote-window',
    type: 'mark-state',
    id: 'plugin-surface:builtin:json:main',
    state: 'hidden',
    lastActiveAt: 50,
  },
})
assert.equal(registry.getSurfaceInstance('plugin-surface:builtin:json:main').state, 'hidden', 'remote mark-state mutations must update local registry state')
assert.equal(registry.getSurfaceInstance('plugin-surface:builtin:json:main').lastActiveAt, 50)

listeners.get(SURFACE_REGISTRY_EVENT)({ payload: { sourceId: 'remote-window', type: 'remove', id: 'plugin-surface:builtin:json:main' } })
assert.equal(registry.getSurfaceInstance('plugin-surface:builtin:json:main'), undefined, 'remote remove mutations must delete local registry state')

rustSnapshot.push({
  id: 'plugin-surface:builtin:translate:main',
  kind: 'plugin-surface',
  windowLabel: 'plugin-surface:builtin:translate:main',
  title: 'Translate',
  pluginId: 'translate',
  surfaceId: 'main',
  state: 'hidden',
  lastActiveAt: 60,
})
listeners.get(SURFACE_REGISTRY_EVENT)({
  payload: {
    sourceId: 'remote-window',
    type: 'mark-state',
    id: 'plugin-surface:builtin:translate:main',
    state: 'hidden',
    lastActiveAt: 60,
  },
})
await flushAsyncWork()
assert.equal(calls.invoke.filter((call) => call.command === 'surface_registry_snapshot').length, 2, 'unknown remote mark-state mutations must force a Rust snapshot refresh')
assert.equal(registry.getSurfaceInstance('plugin-surface:builtin:translate:main').title, 'Translate', 'forced snapshot refresh must recover unknown remotely-marked surfaces')

registry.removeSurfaceInstance('launcher')
await flushAsyncWork()
assert.equal(registry.getSurfaceInstance('launcher'), undefined)
assert.deepEqual(
  JSON.parse(JSON.stringify(calls.invoke.at(-1))),
  { command: 'surface_registry_remove', payload: { id: 'launcher' } },
  'removeSurfaceInstance must persist removals to Rust',
)
assert.equal(calls.emit.at(-1).payload.type, 'remove')

console.log('surface registry behavior checks passed')
