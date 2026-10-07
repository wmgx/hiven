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
const routeIds = ['to-json', 'to-array', 'to-columns', 'to-keyed', 'to-ndjson', 'to-csv', 'to-tsv', 'to-markdown', 'to-sql']
const surfaces = plugin.ui.surfaces
assert.deepEqual(Array.from(surfaces, surface => surface.id), ['main', ...routeIds])
assert.deepEqual(Array.from(plugin.launcher.items, item => item.id), routeIds.map(id => `open-${id}`))
assert.equal(factories.length, 1)
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
for (const [index, item] of plugin.launcher.items.entries()) {
  const calls = []
  const api = { openSurface: (...args) => calls.push(args) }
  for (const text of [material, '', undefined]) {
    const result = item.execute({ api, input: text === undefined ? undefined : { text } })
    assert.equal(result.ok, true)
    assert.equal(result.keepOpen, true)
    const call = calls.at(-1)
    assert.equal(call[0], routeIds[index])
    assert.equal(call[1].initialText, text)
  }
  assert.equal(surfaces[index + 1].entry.launcher, false)
  assert.equal(surfaces[index + 1].shell, main.shell)
}
assert.equal(imports.length, 0, 'Matching and executing routes must leave loading to the surface host')

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
    const child = React.Children.only(element.props.children)
    assert.equal(child.type, lazyComponents[0])
    assert.deepEqual(Object.keys(child.props).sort(), Object.keys(props).sort())
    for (const key of Object.keys(props)) assert.equal(child.props[key], props[key], `${surface.id}: ${key}`)
  }
}
assert.equal(imports.length, 0)
const loaded = await factories[0]()
assert.equal(loaded.default, surfaceImplementation)
assert.deepEqual(imports, ['./CsvSurface'])
console.log('PASS CSV registration, matcher, all nine operation routes, and lazy surface context forwarding')
