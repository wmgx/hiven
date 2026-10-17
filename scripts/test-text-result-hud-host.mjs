#!/usr/bin/env node
// Generic "shortcut -> plugin text result -> native HUD" host: routing by product id and fail-closed gating.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }
const compile = (file) => ts.transpileModule(readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function fixture({ granted = true } = {}) {
  const listeners = new Map(), subscribers = [], invocations = [], runners = []
  const shortcuts = { 'builtin:p:s': { enabled: true, registrationStatus: 'registered' } }
  let interceptor
  const state = { granted }
  const runner = (name) => {
    const calls = []
    const value = { calls, trigger: async () => { calls.push('trigger') }, cancel: async () => { calls.push('cancel') },
      copyAndClose: async (e) => { calls.push(['copy', e]) }, pasteAndClose: async (e) => { calls.push(['paste', e]) },
      cancelExpected: async (e) => { calls.push(['close', e]) } }
    runners.push({ name, value })
    return value
  }
  const task = (pluginId, product) => ({ pluginId, surfaceId: 's', definition: { settings: undefined }, contribution: {
    product, permissions: ['clipboard.write'], pasteRequires: product === 'b-product' ? ['accessibility.paste'] : undefined,
    labels: () => ({ title: product }), create: () => runner(product),
  } })
  const tasks = [task('p', 'a-product'), task('q', 'b-product')]
  const noop = () => () => {}
  const store = (value) => ({ getState: () => value, subscribe: (fn) => { subscribers.push(fn); return () => {} } })
  const modules = {
    '@tauri-apps/api/core': { invoke: async (command, args) => { invocations.push({ command, args }); return true } },
    '@tauri-apps/api/event': { listen: async (name, fn) => { listeners.set(name, fn); return () => listeners.delete(name) } },
    '../store': { useAppStore: { getState: () => ({ settings: { locale: 'en', theme: 'light' } }) } },
    '../hotkeys/pluginSurfaceShortcuts': { acquireRegisteredSurfaceShortcutInterceptor: async (target, handle) => {
      if (target.pluginId === 'p') interceptor = handle
      return async () => {}
    } },
    '../i18n/pluginI18nRegistry': { makePluginT: () => (key) => key },
    '../workspace/bundledPluginIdentity': { isCurrentBundledDefinition: () => true },
    '../workspace/ai/runtime': { createPluginAi: () => ({}) },
    '../workspace/nativeClipboard': { readNativeClipboardText: async () => '', writeTextWithoutHistory: async () => {} },
    '../workspace/pluginClipboardImageRead': { createPluginClipboardImageReader: () => null },
    '../workspace/pluginPermissions': { usePluginPermissionStore: store({}) },
    '../workspace/pluginRegistry': { pluginRegistry: { subscribe: (fn) => { subscribers.push(fn); return () => {} }, getPluginDefinition: (id) => tasks.find((t) => t.pluginId === id)?.definition } },
    '../workspace/pluginSettingsStore': { resolvePluginSettings: () => ({ value: {} }), usePluginSettingsStore: store({ getPluginSettings: () => undefined }) },
    '../workspace/pluginSurfaceShortcuts': { pluginSurfaceShortcutKey: (t) => `builtin:${t.pluginId}:${t.surfaceId}`, usePluginSurfaceShortcutStore: { getState: () => ({ shortcuts: { ...shortcuts, 'builtin:q:s': shortcuts['builtin:p:s'] } }), subscribe: noop } },
    '../workspace/textResultHudOwnership': {},
    './bundledSurfaces': { BUNDLED_SOURCE: 'builtin', isLauncherNativeRuntime: () => true,
      grantedPermissions: () => state.granted ? {} : null,
      listBundledSurfaceTasks: (pick) => tasks.filter((t) => pick({ textResultHud: t.contribution })) },
  }
  const load = (file, extra = {}) => {
    const exports = {}
    vm.runInNewContext(compile(file), {
      exports, module: { exports }, console, Promise, Symbol, DOMException, setTimeout, document: { documentElement: { dataset: {} } },
      require: (id) => { assert.ok(Object.hasOwn({ ...modules, ...extra }, id), `Unexpected dependency ${id}`); return { ...modules, ...extra }[id] },
    })
    return exports
  }
  modules['../workspace/textResultHudOwnership'] = load('src/workspace/textResultHudOwnership.ts')
  const host = load('src/shortcutHosts/textResultHud.ts')
  return { host, listeners, invocations, runners, press: () => interceptor?.(), state }
}

// Main path: a shortcut press triggers only that plugin's runner; native actions route by product id.
{
  const f = fixture()
  const stop = f.host.installTextResultHudHosts()
  await flush(); await new Promise((resolve) => setTimeout(resolve, 5)); await flush()
  await f.press(); await flush()
  const [a, b] = f.runners.map((r) => r.value)
  assert.deepEqual(a.calls.filter((c) => c === 'trigger'), ['trigger'], 'shortcut triggers the owning runner')
  assert.equal(b.calls.includes('trigger'), false)
  const action = f.listeners.get('hiven://text-result-hud-action')
  action({ payload: { product: 'b-product', sessionId: 's1', revision: 2, action: 'paste' } })
  action({ payload: { product: 'a-product', sessionId: 's2', revision: 3, action: 'copy' } })
  action({ payload: { product: 'a-product', sessionId: 's2', revision: 3, action: 'close' } })
  await flush()
  const plain = (value) => JSON.parse(JSON.stringify(value))
  assert.deepEqual(plain(b.calls.at(-1)), ['paste', { sessionId: 's1', revision: 2 }])
  assert.deepEqual(plain(a.calls.filter((c) => Array.isArray(c))), [['copy', { sessionId: 's2', revision: 3 }], ['close', { sessionId: 's2', revision: 3 }]])
  stop()
}

// Failure path: without granted permissions the shortcut is never intercepted.
{
  const f = fixture({ granted: false })
  const stop = f.host.installTextResultHudHosts()
  await flush(); await new Promise((resolve) => setTimeout(resolve, 5)); await flush()
  assert.equal(f.press(), undefined, 'no interceptor is acquired without permissions')
  stop()
}
console.log('Text result HUD host: shortcut trigger, product-routed native actions and permission gating passed')
