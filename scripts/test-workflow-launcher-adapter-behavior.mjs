#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const refactorSuite = readFileSync('scripts/test-refactor-suite.mjs', 'utf8')

assert.equal(
  packageJson.scripts?.['test:workflow-launcher-adapter-behavior'],
  'node scripts/test-workflow-launcher-adapter-behavior.mjs',
  'package.json must expose test:workflow-launcher-adapter-behavior',
)
assert.match(
  refactorSuite,
  /test:workflow-launcher-adapter-behavior/,
  'refactor suite must include workflow launcher adapter behavior coverage',
)

function loadWorkflowLauncherAdapter(globals) {
  let src = readFileSync('src/workflow/workflowLauncherAdapter.ts', 'utf8')
  src = src.replace(/import\s+type\s*\{[\s\S]*?\}\s*from\s*'[^']*'\s*;?\s*\n?/g, '')
  src = src.replace(/import\s*\{[\s\S]*?\}\s*from\s*'[^']*'\s*;?\s*\n?/g, '')
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

const calls = {
  collected: 0,
  actionInputs: [],
  ran: [],
}
const objects = [
  {
    id: 'context:selected-text',
    type: 'text',
    title: 'Selected Text',
    subtitle: 'hello world',
    source: 'context.external-selection',
    text: 'hello world',
  },
  {
    id: 'surface:json',
    type: 'plugin-surface',
    title: 'JSON Surface',
    subtitle: 'builtin json',
    source: 'surface-registry',
    pluginId: 'json',
    surfaceId: 'main',
  },
  {
    id: 'app:macos:path:3e9d62fe57f412e8',
    type: 'app',
    title: 'Microsoft Excel',
    subtitle: '/Applications/Microsoft Excel.app',
    source: 'host.app-index',
    bundleId: 'macos:path:3e9d62fe57f412e8',
    executablePath: '/Applications/Microsoft Excel.app',
  },
]
const registryActions = [
  {
    id: 'workflow.copy',
    title: 'Copy',
    accepts: ['text'],
    defaultOutputTarget: 'copy',
    run: async (input, ctx) => {
      calls.ran.push({ actionId: 'workflow.copy', objectId: input.id, source: ctx.snapshot.invocation.source })
      return { ok: true, text: input.text }
    },
  },
  {
    id: 'workflow.open-in-editor',
    title: 'Open in Editor',
    accepts: ['text'],
    defaultOutputTarget: 'open-in-editor',
    run: async (input, ctx) => {
      calls.ran.push({ actionId: 'workflow.open-in-editor', objectId: input.id, source: ctx.snapshot.invocation.source })
      return { ok: true, text: input.text }
    },
  },
]

const adapter = loadWorkflowLauncherAdapter({
  searchableFieldsMatch: (fields, query) => [fields.id, fields.title, ...(fields.aliases ?? [])]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query)),
  resolveIconForWorkObject: (object) => `icon:${object.type}`,
  createDefaultWorkContextSnapshot: async (source) => ({ invocation: { source, timestamp: 123 } }),
  collectWorkObjects: async () => {
    calls.collected += 1
    return objects
  },
  getWorkActions: async (object, ctx) => {
    calls.actionInputs.push({ objectId: object.id, source: ctx.snapshot.invocation.source })
    return object.type === 'text' ? registryActions : []
  },
})

const defaultItems = await adapter.getWorkflowObjectLauncherItems({ query: '', locale: 'en' })
assert.deepEqual(
  JSON.parse(JSON.stringify(defaultItems.map((item) => item.systemKey))),
  ['workflow:object:context:selected-text'],
  'empty global launcher query must show current context objects by default, not every surface',
)

const [selectedTextItem] = defaultItems
assert.equal(selectedTextItem.display.title, 'Selected Text')
assert.equal(selectedTextItem.display.icon, 'icon:text')
assert.equal(selectedTextItem.display.subtitle, 'hello world')
assert.deepEqual(JSON.parse(JSON.stringify(selectedTextItem.metadata)), {
  kind: 'workflow-object',
  objectId: 'context:selected-text',
  objectType: 'text',
})

const searchedItems = await adapter.getWorkflowObjectLauncherItems({ query: 'json', locale: 'en' })
assert.deepEqual(
  JSON.parse(JSON.stringify(searchedItems.map((item) => item.systemKey))),
  ['workflow:object:surface:json'],
  'non-empty launcher query must search all workflow objects by title/aliases',
)

const excelItems = await adapter.getWorkflowObjectLauncherItems({ query: 'excel', locale: 'en' })
assert.deepEqual(
  JSON.parse(JSON.stringify(excelItems.map((item) => item.systemKey))),
  [],
  'installed apps must not appear as workflow objects (host app launcher owns them)',
)

const hashLeakItems = await adapter.getWorkflowObjectLauncherItems({ query: '12', locale: 'en' })
assert.deepEqual(
  JSON.parse(JSON.stringify(hashLeakItems.map((item) => item.systemKey))),
  [],
  'workflow search must not match apps via path-hash ids',
)

const result = await selectedTextItem.execute()
assert.equal(result.ok, true)
assert.equal(result.keepOpen, true)
assert.deepEqual(JSON.parse(JSON.stringify(calls.actionInputs)), [
  { objectId: 'context:selected-text', source: 'global-hotkey' },
])
const choices = result.output.choices
assert.deepEqual(JSON.parse(JSON.stringify(choices.map((choice) => ({
  id: choice.id,
  title: choice.title,
  subtitle: choice.subtitle,
  metadata: choice.metadata,
})))), [
  {
    id: 'context:selected-text:workflow.copy',
    title: 'Copy',
    subtitle: 'Selected Text · Output: copy',
    metadata: {
      kind: 'workflow-action',
      objectId: 'context:selected-text',
      actionId: 'workflow.copy',
      outputTarget: 'copy',
    },
  },
  {
    id: 'context:selected-text:workflow.open-in-editor',
    title: 'Open in Editor',
    subtitle: 'Selected Text · Output: open-in-editor',
    metadata: {
      kind: 'workflow-action',
      objectId: 'context:selected-text',
      actionId: 'workflow.open-in-editor',
      outputTarget: 'open-in-editor',
    },
  },
])

const actionResult = await choices[1].primaryAction()
assert.deepEqual(JSON.parse(JSON.stringify(actionResult)), { ok: true, text: 'hello world' })
assert.deepEqual(JSON.parse(JSON.stringify(calls.ran)), [
  { actionId: 'workflow.open-in-editor', objectId: 'context:selected-text', source: 'global-hotkey' },
])

console.log('workflow launcher adapter behavior checks passed')
