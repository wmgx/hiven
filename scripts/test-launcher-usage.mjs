#!/usr/bin/env node
/**
 * test-launcher-usage.mjs
 * Verifies surface-scoped usage recording and legacy migration.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const src = readFileSync('src/workspace/launcher/usage.ts', 'utf8')

assert.match(src, /export function recordSelection/, 'exports recordSelection')
assert.match(src, /export function migrateLegacyUsage/, 'exports migrateLegacyUsage')
assert.match(src, /count|lastSelectedAt/, 'uses {count,lastSelectedAt} record shape')

// Stub the ./types import (surface ids + legacy alias normalization are used at runtime).
const stubbed = src.replace(
  /import\s*\{[^}]*\}\s*from\s*'\.\/types'\s*;?\s*\n?/,
  "const LAUNCHER_SURFACE_IDS = ['command-palette', 'editor-command-bar', 'global-launcher'];\nconst normalizeLauncherSurfaceId = (surfaceId) => surfaceId === 'command-palette' ? 'editor-command-bar' : surfaceId;\n",
)
const transpiled = ts.transpileModule(stubbed, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
}).outputText
const moduleExports = {}
const sandbox = { exports: moduleExports, module: { exports: moduleExports }, console }
vm.runInNewContext(transpiled, sandbox)
const mod = sandbox.module.exports

// recordSelection increments count and is immutable + surface-scoped
const u0 = mod.emptyUsageBySurface()
const u1 = mod.recordSelection(u0, 'command-palette', 'plugin:p:launcher:a', 1000)
assert.equal(u1['editor-command-bar']['plugin:p:launcher:a'].count, 1)
assert.equal(u1['editor-command-bar']['plugin:p:launcher:a'].lastSelectedAt, 1000)
// global-launcher untouched → different surface scores independently
assert.equal(Object.keys(u1['global-launcher']).length, 0, 'other surface untouched')
// immutability
assert.equal(Object.keys(u0['editor-command-bar']).length, 0, 'input not mutated')

const u2 = mod.recordSelection(u1, 'command-palette', 'plugin:p:launcher:a', 2000)
assert.equal(u2['editor-command-bar']['plugin:p:launcher:a'].count, 2, 'count increments')
assert.equal(u2['editor-command-bar']['plugin:p:launcher:a'].lastSelectedAt, 2000)

// Same item key on the two surfaces tracks separately
const us = mod.recordSelection(u2, 'global-launcher', 'plugin:p:launcher:a', 3000)
assert.equal(us['editor-command-bar']['plugin:p:launcher:a'].count, 2)
assert.equal(us['global-launcher']['plugin:p:launcher:a'].count, 1)

// Legacy migration: command-palette history preserved into editor-command-bar
const legacy = {
  'command-palette': {
    recentActionNames: ['line-tools.reverse', 'base64.run'],
    actionUsageCounts: { 'line-tools.reverse': 5, 'base64.run': 2 },
  },
  'global-launcher': { recentActionNames: [], actionUsageCounts: {} },
}
const mapKey = (legacyKey) => `plugin:demo:launcher:${legacyKey}`
const migrated = mod.migrateLegacyUsage(legacy, mapKey, 0)
assert.equal(migrated['editor-command-bar']['plugin:demo:launcher:line-tools.reverse'].count, 5, 'editor command bar count preserved from legacy command-palette usage')
assert.equal(migrated['editor-command-bar']['plugin:demo:launcher:base64.run'].count, 2)
assert.equal(Object.keys(migrated['global-launcher']).length, 0)

// recency ordering: reverse (index 0, newer) should have larger timestamp than base64
const rev = migrated['editor-command-bar']['plugin:demo:launcher:line-tools.reverse'].lastSelectedAt
const b64 = migrated['editor-command-bar']['plugin:demo:launcher:base64.run'].lastSelectedAt
assert.ok(rev > b64, 'more-recent item has larger synthetic timestamp')

// mapKey returning undefined drops the entry
const dropped = mod.migrateLegacyUsage(legacy, () => undefined, 0)
assert.equal(Object.keys(dropped['editor-command-bar']).length, 0, 'unmapped keys dropped')

console.log('✓ test-launcher-usage passed')
