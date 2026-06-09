#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync('src/plugins/calculator/index.ts', 'utf8')
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2023,
    esModuleInterop: true,
  },
}).outputText

const module = { exports: {} }
const context = vm.createContext({
  Number,
  Math,
  String,
  RegExp,
  isFinite,
  isNaN,
  module,
  exports: module.exports,
})

vm.runInContext(transpiled, context, { filename: 'calculator.js' })

const plugin = module.exports.default
const command = plugin.commands?.find((item) => item.id === 'calculator.run')
assert.ok(command, 'calculator should expose calculator.run command mode')
assert.equal(
  command.inputs?.some((input) => input.key === 'input' && input.kind === 'text' && input.required),
  true,
  'calculator command should accept the active editor text as input',
)
assert.equal(command.inputResolution?.strategy, 'use-active', 'calculator command should use the active editor by default')
assert.equal(command.inputResolution?.fallback, 'fail', 'calculator command should fail when active editor input is unavailable')

async function runCalculatorCommand(text) {
  const result = await command.run({
    inputs: { input: { kind: 'text', text, paneId: 'pane-test' } },
    params: {},
  })
  const replace = result.effects?.find((effect) => effect.type === 'text.replace')
  assert.ok(replace, 'calculator command should replace the editor text')
  assert.equal(replace.target?.paneId, 'pane-test', 'calculator command should write back to the source pane')
  return replace.text
}

assert.equal(
  await runCalculatorCommand([
    '1 + 2',
    '2 * (3 + 4)',
    '5 + 5 = 10',
    '10 / 4',
    'not a formula',
    '9 + 9',
  ].join('\n')),
  [
    '1 + 2 = 3',
    '2 * (3 + 4) = 14',
    '5 + 5 = 10',
    '10 / 4 = 2.5',
    'not a formula',
    '9 + 9',
  ].join('\n'),
  'calculator command should batch calculate formulas, skip lines with "=", and stop at the first non-math formula',
)

console.log('calculator command mode checks passed')
