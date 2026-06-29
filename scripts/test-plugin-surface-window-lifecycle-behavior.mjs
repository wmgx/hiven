#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const refactorSuite = readFileSync('scripts/test-refactor-suite.mjs', 'utf8')
const tauriLib = readFileSync('src-tauri/src/lib.rs', 'utf8')

assert.equal(
  packageJson.scripts?.['test:plugin-surface-window-lifecycle-behavior'],
  'node scripts/test-plugin-surface-window-lifecycle-behavior.mjs',
  'package.json must expose test:plugin-surface-window-lifecycle-behavior',
)
assert.match(
  refactorSuite,
  /test:plugin-surface-window-lifecycle-behavior/,
  'refactor suite must include plugin surface window lifecycle behavior coverage',
)
assert.match(tauriLib, /SURFACE_REGISTRY_EVENT/, 'native plugin surface lifecycle must use the shared SurfaceRegistry event channel')
assert.match(tauriLib, /show_and_focus_plugin_surface_window\(&app,\s*&window\)\?[\s\S]*surface_registry_upsert_record\(surface\.clone\(\)\)\?/, 'native plugin surface show must persist visible state in Rust registry')
assert.match(tauriLib, /async fn hide_plugin_surface_window[\s\S]*surface_registry_mark_record_state\(&label,\s*["']hidden["']/, 'native plugin surface hide must persist hidden state in Rust registry')
assert.match(tauriLib, /WindowEvent::Focused\(false\) if close_on_blur[\s\S]*surface_registry_mark_record_state\(&label,\s*["']hidden["']/, 'native focus-lost hide must persist hidden state in Rust registry')
assert.match(tauriLib, /WindowEvent::Destroyed[\s\S]*surface_registry_upsert_record[\s\S]*["']destroyed["']/, 'native plugin surface destroy must persist destroyed state in Rust registry')

function loadModule(path, globals = {}) {
  let src = readFileSync(path, 'utf8')
  src = src.replace(/import\s+type\s*\{[\s\S]*?\}\s*from\s*['"][^'"]*['"]\s*;?\s*\n?/g, '')
  src = src.replace(/import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]*['"]\s*;?\s*\n?/g, '')
  src = src.replace(/export\s*\{[\s\S]*?\}\s*;?\s*\n?/g, '')
  const out = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
      esModuleInterop: true,
    },
  }).outputText
  const moduleExports = {}
  const sandbox = { exports: moduleExports, module: { exports: moduleExports }, console, ...globals }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports
}

const target = { source: 'builtin', pluginId: 'clipboard-history', surfaceId: 'main' }
const unknownTarget = { source: 'builtin', pluginId: 'unknown', surfaceId: 'main' }
const surfaceDefinition = {
  ui: {
    surfaces: [
      {
        id: 'main',
        title: 'Clipboard History',
        entry: { shortcutPresentation: 'window' },
        shell: {
          defaultWidth: 720,
          defaultHeight: 420,
          closeOnBlur: false,
          destroyTimeout: 5_000,
        },
      },
    ],
  },
}

{
  const calls = { invoke: [], upsert: [], mark: [] }
  const lifecycle = loadModule('src/workspace/pluginSurfaceWindows.ts', {
    window: { __TAURI_INTERNALS__: {} },
    invoke: async (command, payload) => { calls.invoke.push({ command, payload }) },
    pluginRegistry: {
      getPluginDefinition: (pluginId, source) => pluginId === target.pluginId && source === target.source ? surfaceDefinition : undefined,
    },
    upsertSurfaceInstance: (surface) => { calls.upsert.push(surface) },
    markSurfaceInstanceState: (id, state) => { calls.mark.push({ id, state }) },
  })

  assert.equal(lifecycle.pluginSurfaceInstanceId(target), 'plugin-surface:builtin:clipboard-history:main')
  assert.equal(lifecycle.pluginSurfaceWindowLabel(target), 'plugin-surface:builtin:clipboard-history:main')
  assert.equal(lifecycle.getPluginSurfaceShortcutPresentation(target), 'window', 'window-capable plugin surfaces must use independent window shortcut presentation')
  assert.equal(lifecycle.getPluginSurfaceShortcutPresentation(unknownTarget), 'launcher', 'surfaces without window shortcut metadata must stay in launcher presentation')

  await lifecycle.requestOpenPluginSurfaceWindow(target)
  assert.deepEqual(JSON.parse(JSON.stringify(calls.invoke[0])), {
    command: 'show_plugin_surface_window',
    payload: {
      pluginId: 'clipboard-history',
      surfaceId: 'main',
      source: 'builtin',
      width: 720,
      height: 420,
      closeOnBlur: false,
      destroyTimeoutMs: 5_000,
    },
  }, 'requestOpenPluginSurfaceWindow must invoke the native independent-window lifecycle with resolved shell options')
  assert.deepEqual(JSON.parse(JSON.stringify(calls.upsert[0])), {
    id: 'plugin-surface:builtin:clipboard-history:main',
    kind: 'plugin-surface',
    windowLabel: 'plugin-surface:builtin:clipboard-history:main',
    title: 'Clipboard History',
    pluginId: 'clipboard-history',
    surfaceId: 'main',
    state: 'visible',
    canReceiveText: true,
    canProvideText: true,
    canAttachToEditor: true,
  }, 'opening a plugin surface window must publish a visible SurfaceRegistry instance')

  await lifecycle.requestHidePluginSurfaceWindow(target)
  assert.deepEqual(JSON.parse(JSON.stringify(calls.invoke[1])), {
    command: 'hide_plugin_surface_window',
    payload: {
      pluginId: 'clipboard-history',
      surfaceId: 'main',
      source: 'builtin',
      destroyTimeoutMs: 5_000,
    },
  }, 'requestHidePluginSurfaceWindow must invoke native hide with the resolved destroy timeout')
  assert.deepEqual(JSON.parse(JSON.stringify(calls.mark[0])), {
    id: 'plugin-surface:builtin:clipboard-history:main',
    state: 'hidden',
  }, 'hiding a plugin surface window must mark its SurfaceRegistry instance hidden')
}

{
  const calls = { invoke: [], upsert: [], mark: [] }
  const lifecycle = loadModule('src/workspace/pluginSurfaceWindows.ts', {
    window: {},
    invoke: async (command, payload) => { calls.invoke.push({ command, payload }) },
    pluginRegistry: { getPluginDefinition: () => surfaceDefinition },
    upsertSurfaceInstance: (surface) => { calls.upsert.push(surface) },
    markSurfaceInstanceState: (id, state) => { calls.mark.push({ id, state }) },
  })
  await lifecycle.requestOpenPluginSurfaceWindow(target)
  await lifecycle.requestHidePluginSurfaceWindow(target)
  assert.deepEqual(calls.invoke, [], 'non-Tauri environments must not invoke native plugin surface window commands')
  assert.deepEqual(calls.upsert, [], 'non-Tauri plugin surface open must not publish native window surface state')
  assert.deepEqual(calls.mark, [], 'non-Tauri plugin surface hide must not mark native window surface state')
}

{
  const calls = { open: [], hide: [] }
  const facade = loadModule('src/workspace/windowManager/pluginSurfaceWindows.ts', {
    requestOpenPluginSurfaceWindow: async (input) => { calls.open.push(input) },
    requestHidePluginSurfaceWindow: async (input) => { calls.hide.push(input) },
    getPluginSurfaceShortcutPresentation: () => 'window',
    pluginSurfaceInstanceId: (input) => `plugin-surface:${input.source}:${input.pluginId}:${input.surfaceId}`,
    pluginSurfaceWindowLabel: (input) => `plugin-surface:${input.source}:${input.pluginId}:${input.surfaceId}`,
  })

  await facade.showPluginSurfaceWindow(target)
  await facade.hidePluginSurfaceWindow(target)
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), {
    open: [target],
    hide: [target],
  }, 'window manager facade must delegate plugin surface show/hide to the lower-level lifecycle module')
}

console.log('plugin surface window lifecycle behavior checks passed')
