#!/usr/bin/env node
/**
 * B2 contract: static + dynamic contributions share one normalizeContribution path.
 * - accepts / match / textMatch / params / executeWithParams must be copied
 * - dynamic items default recordUsage only when opted in
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const read = (p) => readFileSync(p, 'utf8')

function loadModule(path, { stripImports = [], globals = {} } = {}) {
  let src = read(path)
  for (const re of stripImports) src = src.replace(re, '')
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
  }).outputText
  const moduleExports = {}
  const sandbox = { exports: moduleExports, module: { exports: moduleExports }, console, ...globals }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports
}

const normalize = loadModule('src/workspace/launcher/normalizeContribution.ts', {
  stripImports: [
    /import\s+type\s*\{[\s\S]*?\}\s*from\s*'[^']*'\s*;?\s*\n?/g,
    /import\s*\{[^}]*\}\s*from\s*'\.\/identity'\s*;?\s*\n?/,
    /import\s*\{[^}]*\}\s*from\s*'\.\/pluginSource'\s*;?\s*\n?/,
  ],
  globals: {
    // Stub host helpers — unit under test is field-copy protocol only.
    sanitizeSurfaces: (surfaces) => surfaces,
    resolvePluginSettingsSource: (_pluginId, source) => (
      source === 'production' ? 'builtin' : source === 'dev' ? 'dev' : 'installed'
    ),
  },
})

assert.equal(typeof normalize.normalizeContribution, 'function', 'must export normalizeContribution')

const matchFn = () => [{ id: 'h', confidence: 1, target: { kind: 'command', id: 'x' } }]
const textMatch = (t) => t.includes('{')
const execute = async () => ({ ok: true })
const executeWithParams = async () => ({ ok: true })

const contribution = {
  id: 'format-json',
  display: { title: 'Format JSON' },
  params: [{ key: 'indent', type: 'number', default: 2 }],
  defaultParams: {},
  requireParamSelection: true,
  accepts: { kinds: ['json'], aliases: ['fmt'] },
  match: matchFn,
  textMatch,
  execute,
  executeWithParams,
  surfaces: ['global-launcher'],
}

const staticItem = normalize.normalizeContribution(contribution, {
  systemKey: 'plugin:json-tools:launcher:format-json',
  kind: 'plugin',
  pluginId: 'json-tools',
  source: 'production',
})

assert.equal(staticItem.accepts?.kinds?.[0], 'json', 'static must copy accepts.kinds')
assert.equal(staticItem.accepts?.aliases?.[0], 'fmt', 'static must copy accepts.aliases')
assert.equal(staticItem.match, matchFn, 'static must copy match')
assert.equal(staticItem.textMatch, textMatch, 'static must copy textMatch')
assert.equal(staticItem.params?.length, 1, 'static must copy params')
assert.equal(staticItem.defaultParams?.indent, 2, 'static must fill param defaults')
assert.equal(staticItem.requireParamSelection, true, 'static must copy requireParamSelection')
assert.equal(staticItem.executeWithParams, executeWithParams, 'static must copy executeWithParams')
// Avoid cross-realm deepEqual on arrays created inside vm.
assert.ok(Array.isArray(staticItem.legacyUsageKeys), 'static gets legacy usage keys array')
assert.equal(staticItem.legacyUsageKeys[0], 'format-json', 'static legacy usage key is contribution id')

const dynamicItem = normalize.normalizeContribution(
  { ...contribution, recordUsage: true },
  {
    systemKey: 'plugin:json-tools:dynamic:format-json',
    kind: 'dynamic',
    pluginId: 'json-tools',
    source: 'production',
  },
)

assert.equal(dynamicItem.accepts?.kinds?.[0], 'json', 'dynamic must copy accepts')
assert.equal(dynamicItem.match, matchFn, 'dynamic must copy match')
assert.equal(dynamicItem.textMatch, textMatch, 'dynamic must copy textMatch')
assert.equal(dynamicItem.params?.length, 1, 'dynamic must copy params (params protocol parity)')
assert.equal(dynamicItem.executeWithParams, executeWithParams, 'dynamic must copy executeWithParams')
assert.equal(dynamicItem.recordUsage, true, 'dynamic recordUsage opt-in respected')
assert.equal(dynamicItem.legacyUsageKeys, undefined, 'dynamic has no legacy usage keys')

const dynamicNoUsage = normalize.normalizeContribution(contribution, {
  systemKey: 'plugin:json-tools:dynamic:format-json-2',
  kind: 'dynamic',
  pluginId: 'json-tools',
  source: 'production',
})
assert.equal(dynamicNoUsage.recordUsage, undefined, 'dynamic without opt-in leaves recordUsage unset')

// registry must use normalizeContribution for static + dynamic
const registry = read('src/workspace/launcher/registry.ts')
assert.match(registry, /normalizeContribution/, 'registry must import/use normalizeContribution')
assert.match(
  registry,
  /resolveStaticItemFromContribution[\s\S]*normalizeContribution/,
  'static path must call normalizeContribution',
)
assert.match(
  registry,
  /resolveDynamicItem[\s\S]*normalizeContribution/,
  'dynamic path must call normalizeContribution',
)
assert.match(
  registry,
  /signal,/,
  'dynamic provider context must pass AbortSignal',
)

// ranking must use shared eligibility (match filter)
const ranking = read('src/workspace/launcher/ranking.ts')
assert.match(ranking, /isIntentEligible/, 'ranking intentScore must use isIntentEligible')

// actionRecommendation must not merge pluginActionManifest
const actions = read('src/launcher/clipboard/actionRecommendation.ts')
assert.doesNotMatch(actions, /discoverActionsForBlock/, 'host pins must not merge pluginActionManifest')
assert.doesNotMatch(actions, /format-clipboard-json|html-decode/, 'transform catalog must be removed')

console.log('test-launcher-normalize-contribution: ok')
