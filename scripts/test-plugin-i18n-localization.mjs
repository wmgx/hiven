#!/usr/bin/env node
/**
 * Verifies plugin contribution localization covers every plugin-facing
 * contribution family that the launcher/registry reads from full definitions.
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

const stripTypeImports = [
  /import\s+type\s*\{[\s\S]*?\}\s*from\s*'[^']*'\s*;?\s*\n?/g,
]

const registry = loadModule('src/i18n/registry.ts', { stripImports: stripTypeImports })
const pluginI18n = loadModule('src/i18n/pluginI18nRegistry.ts', {
  stripImports: [
    ...stripTypeImports,
    /import\s*\{[^}]*\}\s*from\s*'\.\/registry'\s*;?\s*\n?/g,
    /export\s+type\s*\{[^}]*\}\s*from\s*'\.\/registry'\s*;?\s*\n?/g,
  ],
  globals: {
    registerMessages: registry.registerMessages,
    unregisterMessages: registry.unregisterMessages,
    getMessages: registry.getMessages,
    translate: registry.translate,
  },
})

pluginI18n.registerPluginMessages('demo', {
  en: {
    'tool.reverse.title': 'Reverse Lines',
    'tool.reverse.subtitle': 'Reverse line order',
    'launcher.open.title': 'Web Quick Open',
    'launcher.open.subtitle': 'Open with template',
    'launcher.open.placeholder': 'Search or URL',
    'launcher.open.empty': 'Please enter content',
    'panel.action.title': 'Apply',
    'settings.title': 'Plugin Settings',
  },
  zh: {
    'tool.reverse.title': '反转行',
    'tool.reverse.subtitle': '反转行顺序',
    'launcher.open.title': '网页快开',
    'launcher.open.subtitle': '用模板打开',
    'launcher.open.placeholder': '搜索或 URL',
    'launcher.open.empty': '请输入内容',
    'panel.action.title': '应用',
    'settings.title': '插件设置',
  },
})

const definition = {
  tools: [{
    id: 'reverse',
    title: 'tool.reverse.title',
    subtitle: 'tool.reverse.subtitle',
    run: () => ({ ok: true }),
  }],
  launcher: {
    items: [{
      id: 'open',
      display: {
        title: 'launcher.open.title',
        subtitle: 'launcher.open.subtitle',
      },
      behavior: {
        type: 'collect-input',
        input: {
          placeholder: 'launcher.open.placeholder',
          emptyInputMessage: 'launcher.open.empty',
        },
      },
      execute: () => ({ ok: true }),
    }],
  },
  panel: {
    actions: [{
      id: 'apply',
      title: 'panel.action.title',
      run: () => ({ ok: true }),
    }],
  },
  settings: {
    title: 'settings.title',
    defaultValue: {},
    component: () => null,
  },
}

const localized = pluginI18n.localizeContributions('demo', definition)

assert.equal(localized.tools[0].title, 'Reverse Lines', 'tool title should localize')
assert.equal(localized.tools[0].titleI18n.zh, '反转行', 'tool titleI18n should include zh')
assert.equal(localized.tools[0].subtitle, 'Reverse line order', 'tool subtitle should localize')
assert.equal(localized.definition.tools[0].title, 'Reverse Lines', 'localized definition should carry localized tools')

const item = localized.launcher.items[0]
assert.equal(item.display.title, 'Web Quick Open', 'launcher item title should localize')
assert.equal(item.display.titleI18n.zh, '网页快开', 'launcher item titleI18n should include zh')
assert.equal(item.display.subtitle, 'Open with template', 'launcher item subtitle should localize')
assert.equal(item.behavior.input.placeholder, 'Search or URL', 'collect-input placeholder should localize')
assert.equal(item.behavior.input.placeholderI18n.zh, '搜索或 URL', 'collect-input placeholderI18n should include zh')
assert.equal(item.behavior.input.emptyInputMessage, 'Please enter content', 'empty input message should localize')
assert.equal(localized.definition.launcher.items[0].display.title, 'Web Quick Open', 'localized definition should carry localized launcher items')

assert.equal(localized.panel.actions[0].title, 'Apply', 'panel action title should localize')
assert.equal(localized.settings.title, 'Plugin Settings', 'settings title should localize')

console.log('plugin i18n localization checks passed')
