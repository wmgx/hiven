#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function load(path) {
  let src = readFileSync(path, 'utf8')
  src = src.replace(/import[\s\S]*?from\s*['"][^'"]+['"];?\n/g, '')
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
  }).outputText
  const moduleExports = {}
  vm.runInNewContext(out, {
    exports: moduleExports,
    module: { exports: moduleExports },
    console,
    Date,
    String,
    Math,
    Object,
    Array,
    RegExp,
  })
  return moduleExports
}

const expand = load('src/plugins/snippets/expand.ts')
const model = load('src/plugins/snippets/model.ts')

const fixed = new Date('2026-08-01T15:04:05')
assert.equal(
  expand.expandSnippetTemplate('Hi {clipboard} on {date}', {
    clipboard: 'world',
    now: fixed,
  }),
  'Hi world on 2026-08-01',
)
assert.equal(
  expand.expandSnippetTemplate('{time} / {datetime}', { now: fixed }),
  '15:04:05 / 2026-08-01 15:04:05',
)
assert.equal(
  expand.expandSnippetTemplate('keep {unknown}', {}),
  'keep {unknown}',
)

const settings = model.normalizeSnippetsSettings({
  enabled: true,
  snippets: [{ id: 'a', title: 'A', body: 'x', aliases: ['a'], enabled: true }],
})
assert.equal(model.enabledSnippets(settings).length, 1)
assert.equal(model.enabledSnippets({ ...settings, enabled: false }).length, 0)

// Source contracts
const index = readFileSync('src/plugins/snippets/index.ts', 'utf8')
assert.match(index, /toolsFor/)
assert.match(index, /expandSnippetTemplate/)
assert.doesNotMatch(index, /inputPolicy/, 'snippets should expand immediately from selection or clipboard')
const manifest = JSON.parse(readFileSync('src/plugins/snippets/manifest.json', 'utf8'))
assert.equal(manifest.pluginId, 'snippets')

console.log('✓ test-snippets-expand passed')
