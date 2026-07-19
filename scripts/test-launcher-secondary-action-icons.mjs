#!/usr/bin/env node
/**
 * test-launcher-secondary-action-icons.mjs
 *
 * Regression test: the collect-input suggest row (GlobalLauncherCollectInputFrame.tsx)
 * renders every LauncherResultChoice.secondaryActions entry as a generic "×" glyph
 * button, regardless of what the action actually does. That glyph is correct for
 * genuinely destructive actions (close window, delete clipboard-history entry —
 * see src/plugins/web-open/index.tsx and src/workspace/desktopTargets/types.ts),
 * but output.ts's textResult()/replaceActiveTextResult() attach non-destructive
 * secondary actions ("replace active text", "insert", "copy") that also rendered
 * as "×", which reads as two delete buttons next to a calculator result.
 *
 * Fix: LauncherResultAction gains an optional `icon` field; textResult/
 * replaceActiveTextResult set it to a semantically matching lucide icon name.
 * Actions that don't set `icon` (window close, history delete, etc.) keep
 * rendering the literal "×" fallback in the component — untouched by this test.
 *
 * This loads the REAL src/workspace/launcher/output.ts module (same loader
 * pattern as scripts/test-launcher-registry.mjs) and asserts on the icon field
 * of each secondary action.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

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

const stripTypeImports = [/import\s+type\s*\{[\s\S]*?\}\s*from\s*'[^']*'\s*;?\s*\n?/g]
const stripI18nImport = /import\s*\{\s*translate,\s*type\s+Locale\s*\}\s*from\s*'[^']*\/i18n'\s*;?\s*\n?/
const translate = (locale, namespace, key) => key // titles aren't under test here

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

const fakeApi = {
  replaceActiveText: async () => {},
  copyText: async () => {},
  insertText: async () => {},
  returnToLauncher: async () => {},
  showMessage: () => {},
}

// --- textResult (Global Launcher): primary = copy, secondary = [return-to-launcher] only ---
const textChoice = output.textResult('6', fakeApi, 'zh').output.choices[0]
assert.equal(textChoice.secondaryActions.length, 1, 'textResult must expose exactly one secondary action (no more fake replace/insert duo)')
const returnAction = textChoice.secondaryActions[0]
assert.equal(returnAction.id, 'return-to-launcher', 'the single secondary action must be return-to-launcher')
assert.equal(returnAction.icon, 'CornerDownLeft', 'return-to-launcher must carry a CornerDownLeft icon, not the generic × fallback')

// run() must call api.returnToLauncher with the result text, and signal the
// controller to stay open (popped back to the root list, not closed) —
// see controller.ts's keepOpen handling for collect-input frames without `suggest`.
let returnToLauncherCalledWith
const spyApi = { ...fakeApi, returnToLauncher: async (text) => { returnToLauncherCalledWith = text } }
const spiedChoice = output.textResult('6', spyApi, 'zh').output.choices[0]
const runResult = await spiedChoice.secondaryActions[0].run()
assert.equal(returnToLauncherCalledWith, '6', 'return-to-launcher action must call api.returnToLauncher(text) with the result text')
assert.deepEqual(JSON.parse(JSON.stringify(runResult)), { ok: true, keepOpen: true }, 'return-to-launcher action must return { ok: true, keepOpen: true } so the launcher stays open')

// --- replaceActiveTextResult (pane-bound): primary = replace, secondary = [copy, insert] ---
const replaceChoice = output.replaceActiveTextResult('6', fakeApi, 'zh').output.choices[0]
assert.equal(replaceChoice.secondaryActions.length, 2, 'replaceActiveTextResult must expose copy + insert')
const byId = Object.fromEntries(replaceChoice.secondaryActions.map((a) => [a.id, a]))
assert.equal(byId['copy']?.icon, 'Copy', '"copy" secondary action must carry a Copy icon')
assert.equal(byId['insert']?.icon, 'TextCursorInput', '"insert" secondary action must carry a TextCursorInput icon (newly exposed, real insertText behavior)')

let insertCalledWith
const spyApi2 = { ...fakeApi, insertText: async (text) => { insertCalledWith = text } }
const spiedReplaceChoice = output.replaceActiveTextResult('6', spyApi2, 'zh').output.choices[0]
await spiedReplaceChoice.secondaryActions.find((a) => a.id === 'insert').run()
assert.equal(insertCalledWith, '6', '"insert" action must call api.insertText(text) with the result text')

console.log('✓ test-launcher-secondary-action-icons passed')
