#!/usr/bin/env node
/**
 * Verifies Web Quick Open exposes user-configured settings entries through
 * launcher.dynamicItems, so custom links are searchable at runtime.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function loadModule(path, { stripImports = [], globals = {} } = {}) {
  let src = readFileSync(path, 'utf8')
  for (const re of stripImports) src = src.replace(re, '')
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const moduleExports = {}
  const sandbox = { exports: moduleExports, module: { exports: moduleExports }, console, ...globals }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports
}

const stripTypeImports = [
  /import\s+type\s*\{[\s\S]*?\}\s*from\s*'[^']*'\s*;?\s*\n?/g,
]

const model = loadModule('src/plugins/web-open/settings/model.ts', { stripImports: stripTypeImports })
const launcherTypesSource = readFileSync('src/workspace/launcher/types.ts', 'utf8')
const launcherRegistrySource = readFileSync('src/workspace/launcher/registry.ts', 'utf8')
const launcherSessionSource = readFileSync('src/workspace/launcher/useLauncherSession.ts', 'utf8')
const webOpen = loadModule('src/plugins/web-open/index.tsx', {
  stripImports: [
    ...stripTypeImports,
    /import\s*\{[\s\S]*?\}\s*from\s*'@hiven\/plugin'\s*;?\s*\n?/g,
    /import\s*\{[\s\S]*?\}\s*from\s*'\.\/settings\/model'\s*;?\s*\n?/g,
    /import\s*\{[\s\S]*?\}\s*from\s*'\.\/faviconCache'\s*;?\s*\n?/g,
  ],
  globals: {
    definePlugin: (definition) => definition,
    buildWebQuickOpenUrl: model.buildWebQuickOpenUrl,
    DEFAULT_WEB_QUICK_OPEN_SETTINGS: model.DEFAULT_WEB_QUICK_OPEN_SETTINGS,
    extractDomain: (url) => {
      try {
        return new URL(url).hostname
      } catch {
        return undefined
      }
    },
    getFaviconIcon: async () => 'Globe',
    FALLBACK_ICON: 'Globe',
  },
})

const definition = webOpen.default
assert.ok(definition.launcher.dynamicItems, 'web-open should provide runtime dynamic launcher items')
assert.doesNotMatch(
  launcherTypesSource,
  /LauncherDynamicContext[\s\S]*clipboardText/,
  'LauncherDynamicContext should expose only host-resolved query text to plugins',
)
assert.doesNotMatch(
  launcherRegistrySource,
  /clipboardText/,
  'launcher registry should not pass source-specific clipboardText to plugin dynamic providers',
)
assert.match(
  launcherSessionSource,
  /const inputText = q \|\| objectBlockText\?\.trim\(\) \|\| ''[\s\S]*collectDynamicItems\(q,\s*normalizedHostId,\s*locale,\s*getPluginSettings,\s*inputText\)/,
  'launcher session should resolve query vs Object Block before invoking plugin dynamic providers',
)

const settings = {
  enabled: true,
  entries: [
    ...model.DEFAULT_WEB_QUICK_OPEN_SETTINGS.entries,
    {
      id: 'github-issues',
      title: 'GitHub Issues',
      aliases: ['gh', 'issues'],
      placeholder: 'Issue id',
      urlTemplate: 'https://github.com/acme/project/issues/{query}',
      encodeQuery: true,
      emptyQueryBehavior: 'block',
    },
    {
      id: 'log-detail',
      title: 'Log Detail',
      aliases: ['log'],
      placeholder: 'Log id',
      urlTemplate: 'https://logs.example.com/detail/{query}',
      encodeQuery: false,
      emptyQueryBehavior: 'block',
      matchPattern: '^20\\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\\d|3[01])([01]\\d|2[0-3])[0-5]\\d[0-5]\\d[A-F0-9]{20}$',
    },
  ],
}

const items = await definition.launcher.dynamicItems({ query: 'gh', locale: 'en', settings })
assert.equal(items.length, 1, 'custom settings entry should be searchable by alias')
assert.equal(items[0].id, 'github-issues')
assert.equal(items[0].display.title, 'GitHub Issues')
assert.equal(items[0].behavior.type, 'collect-input')
assert.equal(items[0].behavior.input.placeholder, 'Issue id')

const defaultMatches = await definition.launcher.dynamicItems({
  query: 'google',
  locale: 'en',
  settings,
})
assert.equal(defaultMatches.length, 0, 'unchanged default static entries should not be duplicated as dynamic items')

const urlMatches = await definition.launcher.dynamicItems({
  query: 'acme/project',
  locale: 'en',
  settings,
})
assert.equal(urlMatches.length, 1, 'custom settings entry should be searchable by URL template')

const sampleLogId = '20260702192928EC9CFA9EFD91F021E1EB'
const logMatches = await definition.launcher.dynamicItems({
  query: sampleLogId,
  locale: 'en',
  settings,
  storage: {},
  source: 'builtin',
  pluginId: 'web-open',
  t: (key) => key,
})
assert.equal(logMatches.length, 1, 'host-provided input text should trigger regex-backed one-step web-open entries')
assert.equal(logMatches[0].id, 'log-detail-quick')
assert.equal(logMatches[0].behavior.type, 'perform')

let openedUrl = ''
await items[0].execute({
  input: { text: '123' },
  settings,
  locale: 'en',
  api: {
    getActiveText: () => '',
    getSelectionText: () => '',
    getPaneSnapshot: () => ({ activePaneId: 'pane-1', paneIds: ['pane-1'], panes: {}, renderers: {} }),
    isPanePanelOpen: () => false,
    getClipboardText: async () => '',
    replaceActiveText: async () => {},
    insertText: async () => {},
    copyText: async () => {},
    openUrl: async (url) => { openedUrl = url },
    showMessage: () => {},
    showEditorWindow: async () => {},
    showPluginsPage: async () => {},
    showSettingsPage: async () => {},
    createPane: () => 'pane-new',
    dispatchEffects: () => ({ applied: [], errors: [] }),
    apps: {
      discoverApps: async () => [],
      cacheAppIcons: async () => 0,
      launchApp: async () => {},
    },
  },
  t: (key) => key,
})
assert.equal(openedUrl, 'https://github.com/acme/project/issues/123', 'dynamic item should open the runtime settings URL')

const disabledItems = definition.launcher.dynamicItems({
  query: 'gh',
  locale: 'en',
  settings: { ...settings, enabled: false },
})
assert.equal((await disabledItems).length, 0, 'disabled web-open settings should suppress dynamic quick-open items')

console.log('web-open dynamic launcher item checks passed')
