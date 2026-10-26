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

// Stub the ./types import (surface ids are used at runtime).
const stubbed = src.replace(
  /import\s*\{[^}]*\}\s*from\s*'\.\/types'\s*;?\s*\n?/,
  "const LAUNCHER_SURFACE_IDS = ['quick-editor-command', 'global-launcher'];\nconst normalizeLauncherSurfaceId = (surfaceId) => surfaceId;\n",
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
const u1 = mod.recordSelection(u0, 'quick-editor-command', 'plugin:p:launcher:a', 1000)
assert.equal(u1['quick-editor-command']['plugin:p:launcher:a'].count, 1)
assert.equal(u1['quick-editor-command']['plugin:p:launcher:a'].lastSelectedAt, 1000)
// global-launcher untouched → different surface scores independently
assert.equal(Object.keys(u1['global-launcher']).length, 0, 'other surface untouched')
// immutability
assert.equal(Object.keys(u0['quick-editor-command']).length, 0, 'input not mutated')

const u2 = mod.recordSelection(u1, 'quick-editor-command', 'plugin:p:launcher:a', 2000)
assert.equal(u2['quick-editor-command']['plugin:p:launcher:a'].count, 2, 'count increments')
assert.equal(u2['quick-editor-command']['plugin:p:launcher:a'].lastSelectedAt, 2000)

// Same item key on the two surfaces tracks separately
const us = mod.recordSelection(u2, 'global-launcher', 'plugin:p:launcher:a', 3000)
assert.equal(us['quick-editor-command']['plugin:p:launcher:a'].count, 2)
assert.equal(us['global-launcher']['plugin:p:launcher:a'].count, 1)

// Legacy migration: global launcher history remains available
const legacy = {
  'global-launcher': {
    recentActionNames: ['line-tools.reverse', 'base64.run'],
    actionUsageCounts: { 'line-tools.reverse': 5, 'base64.run': 2 },
  },
}
const mapKey = (legacyKey) => `plugin:demo:launcher:${legacyKey}`
const migrated = mod.migrateLegacyUsage(legacy, mapKey, 0)
assert.equal(migrated['global-launcher']['plugin:demo:launcher:line-tools.reverse'].count, 5, 'global launcher count preserved from legacy usage')
assert.equal(migrated['global-launcher']['plugin:demo:launcher:base64.run'].count, 2)

// recency ordering: reverse (index 0, newer) should have larger timestamp than base64
const rev = migrated['global-launcher']['plugin:demo:launcher:line-tools.reverse'].lastSelectedAt
const b64 = migrated['global-launcher']['plugin:demo:launcher:base64.run'].lastSelectedAt
assert.ok(rev > b64, 'more-recent item has larger synthetic timestamp')

// mapKey returning undefined drops the entry
const dropped = mod.migrateLegacyUsage(legacy, () => undefined, 0)
assert.equal(Object.keys(dropped['global-launcher']).length, 0, 'unmapped keys dropped')

console.log('✓ test-launcher-usage passed')
