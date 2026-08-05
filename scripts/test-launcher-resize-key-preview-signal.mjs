#!/usr/bin/env node
/**
 * test-launcher-resize-key-preview-signal.mjs
 *
 * Regression test for a launcher resize bug: GlobalLauncherHost's
 * `controllerResizeKey` useMemo (src/launcher/hosts/GlobalLauncherHost.tsx)
 * derives a string key from `busy`, `frames.length`, top frame `kind`, and
 * `error` only. That key feeds a `useLayoutEffect` dependency array which
 * re-measures the launcher panel DOM and resizes the native window.
 *
 * For a collect-input tool (inputPolicy + behavior.type === 'perform', e.g.
 * calculator.sum), typing a value and letting `previewInput()` populate
 * `frame.previewOutput.choices` does NOT change busy/frames.length/kind/error
 * — so the resize key stays identical before and after new content appears,
 * the resize effect never re-fires, and the newly-appeared suggestion row
 * stays visually clipped.
 *
 * This script loads the REAL production modules (output.ts, toolAdapter.ts,
 * controller.ts, and the calculator plugin) via ts.transpileModule + vm,
 * reproduces the exact sequence a user hits, and asserts the resize key must
 * differ across that transition. This assertion is EXPECTED TO FAIL against
 * the current (unfixed) formula — it is a red test proving the bug exists.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

// Same loader pattern as scripts/test-launcher-registry.mjs: transpile a real
// .ts module to CommonJS and run it in a fresh vm context, injecting stubs
// for its external (non-type) imports as sandbox globals.
function loadModule(path, { stripImports = [], globals = {} } = {}) {
  let src = readFileSync(path, 'utf8')
  for (const re of stripImports) src = src.replace(re, '')
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
  }).outputText
  const moduleExports = {}
  const sandbox = { exports: moduleExports, module: { exports: moduleExports }, console, ...globals }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports
}

const stripTypeImports = [
  /import\s+type\s*\{[\s\S]*?\}\s*from\s*'[^']*'\s*;?\s*\n?/g,
]
const stripI18nImport = /import\s*\{\s*translate,\s*type\s+Locale\s*\}\s*from\s*'[^']*\/i18n'\s*;?\s*\n?/

// Minimal translate stub: only 'copied' is ever read by a closure we invoke
// (none of them run in this script), everything else falls back to the raw
// key, which is fine — we never assert on translated strings here.
const translate = (locale, namespace, key, vars = {}) => {
  const messages = { palette: { en: { copied: 'Copied' }, zh: { copied: '已复制' } } }
  let value = messages[namespace]?.[locale]?.[key] ?? messages[namespace]?.en?.[key] ?? key
  for (const [name, replacement] of Object.entries(vars)) value = value.replaceAll(`{${name}}`, String(replacement))
  return value
}

// --- output.ts (only depends on ../../i18n) ---
const output = loadModule('src/workspace/launcher/output.ts', {
  stripImports: [
    ...stripTypeImports,
    stripI18nImport,
    /import\s*\{\s*normalizeLauncherSurfaceId\s*\}\s*from\s*'\.\/types'\s*;?\s*\n?/,
  ],
  globals: {
    translate,
    normalizeLauncherSurfaceId: (surfaceId) => surfaceId === 'command-palette' ? 'editor-command-bar' : surfaceId,
  },
})

// --- toolAdapter.ts (depends on ./output + ./types) ---
const toolAdapter = loadModule('src/workspace/launcher/toolAdapter.ts', {
  stripImports: [
    ...stripTypeImports,
    /import\s*\{[^}]*\}\s*from\s*'\.\/output'\s*;?\s*\n?/,
    /import\s*\{[^}]*normalizeLauncherSurfaceId[^}]*\}\s*from\s*'\.\/types'\s*;?\s*\n?/,
  ],
  globals: {
    normalizeLauncherSurfaceId: (surfaceId) => surfaceId === 'command-palette' ? 'editor-command-bar' : surfaceId,
    textResult: output.textResult,
    replaceActiveTextResult: output.replaceActiveTextResult,
    errorResult: output.errorResult,
    choicesResult: output.choicesResult,
    REPLACE_ACTIVE_TEXT_OUTPUT_CHOICE_ID: output.REPLACE_ACTIVE_TEXT_OUTPUT_CHOICE_ID,
  },
})

// --- controller.ts (depends on ./types, ../pluginTypes, ../usageJournal, ./output, ../../i18n) ---
const controllerModule = loadModule('src/workspace/launcher/controller.ts', {
  stripImports: [
    ...stripTypeImports,
    stripI18nImport,
    /import\s*\{\s*appendUsageJournal\s*\}\s*from\s*'\.\.\/usageJournal'\s*;?\s*\n?/,
    /import\s*\{\s*isOutputResult\s*\}\s*from\s*'\.\/output'\s*;?\s*\n?/,
  ],
  globals: {
    translate,
    appendUsageJournal: async () => {},
    isOutputResult: output.isOutputResult,
  },
})
const { LauncherController } = controllerModule
assert.equal(typeof LauncherController, 'function', 'controller.ts must export LauncherController')

// --- calculator plugin (depends on bignumber.js + @hiven/plugin) ---
// bignumber.js is a real npm package; @hiven/plugin is the host SDK shim, stubbed
// per instructions. transpileModule turns both imports into require() calls, so we
// inject a `require` sandbox global that stubs @hiven/plugin and delegates the rest
// to Node's real require.
const nodeRequire = createRequire(import.meta.url)
function sandboxRequire(specifier) {
  if (specifier === '@hiven/plugin') {
    return {
      getPluginHostSdk: () => { throw new Error('not needed') },
      textOutput: (text) => ({ output: { kind: 'text', text } }),
      textError: (text) => ({ output: { kind: 'error', text } }),
    }
  }
  return nodeRequire(specifier)
}
const calculatorModule = loadModule('src/plugins/calculator/index.ts', {
  globals: { require: sandboxRequire },
})
const calculatorPlugin = calculatorModule.default
assert.ok(calculatorPlugin, 'calculator plugin must have a default export')
const sumTool = calculatorPlugin.tools.find((t) => t.id === 'calculator.sum')
assert.ok(sumTool, 'calculator.sum tool must exist')

// --- Reproduce the exact user-hit sequence ---
const item = toolAdapter.adaptToolToLauncherItem(sumTool, {
  pluginId: 'calculator',
  source: 'builtin',
  systemKey: 'plugin-tool:builtin:calculator:calculator.sum',
})

const fakeApi = {
  getActiveText: () => '',
  getSelectionText: () => '',
  getPaneSnapshot: () => ({ activePaneId: 'pane-1', paneIds: ['pane-1'], panes: {}, renderers: {} }),
  isPanePanelOpen: () => false,
  getClipboardText: async () => '',
  replaceActiveText: async () => {},
  insertText: async () => {},
  copyText: async () => {},
  openUrl: async () => {},
  showEditorWindow: async () => undefined,
  showPluginsPage: async () => {},
  showSettingsPage: async () => {},
  createPane: async () => undefined,
  dispatchEffects: () => ({ applied: [], errors: [] }),
  showMessage: () => {},
  openDiffPage: () => {},
  apps: {
    discoverApps: async () => [],
    cacheAppIcons: async () => 0,
    launchApp: async () => {},
  },
}

const controller = new LauncherController({
  surfaceId: 'global-launcher',
  api: fakeApi,
  locale: 'zh',
  makeT: () => (key) => key,
  getSettings: () => ({}),
  recordSelection: () => {},
  requestClose: () => {},
  onChange: () => {},
})

await controller.selectItem(item)
controller.setInputText('1 2 3')
const state0 = controller.getState()

await controller.previewInput()
const state1 = controller.getState()

// ─── Keep in sync with GlobalLauncherHost.tsx controllerResizeKey ───────────
// Signals empty-vs-has-preview only (not every previewInputText keystroke), so
// the native window does not thrash while results replace in place. Still must
// change when preview first appears (0 → 1).
function resizeKey(state) {
  const top = state.frames[state.frames.length - 1]
  const topKind = top?.kind ?? 'none'
  const previewSignal = top?.kind === 'collect-input'
    ? `:${top.inputText?.trim() ? 1 : 0}:${top.previewOutput?.choices?.length ? 1 : 0}`
    : ''
  return `${state.busy ? 1 : 0}:${state.frames.length}:${topKind}:${state.error ?? ''}${previewSignal}`
}

// --- Sanity: state1 genuinely has new preview content (sum of "1 2 3" = 6) ---
const top1 = state1.frames[state1.frames.length - 1]
assert.equal(top1.kind, 'collect-input', 'top frame after previewInput must still be collect-input')
assert.ok(top1.previewOutput, 'state1 must have a previewOutput after previewInput resolves')
assert.equal(top1.previewOutput.choices.length, 1, 'preview must contain exactly one choice (the sum result)')
assert.equal(top1.previewOutput.choices[0].title, '6', 'preview choice must be the computed sum of "1 2 3"')

// --- Sanity: state0 has no preview content yet (real before/after difference) ---
const top0 = state0.frames[state0.frames.length - 1]
assert.equal(top0.kind, 'collect-input', 'top frame after setInputText must be collect-input')
assert.ok(
  top0.previewOutput === undefined || top0.previewOutput.choices.length === 0,
  'state0 must have no preview choices yet',
)

// --- THE BUG ASSERTION ---
// Expected to FAIL on the current (unfixed) formula: busy/frames.length/topKind/error
// are identical across state0 -> state1 even though previewOutput.choices went from
// empty to populated, so the native window/body never re-measures and the new
// suggestion row stays visually clipped.
assert.notEqual(
  resizeKey(state0),
  resizeKey(state1),
  'resize key must change when collect-input preview choices appear, otherwise the native window/body never re-measures and the new content stays visually clipped',
)

console.log('✓ test-launcher-resize-key-preview-signal passed')
