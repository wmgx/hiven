#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)

function loadPlugin(path) {
  const source = readFileSync(path, 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
      esModuleInterop: true,
    },
  }).outputText
  const module = { exports: {} }
  const context = vm.createContext({
    BigInt,
    Number,
    RegExp,
    String,
    console,
    require(id) {
      if (id === '@hiven/plugin') return { definePlugin: (definition) => definition }
      return require(id)
    },
    module,
    exports: module.exports,
  })
  vm.runInContext(transpiled, context, { filename: path })
  return module.exports.default
}

async function runTextCommand(plugin, id, text, params = {}) {
  const command = plugin.commands?.find((item) => item.id === id)
  assert.ok(command, `${id} should exist`)
  const result = await command.run({
    inputs: { input: { kind: 'text', text, paneId: 'pane-test' } },
    params,
  })
  const replace = result.effects?.find((effect) => effect.type === 'text.replace')
  assert.ok(replace, `${id} should replace text`)
  assert.equal(replace.target?.paneId, 'pane-test', `${id} should write back to the source pane`)
  return replace.text
}

const calculator = loadPlugin('src/plugins/calculator/index.ts')
assert.ok(calculator.commands?.some((item) => item.id === 'calculator.base'), 'calculator should include number base conversion')
assert.equal(
  await runTextCommand(calculator, 'calculator.base', '9007199254740993', { mode: 'dec2hex' }),
  '20000000000001',
  'calculator base conversion should use BigInt precision',
)
assert.equal(
  await runTextCommand(calculator, 'calculator.base', '20000000000001', { mode: 'hex2dec' }),
  '9007199254740993',
  'calculator base conversion should convert large hex values back to decimal',
)

const lineAffix = loadPlugin('src/plugins/lineAffix/index.ts')
assert.deepEqual(
  Array.from(lineAffix.commands?.map((item) => item.id) ?? []),
  ['line-affix.prepend', 'line-affix.append', 'line-affix.wrap'],
  'line-affix should own prepend, append, and wrap commands',
)
assert.equal(
  await runTextCommand(lineAffix, 'line-affix.prepend', 'a\nb', { prefix: '- ' }),
  '- a\n- b',
  'line-affix prepend should add a prefix to each line',
)
assert.equal(
  await runTextCommand(lineAffix, 'line-affix.append', 'a\nb', { suffix: ',' }),
  'a,\nb,',
  'line-affix append should add a suffix to each line',
)
assert.equal(
  await runTextCommand(lineAffix, 'line-affix.wrap', 'a\nb', { left: '"', right: '"' }),
  '"a"\n"b"',
  'line-affix wrap should surround each line',
)

const lineTools = loadPlugin('src/plugins/lineTools/index.ts')
assert.deepEqual(
  Array.from(lineTools.commands?.map((item) => item.id) ?? []),
  [
    'line-tools.sort',
    'line-tools.dedup',
    'line-tools.reverse',
    'line-tools.remove-blank-lines',
    'line-tools.trim-whitespace',
    'line-tools.join',
  ],
  'line-tools should own the line transform commands',
)
assert.equal(
  await runTextCommand(lineTools, 'line-tools.sort', 'b\nA\na', { direction: 'asc', ignoreCase: true }),
  'A\na\nb',
  'line-tools sort should sort lines with optional case folding',
)
assert.equal(
  await runTextCommand(lineTools, 'line-tools.dedup', 'A\na\nb', { ignoreCase: true }),
  'A\nb',
  'line-tools dedup should remove duplicate lines with optional case folding',
)
assert.equal(
  await runTextCommand(lineTools, 'line-tools.reverse', 'a\nb\nc'),
  'c\nb\na',
  'line-tools reverse should reverse line order',
)
assert.equal(
  await runTextCommand(lineTools, 'line-tools.remove-blank-lines', 'a\n\n  \nb'),
  'a\nb',
  'line-tools should remove blank or whitespace-only lines',
)
assert.equal(
  await runTextCommand(lineTools, 'line-tools.trim-whitespace', '  a  \n b '),
  'a\nb',
  'line-tools should trim each line',
)
assert.equal(
  await runTextCommand(lineTools, 'line-tools.join', 'a\nb\nc', { separator: ', ' }),
  'a, b, c',
  'line-tools should join lines with a separator',
)

const builtinIndex = JSON.parse(readFileSync('src/builtin-plugins/index.json', 'utf8'))
const pluginIds = builtinIndex.packages.map((pkg) => pkg.pluginId)
assert.ok(pluginIds.includes('line-affix'), 'builtins should include line-affix')
assert.ok(pluginIds.includes('line-tools'), 'builtins should include line-tools')
for (const removed of ['hex', 'prepend', 'append', 'wrap', 'sort', 'dedup', 'reverse', 'remove-blank-lines', 'trim-whitespace', 'join']) {
  assert.equal(pluginIds.includes(removed), false, `builtins should no longer include ${removed}`)
}

console.log('plugin merge group checks passed')
