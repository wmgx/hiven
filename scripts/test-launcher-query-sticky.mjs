#!/usr/bin/env node
/** Hiding the Launcher ends its session; the previous query must never be restored. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const host = readFileSync('src/launcher/hosts/GlobalLauncherHost.tsx', 'utf8')
const lifecycle = readFileSync('src/components/launcher/GlobalLauncherHostLifecycle.ts', 'utf8')
assert.doesNotMatch(host + lifecycle, /querySticky|saveStickyLauncherQuery|consumeStickyLauncherQuery/)
assert.match(lifecycle, /setQuery\(''\)/, 'new sessions start empty')
const callback = (name) => {
  const body = host.match(new RegExp(`const ${name} = useCallback\\(([\\s\\S]*?)\\n  }, \\[`))?.[1]
  assert.ok(body, `${name} callback exists`)
  return `${body}\n}`
}
const externalClose = host.match(/useEffect\(\(\) => useAppStore\.subscribe\(([\s\S]*?)\n  }\), \[resetLauncherSession\]\)/)?.[1]
assert.ok(externalClose, 'external window closes must reset synchronously')
let resets = 0
let hides = 0
let consumed = 0
const state = { query: 'unfinished input', surface: 'calculator', permission: true, selected: 3, host: true, tool: true, settings: true }
const sandbox = {
  clipboardBlock: { markBlockConsumed: () => consumed++ },
  clearPluginSurfaceTool: () => { state.tool = false },
  clearLauncherHostSurface: () => { state.host = false },
  useAppStore: { setState: (next) => Object.assign(state, next) },
  setSurfaceFrame: (next) => { state.surface = next },
  setItemPermissionFrame: (next) => { state.permission = next },
  usePluginSettingsStore: { getState: () => ({ settingsDialogTarget: { presentation: 'global-launcher' } }) },
  closeSettingsDialog: () => { state.settings = false },
  setSelectedObjectActionIndex: (next) => { state.selected = next },
  isImeComposingRef: { current: true },
  resetSession: () => { resets++; state.query = '' },
  closingRef: { current: false },
  trackBehavior: () => {}, TelemetryEvents: {}, queryTelemetryProps: () => ({}),
  inputRef: { current: null }, query: state.query, standaloneLauncher: true, overlay: false,
  restoreFocus: () => {}, setOpen: () => {}, window: {},
  closeGlobalLauncherWindow: async () => { hides++ },
}
vm.runInNewContext(ts.transpileModule(`
const resetLauncherSession = ${callback('resetLauncherSession')};
globalThis.close = ${callback('closeSession')};
globalThis.externalClose = ${externalClose}\n};
`, { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText, sandbox)

sandbox.close('esc-or-overlay')
assert.equal(state.query, '')
assert.equal(state.surface, null)
assert.equal(state.permission, null)
assert.equal(state.selected, 0)
assert.equal(state.host || state.tool || state.settings, false)
assert.equal(consumed, 1)
assert.equal(hides, 1)

// Native paste closes the store first; its late completion must not hide again.
sandbox.closingRef.current = false
state.query = 'another input'
sandbox.externalClose({ globalLauncherOpen: false }, { globalLauncherOpen: true })
sandbox.close('after-action')
assert.equal(state.query, '')
assert.equal(resets, 2)
assert.equal(consumed, 2)
assert.equal(hides, 1, 'external hide must not trigger a second native hide')

// A completed copy belongs to the surface that started it, not its replacement.
const renderer = readFileSync('src/components/pluginSurface/PluginSurfaceRenderer.tsx', 'utf8')
const completeBody = renderer.match(/complete: \(\) => \{([\s\S]*?)\n\s*\},/)?.[1]
assert.ok(completeBody)
let completed = 0
const target = { pluginId: 'qr-code' }
const activeTargetRef = { current: target }
const complete = vm.runInNewContext(`() => {${completeBody}}`, {
  presentation: 'global-launcher', mountedRef: { current: true },
  target, activeTargetRef, onClose: () => completed++,
})
activeTargetRef.current = { pluginId: 'csv' }
complete()
assert.equal(completed, 0, 'old copy must not close the new tool')
activeTargetRef.current = target
complete()
assert.equal(completed, 1, 'current tool must still complete normally')
console.log('launcher hide/reset behavior checks passed')
