#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
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
  require(id) {
    if (id === './CalculatorSurface') return { CalculatorSurface: () => null }
    if (id === './style.css') return {}
    if (id === '@hiven/plugin') return {
      definePlugin: (definition) => definition,
      textOutput: (text) => ({ output: { kind: 'text', text } }),
      textError: (text) => ({ output: { kind: 'error', text } }),
    }
    return require(id)
  },
  module,
  exports: module.exports,
})

vm.runInContext(transpiled, context, { filename: 'calculator.js' })

const calculateExpression = vm.runInContext('calculateExpression', context)
const calculateValue = vm.runInContext('calculateValue', context)

const plugin = module.exports.default
const command = plugin.commands?.find((item) => item.id === 'calculator.run')
const sumCommand = plugin.commands?.find((item) => item.id === 'calculator.sum')
assert.ok(command, 'calculator should expose calculator.run command mode')
assert.ok(sumCommand, 'calculator should expose calculator.sum command mode')
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
  if (result.output) return result.output.text
  const replace = result.effects?.find((effect) => effect.type === 'text.replace')
  assert.ok(replace, 'calculator command should return text output or legacy text.replace')
  return replace.text
}

async function runSumCommand(text) {
  const result = await sumCommand.run({
    inputs: { input: { kind: 'text', text, paneId: 'pane-test' } },
    params: {},
  })
  if (result.output) return result.output.text
  const replace = result.effects?.find((effect) => effect.type === 'text.replace')
  assert.ok(replace, 'calculator sum command should return text output or legacy text.replace')
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

assert.equal(
  await runCalculatorCommand([
    '1 + 2 =',
    '1,000 + 2,500',
    '2,500 * 2 =',
    '3 + 4 = 7',
    '4 + 4',
  ].join('\n')),
  [
    '1 + 2 = 3',
    '1,000 + 2,500 = 3500',
    '2,500 * 2 = 5000',
    '3 + 4 = 7',
    '4 + 4 = 8',
  ].join('\n'),
  'calculator command should calculate lines ending with "=" and ignore thousands separators inside numbers',
)

assert.equal(
  await runCalculatorCommand('0.1 + 0.2'),
  '0.1 + 0.2 = 0.3',
  'calculator command should use decimal precision for arithmetic formulas',
)

const variables = new Map([['a', calculateValue('1 / 3')]])
assert.equal(calculateExpression('a * a', variables), '0.1111111111')
assert.equal(calculateExpression('sqrt(81) + abs(-2) + round(1.5) + floor(1.9) + ceil(1.1)', variables), '16')
assert.equal(calculateExpression('2^3^2'), '512')
assert.equal(calculateExpression('-2^2'), '-4')
assert.equal(calculateExpression('2**-2'), '0.25')
assert.equal(calculateExpression('missing + 1', variables), null)
assert.equal(calculateExpression('9^999999999'), null)
assert.equal(calculateExpression(`1.${'9'.repeat(900)}^20`), null)
assert.equal(calculateExpression('sqrt(-1)'), null)
assert.equal(
  await runCalculatorCommand('2^8\nsqrt(81)'),
  '2^8 = 256\nsqrt(81) = 9',
  'calculator command and launcher parser should recognize powers and functions',
)

assert.equal(
  await runSumCommand('0.1\n0.2\n1,000'),
  '1000.3',
  'calculator sum command should sum all numeric tokens with BigNumber precision',
)

console.log('calculator command mode checks passed')
