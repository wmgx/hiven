#!/usr/bin/env node
// Execute the real plugin entry. Capture React's lazy factory without mounting UI;
// the production-build graph check separately verifies the emitted import boundary.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as React from 'react'

const factories = []
const imports = []
const surfaceImplementation = () => null
const compiled = ts.transpileModule(fs.readFileSync('src/plugins/csv/index.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  transformers: { before: [context => {
    const visit = node => {
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        return ts.factory.updateCallExpression(node, ts.factory.createIdentifier('__importModule'), node.typeArguments, node.arguments)
      }
      return ts.visitEachChild(node, visit, context)
    }
    return node => ts.visitNode(node, visit)
  }] },
}).outputText
const module = { exports: {} }
const lazyComponents = []
vm.runInNewContext(compiled, {
  module, exports: module.exports,
  require(name) {
    if (name === '@hiven/plugin') return { definePlugin: definition => definition }
    if (name === 'react') return { ...React, lazy(factory) {
      factories.push(factory)
      const component = React.lazy(factory)
      lazyComponents.push(component)
      return component
    } }
    if (name === './entryLoader') return { createEntryLoader: read => ({ read }), identifyStylesheetFailure() {}, EntryStylesheetError: Error }
    if (name.startsWith('./locales/')) return { default: JSON.parse(fs.readFileSync(`src/plugins/csv/${name.slice(2)}`, 'utf8')) }
    if (name === './style.css') return {}
    throw new Error(`Unexpected eager dependency: ${name}`)
  },
  async __importModule(name) {
    imports.push(name)
    assert.equal(name, './CsvSurface')
    return { CsvSurface: surfaceImplementation }
  },
}, { filename: 'csv/index.ts' })
const plugin = module.exports.csvPlugin
const surfaces = plugin.ui.surfaces
assert.deepEqual(Array.from(surfaces, surface => surface.id), ['main'])
assert.equal(factories.length, 0)
assert.equal(imports.length, 0, 'Registering CSV must not load the table implementation')

const main = surfaces[0]
for (const input of ['name,age\nAda,37', 'a\tb\n1\t2', 'a;b\n1;2', 'a|b\n1|2', '"a,b",c\n"d,e",f', '/tmp/table.csv', 'file:///tmp/table.tsv', 'table.CSV']) {
  assert.equal(main.textMatch(input), true, input)
}
for (const input of ['', 'hello', 'a,b', 'a\nb', 'not a table\nplain text']) {
  assert.equal(main.textMatch(input), false, input)
}
assert.deepEqual(Array.from(main.entry.launcher.surfaces), ['global-launcher'])
assert.equal(main.entry.shortcutBindable, true)
const material = 'name,age\nAda,37'
// A component adapter must preserve host API identity and every route/context
// field. This inspects passed arguments only, not rendered DOM or UI structure.
for (const locale of ['en', 'zh']) {
  const messages = JSON.parse(fs.readFileSync(`src/plugins/csv/locales/${locale}.json`, 'utf8'))
  for (const surface of surfaces) {
    const props = {
      pluginId: 'csv', surfaceId: surface.id, locale, t: key => messages[key],
      settings: {}, permissions: {}, appearance: { theme: 'dark', fontSize: 14, lineNumbers: true, wordWrap: false },
      host: { requestBack() {} }, initialText: material,
    }
    const element = surface.component(props)
    const instance = new element.type(element.props)
    const child = React.Children.only(instance.render().props.children)
    assert.equal(child.type, lazyComponents.at(-1))
    assert.deepEqual(Object.keys(child.props).sort(), Object.keys(props).sort())
    for (const key of Object.keys(props)) assert.equal(child.props[key], props[key], `${surface.id}: ${key}`)
  }
}
assert.equal(imports.length, 0)
const loaded = await factories[0]()
assert.equal(loaded.default, surfaceImplementation)
assert.deepEqual(imports, ['./CsvSurface'])
console.log('PASS CSV registration, matcher, lazy surface context forwarding')
