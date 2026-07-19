#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const refactorSuite = readFileSync('scripts/test-refactor-suite.mjs', 'utf8')

assert.equal(
  packageJson.scripts?.['test:workflow-context-routing-story'],
  'node scripts/test-workflow-context-routing-story.mjs',
  'package.json must expose test:workflow-context-routing-story',
)
assert.match(
  refactorSuite,
  /test:workflow-context-routing-story/,
  'refactor suite must include current-context workflow routing story coverage',
)

function loadTsModule(path, globals = {}, append = '') {
  let src = readFileSync(path, 'utf8')
  src = src.replace(/import\s+type\s*\{[\s\S]*?\}\s*from\s*'[^']*'\s*;?\s*\n?/g, '')
  src = src.replace(/import\s*\{[\s\S]*?\}\s*from\s*'[^']*'\s*;?\s*\n?/g, '')
  src += append
  const out = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
      esModuleInterop: true,
    },
  }).outputText
  const moduleExports = {}
  const sandbox = { exports: moduleExports, module: { exports: moduleExports }, console, ...globals }
  vm.runInNewContext(out, sandbox, { filename: path })
  return sandbox
}

const timestamp = 1770000000000
const routedOutputs = []
const quickEditorPanes = []
const pluginSurfaceWindows = []
const snapshot = {
  invocation: { source: 'global-hotkey', timestamp },
  editor: {
    windowLabel: 'editor',
    activePaneId: 'pane-1',
    selectedText: 'Existing editor selection',
    language: 'markdown',
    selectionRange: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 10 },
  },
  clipboard: { kind: 'text', text: '{"ok":true}' },
  foreground: { appName: 'Browser', bundleId: 'com.apple.Safari' },
}

const providerSandbox = loadTsModule('src/workflow/defaultWorkflowProviders.ts', {
  createDefaultWorkContextSnapshot: async (source) => {
    assert.equal(source, 'global-hotkey')
    return snapshot
  },
  focusSurfaceInstance: async () => true,
  getSurfaceInstances: () => [],
  useAppStore: { getState: () => ({ locale: 'en' }) },
  getHostAppWorkObjects: () => [],
  launchHostAppObject: async () => {},
  createQuickEditorPane: async (input) => {
    quickEditorPanes.push(input)
    return 'pane-created'
  },
  showQuickEditorSurface: async () => {},
  showPluginSurfaceWindow: async (input) => {
    pluginSurfaceWindows.push(input)
  },
  PLUGIN_SURFACE_PANEL_ID: 'plugin-surface',
  registerClipboardHistoryWorkflowProvider: () => {},
  registerWorkObjectProvider: () => {},
  registerWorkActionProvider: () => {},
  createDefaultOutputRouterContext: () => ({ marker: 'router-context' }),
  routeTextOutput: async (text, target, ctx) => {
    routedOutputs.push({ text, target, ctx })
    return { ok: true, text }
  },
  EDITOR_WINDOW_LABEL: 'editor',
}, '\n;globalThis.__workflowStoryProviders = { currentContextObjectProvider, defaultTextActionProvider };')

const { currentContextObjectProvider, defaultTextActionProvider } = providerSandbox.__workflowStoryProviders
const contextObjects = await currentContextObjectProvider.collect()

// context:external-selected-text is [DISABLED] — use context:selected-text instead
const selectedTextObject = contextObjects.find((object) => object.id === 'context:selected-text')
assert.ok(selectedTextObject, 'context:selected-text should be collected from editor selection')
assert.deepEqual(JSON.parse(JSON.stringify(selectedTextObject)), {
  id: 'context:selected-text',
  type: 'text',
  title: 'Selected Text',
  subtitle: 'Existing editor selection',
  icon: 'TextSelect',
  source: 'context.editor-selection',
  text: 'Existing editor selection',
  language: 'markdown',
  updatedAt: timestamp,
})

function requirementsSatisfied(action, ctx) {
  return !action.requiresContext || action.requiresContext.every((requirement) => {
    if (requirement.kind === 'selected-text') return Boolean(ctx.snapshot.editor?.selectedText || ctx.snapshot.externalSelection?.text)
    if (requirement.kind === 'clipboard') return Boolean(ctx.snapshot.clipboard)
    if (requirement.kind === 'editor-pane') return Boolean(ctx.snapshot.editor)
    if (requirement.kind === 'foreground-app') return Boolean(ctx.snapshot.foreground)
    return false
  })
}

const adapterSandbox = loadTsModule('src/workflow/workflowLauncherAdapter.ts', {
  searchableFieldsMatch: (fields, query) => [fields.id, fields.title, ...(fields.aliases ?? [])]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query)),
  resolveIconForWorkObject: (object) => `icon:${object.type}`,
  createDefaultWorkContextSnapshot: async (source) => {
    assert.equal(source, 'global-hotkey')
    return snapshot
  },
  collectWorkObjects: async () => contextObjects,
  getWorkActions: async (input, ctx) => defaultTextActionProvider
    .getActions(input, ctx)
    .filter((action) => action.accepts.includes(input.type))
    .filter((action) => requirementsSatisfied(action, ctx)),
  t: (locale, key) => key,
})

const { getWorkflowObjectLauncherItems } = adapterSandbox.module.exports
const launcherItems = await getWorkflowObjectLauncherItems({ query: '', locale: 'en' })
const selectedTextItem = launcherItems.find((item) => item.systemKey === 'workflow:object:context:selected-text')
assert.ok(selectedTextItem, 'global launcher should expose the editor selection as a default context object')
assert.equal(selectedTextItem.display.subtitle, 'Existing editor selection')

const expanded = await selectedTextItem.execute()
assert.equal(expanded.keepOpen, true)
const choices = expanded.output.choices
const choicesByAction = new Map(choices.map((choice) => [choice.metadata.actionId, choice]))

for (const [actionId, outputTarget] of [
  ['workflow.open-in-editor', 'open-in-editor'],
  ['workflow.paste', 'paste-to-foreground-app'],
  ['workflow.replace-selection', 'replace-editor-selection'],
  ['workflow.insert-editor', 'insert-into-editor'],
  ['workflow.attach-translate-panel', 'attach-editor-panel'],
  ['workflow.open-editor-with-translate-panel', 'open-in-editor'],
]) {
  const choice = choicesByAction.get(actionId)
  assert.ok(choice, `${actionId} should be available for an editor selected-text object with foreground/editor context`)
  assert.equal(choice.metadata.objectId, 'context:selected-text')
  assert.equal(choice.metadata.outputTarget, outputTarget)
}

await choicesByAction.get('workflow.attach-translate-panel').primaryAction()
assert.equal(routedOutputs.at(-1).text, 'Existing editor selection')
assert.deepEqual(JSON.parse(JSON.stringify(routedOutputs.at(-1).target)), {
  kind: 'attach-editor-panel',
  panelId: 'plugin-surface',
  placement: 'right',
  pluginSurfaceTarget: {
    source: 'builtin',
    pluginId: 'translate',
    surfaceId: 'main',
    initialText: 'Existing editor selection',
  },
})

await choicesByAction.get('workflow.open-editor-with-translate-panel').primaryAction()
assert.deepEqual(JSON.parse(JSON.stringify(quickEditorPanes.at(-1))), {
  text: 'Existing editor selection',
  language: 'markdown',
})
assert.deepEqual(JSON.parse(JSON.stringify(pluginSurfaceWindows.at(-1))), {
  source: 'builtin',
  pluginId: 'translate',
  surfaceId: 'main',
  initialText: 'Existing editor selection',
})

console.log('workflow context routing story checks passed')
