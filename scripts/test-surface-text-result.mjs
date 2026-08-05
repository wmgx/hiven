#!/usr/bin/env node
/**
 * test-surface-text-result.mjs
 *
 * Regression test for output.ts's surfaceTextResult(text, api, locale, surfaceId):
 * the shared surface-aware picker between textResult (Global Launcher, no bound
 * pane) and replaceActiveTextResult (pane-bound surfaces). Exists because
 * src/workflow/pipelineLauncher.ts calls this across three different surfaces
 * (global-launcher, editor-command-bar, quick-editor-command) and must pick the
 * right one per surface, same as toolAdapter.ts's makeOutput() already does
 * internally for plugin tools. See doc/2026-07-20-launcher-text-result-secondary-actions-redesign.md §3.3.1.
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
const translate = (locale, namespace, key) => key

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

assert.equal(typeof output.surfaceTextResult, 'function', 'output.ts must export surfaceTextResult')

const fakeApi = {
  copyText: async () => {},
  replaceActiveText: async () => {},
  insertText: async () => {},
  returnToLauncher: async () => {},
  showMessage: () => {},
}

const globalChoice = output.surfaceTextResult('6', fakeApi, 'zh', 'global-launcher').output.choices[0]
assert.equal(globalChoice.secondaryActions[0].id, 'return-to-launcher', 'global-launcher surface must resolve to textResult (return-to-launcher secondary action)')

for (const surfaceId of ['editor-command-bar', 'quick-editor-command', 'command-palette']) {
  const choice = output.surfaceTextResult('6', fakeApi, 'zh', surfaceId).output.choices[0]
  const ids = choice.secondaryActions.map((a) => a.id)
  assert.deepEqual(JSON.parse(JSON.stringify(ids)), ['copy', 'insert'], `surface "${surfaceId}" must resolve to replaceActiveTextResult (copy+insert), got [${ids.join(', ')}]`)
}

console.log('✓ test-surface-text-result passed')
