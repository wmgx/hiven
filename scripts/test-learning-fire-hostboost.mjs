#!/usr/bin/env node
/**
 * Contract: fire-time host disambiguation (scenario D).
 *   src/workspace/learning/fire.ts — activeHostFireBoost
 *
 * When a token's shape matches learned templates on two different sites (e.g.
 * hex learned on both grafana and code), the rule whose destination host equals
 * "where the user currently is" (navigationSensor.getCurrentActiveHost — a plain
 * string, source-agnostic) should outrank the other. Plain string equality, no
 * site/plugin semantics in this module.
 *
 * fire.ts has many impure imports (effects, store, telemetry) — stub them all so
 * we can load the real module and call its exported pure boost function directly,
 * rather than reimplementing the logic in the test.
 *
 * Run: node scripts/test-learning-fire-hostboost.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

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

const fire = loadModule('src/workspace/learning/fire.ts', {
  stripImports: [
    /import\s+type\s*\{[\s\S]*?\}\s*from\s*'[^']*'\s*;?\s*\n?/g,
    /import\s*\{[\s\S]*?\}\s*from\s*'\.\.\/\.\.\/i18n'\s*;?\s*\n?/g,
    /import\s*\{[\s\S]*?\}\s*from\s*'\.\.\/effectRunner'\s*;?\s*\n?/g,
    /import\s*\{[\s\S]*?\}\s*from\s*'\.\.\/telemetry'\s*;?\s*\n?/g,
    /import\s*\{[\s\S]*?\}\s*from\s*'\.\/features'\s*;?\s*\n?/g,
    /import\s*\{[\s\S]*?\}\s*from\s*'\.\/frecency'\s*;?\s*\n?/g,
    /import\s*\{[\s\S]*?\}\s*from\s*'\.\/navigationSensor'\s*;?\s*\n?/g,
    /import\s*\{[\s\S]*?\}\s*from\s*'\.\/registryRunners'\s*;?\s*\n?/g,
    /import\s*\{[\s\S]*?\}\s*from\s*'\.\/store'\s*;?\s*\n?/g,
    /import\s*\{[\s\S]*?\}\s*from\s*'\.\/urlTemplate'\s*;?\s*\n?/g,
  ],
  globals: {
    t: (_l, key) => key,
    openExternalUrl: async () => {},
    TelemetryEvents: { learningRuleFired: 'learningRuleFired' },
    trackBehavior: () => {},
    extractFeatures: () => ({}),
    featureSignature: () => '',
    FIRE_STRENGTH_BONUS: 1,
    firePriority: () => 0,
    getCurrentActiveHost: () => null, // unused by activeHostFireBoost itself
    runLearnedChain: () => null,
    bumpRuleStrength: async () => {},
    pruneForgottenRules: async () => {},
    queryAllRules: async () => [],
    fillTemplate: () => '',
    queryMatchesSlot: () => false,
  },
})

// ─── activeHostFireBoost: plain string equality, no site semantics ───────────
assert.equal(fire.activeHostFireBoost('grafana.byted.org', 'grafana.byted.org'), 40, 'matching host → boosted')
assert.equal(fire.activeHostFireBoost('code.byted.org', 'grafana.byted.org'), 0, 'different host → no boost')
assert.equal(fire.activeHostFireBoost('code.byted.org', null), 0, 'no known active host → no boost')
assert.equal(fire.activeHostFireBoost('', ''), 0, 'both empty is not a meaningful match → no boost')

console.log('test-learning-fire-hostboost: ok')
