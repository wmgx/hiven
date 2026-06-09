#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync('src/plugins/date-time-assistant/index.ts', 'utf8')
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2023,
    esModuleInterop: true,
  },
}).outputText

const fixedEpochMs = Date.UTC(2026, 5, 10, 4, 5, 6)
class FixedDate extends Date {
  constructor(value) {
    super(value === undefined ? fixedEpochMs : value)
  }
  static now() {
    return fixedEpochMs
  }
}
FixedDate.UTC = Date.UTC
FixedDate.parse = Date.parse

const module = { exports: {} }
const context = vm.createContext({
  Date: FixedDate,
  Number,
  Math,
  String,
  RegExp,
  parseInt,
  module,
  exports: module.exports,
  require(specifier) {
    if (specifier === '@fluxtext/plugin') {
      return { definePlugin: (definition) => definition }
    }
    throw new Error(`Unexpected require: ${specifier}`)
  },
})

vm.runInContext(transpiled, context, { filename: 'date-time-assistant.js' })

const plugin = module.exports.default
const provider = plugin.instantSuggestions?.find((item) => item.id === 'date-time.assistant')
assert.ok(provider, 'date-time assistant should expose the instant suggestion provider')
const timestampCommand = plugin.commands?.find((item) => item.id === 'timestamp.run')
assert.ok(timestampCommand, 'date-time assistant should expose the timestamp conversion command')

function suggest(query) {
  return provider.suggest({ query, t: (key) => key })
}

function values(query) {
  const result = suggest(query)
  return Array.isArray(result) ? result.map((item) => item.value) : [result?.value]
}

assert.equal(
  JSON.stringify(values('now')),
  JSON.stringify(['1781064306000', '2026-06-10 12:05:06']),
  'now should offer separate timestamp and datetime suggestions',
)
assert.equal(
  JSON.stringify(values('now+1day')),
  JSON.stringify(['1781150706000', '2026-06-11 12:05:06']),
  'now+1day should offer separate adjusted timestamp and datetime suggestions',
)
assert.equal(
  JSON.stringify(values('now+12h')),
  JSON.stringify(['1781107506000', '2026-06-11 00:05:06']),
  'now+12h should offer separate adjusted timestamp and datetime suggestions',
)
assert.equal(
  JSON.stringify(values('now UTC+8')),
  JSON.stringify(['1781064306000', '2026-06-10 12:05:06+08:00']),
  'now UTC+8 should offer separate timestamp and timezone datetime suggestions',
)
function runTimestampCommand(text) {
  const result = timestampCommand.run({
    inputs: { input: { kind: 'text', text, paneId: 'pane-test' } },
    params: { unit: 'ms', overwrite: 'yes' },
  })
  return result.effects?.[0]?.text
}

assert.equal(
  runTimestampCommand(['now', 'now+1day', 'now+12h', 'now UTC+8'].join('\n')),
  [
    '1781064306000 | 2026-06-10 12:05:06',
    '1781150706000 | 2026-06-11 12:05:06',
    '1781107506000 | 2026-06-11 00:05:06',
    '1781064306000 | 2026-06-10 12:05:06+08:00',
  ].join('\n'),
  'timestamp command should share now expression handling with instant suggestions',
)

console.log('date time assistant checks passed')
