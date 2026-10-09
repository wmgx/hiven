#!/usr/bin/env node
// Check surface generation and its freshness key against the same normalization.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import crypto from 'node:crypto'
import ts from 'typescript'

const filename = 'src/plugins/random/index.ts'
const source = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
}).outputText
const module = { exports: {} }
vm.runInNewContext(source, {
  module, exports: module.exports, crypto,
  require(specifier) {
    if (specifier === '@hiven/plugin') return { definePlugin: definition => definition }
    if (specifier === './RandomSurface') return { RandomSurface: () => null }
    if (specifier === './style.css') return {}
    throw new Error(`Unexpected dependency: ${specifier}`)
  },
}, { filename })
const rnd = module.exports

// Result freshness follows the exact parameters consumed by surface generation,
// including normalization and validation, rather than raw form values.
const surfaceConfig = { min: 0, max: 100, decimals: 2, length: 16, bytes: 16, charset: 'alphanumeric', count: 5 }
const generationKey = (mode, overrides = {}) => rnd.getSurfaceGenerationKey(mode, { ...surfaceConfig, ...overrides })
const initialKey = generationKey('integer')
assert.equal(generationKey('integer', { min: 0.9, max: 100.9, count: 5.9 }), initialKey)
assert.equal(generationKey('integer', { decimals: 8, length: 40, bytes: 8, charset: 'numeric' }), initialKey)
assert.notEqual(generationKey('integer', { min: 1 }), initialKey)
assert.notEqual(generationKey('integer', { max: 99 }), initialKey)
assert.notEqual(generationKey('integer', { count: 6 }), initialKey)
assert.equal(generationKey('integer'), initialKey, 'restoring effective parameters restores freshness')
assert.equal(generationKey('integer', { min: NaN, max: -1 }), generationKey('integer', { min: -1, max: 0 }))
assert.equal(generationKey('integer', { count: NaN }), generationKey('integer', { count: 1 }))
assert.equal(generationKey('integer', { count: Infinity }), generationKey('integer', { count: 1 }))
assert.equal(generationKey('float', { decimals: 2.9 }), generationKey('float'))
assert.equal(generationKey('float', { decimals: Infinity }), generationKey('float', { decimals: 12 }))
assert.equal(generationKey('float', { decimals: NaN }), generationKey('float', { decimals: 0 }))
assert.equal(generationKey('float', { decimals: -1 }), generationKey('float', { decimals: 0 }))
assert.notEqual(generationKey('float', { min: 0.1 }), generationKey('float'))
assert.notEqual(generationKey('float'), initialKey, 'different modes never share a generation snapshot')
assert.equal(generationKey('string', { length: 16.9, charset: 'unknown' }), generationKey('string'))
assert.equal(generationKey('string', { length: NaN }), generationKey('string'))
assert.notEqual(generationKey('string', { charset: 'numeric' }), generationKey('string'))
assert.equal(generationKey('password', { length: 16.9, charset: 'numeric' }), generationKey('password'))
assert.equal(generationKey('hex', { bytes: 16.9 }), generationKey('hex'))
assert.equal(generationKey('hex', { bytes: NaN }), generationKey('hex'))
for (const mode of ['uuid', 'color', 'boolean']) {
  assert.equal(generationKey(mode, { min: 2, max: -1, decimals: 9, length: 0, bytes: 0, charset: 'numeric' }), generationKey(mode))
  assert.notEqual(generationKey(mode, { count: 6 }), generationKey(mode))
}
for (const [mode, config, error] of [
  ['integer', { min: 1.9, max: 1.1 }, /RANGE/],
  ['integer', { count: 0.9 }, /COUNT/],
  ['float', { max: Infinity }, /Invalid range/],
  ['string', { length: 1024.9 }, /LENGTH/],
  ['password', { length: 0 }, /LENGTH/],
  ['hex', { bytes: 1024.9 }, /BYTES/],
]) {
  assert.throws(() => generationKey(mode, config), error)
  assert.throws(() => rnd.generateSurfaceValues(mode, { ...surfaceConfig, ...config }), error)
}
const integers = rnd.generateSurfaceValues('integer', { ...surfaceConfig, min: 1.8, max: 1.9, count: 5.9 })
assert.equal(integers.length, 5)
assert.ok(integers.every(value => value === '1'))
assert.equal(rnd.generateSurfaceValues('float', { ...surfaceConfig, min: 1, max: 1, decimals: 2.9, count: 1 })[0], '1.00')
assert.equal(rnd.generateSurfaceValues('string', { ...surfaceConfig, length: 16.9, count: 1 })[0].length, 16)
assert.equal(rnd.generateSurfaceValues('hex', { ...surfaceConfig, bytes: 16.9, count: 1 })[0].length, 32)

console.log('random surface parameter snapshot checks passed')
