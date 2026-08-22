#!/usr/bin/env node
/**
 * Contract: scenario L3 fire — clipboard token → history recall.
 *   src/workspace/learning/fire.ts — learnedLauncherItems (recall branch)
 *
 * Verifies the GLUE in fire.ts: a plausible-token query is checked against
 * getRecentHistoryForRecall() via findHistoryRecall(), and a hit becomes a
 * first-class direct-answer item. findHistoryRecall's own matching logic is
 * covered by test-clipboard-browser-link.mjs — this test stubs it (and the
 * other impure deps) to isolate fire.ts's own composition/gating logic.
 *
 * fire.ts has many impure imports; strip + stub them all so we can load the
 * real module and call the real exported function.
 *
 * Run: node scripts/test-learning-history-recall.mjs
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

let recallResult = []
let recallCalls = []
let historySnapshot = []

const fire = loadModule('src/workspace/learning/fire.ts', {
  // Each import path gets its OWN pattern so none can bleed into a neighbor:
  // a shared non-greedy pattern here would swallow whichever import sits
  // between two matched paths (this bit the earlier hostboost test's stub
  // list, which relies on that swallowing instead of listing every path).
  stripImports: [
    /import\s+type\s*\{[\s\S]*?\}\s*from\s*'[^']*'\s*;?\s*\n?/g,
    /import\s*\{[\s\S]*?\}\s*from\s*'\.\.\/\.\.\/i18n'\s*;?\s*\n?/g,
    /import\s*\{[\s\S]*?\}\s*from\s*'\.\.\/effectRunner'\s*;?\s*\n?/g,
    /import\s*\{[\s\S]*?\}\s*from\s*'\.\.\/telemetry'\s*;?\s*\n?/g,
    /import\s*\{[\s\S]*?\}\s*from\s*'\.\/clipboardBrowserLink'\s*;?\s*\n?/g,
    /import\s*\{[\s\S]*?\}\s*from\s*'\.\/features'\s*;?\s*\n?/g,
    /import\s*\{[\s\S]*?\}\s*from\s*'\.\/frecency'\s*;?\s*\n?/g,
    /import\s*\{[\s\S]*?\}\s*from\s*'\.\/navigationSensor'\s*;?\s*\n?/g,
    /import\s*\{[\s\S]*?\}\s*from\s*'\.\/proposals'\s*;?\s*\n?/g,
    /import\s*\{[\s\S]*?\}\s*from\s*'\.\/registryRunners'\s*;?\s*\n?/g,
    /import\s*\{[\s\S]*?\}\s*from\s*'\.\/store'\s*;?\s*\n?/g,
    /import\s*\{[\s\S]*?\}\s*from\s*'\.\/urlTemplate'\s*;?\s*\n?/g,
  ],
  globals: {
    t: (_l, key) => key,
    openExternalUrl: async () => {},
    TelemetryEvents: { learningRuleFired: 'learningRuleFired' },
    trackBehavior: () => {},
    findHistoryRecall: (token, history, limit) => {
      recallCalls.push({ token, history, limit })
      return recallResult
    },
    extractFeatures: () => ({}),
    featureSignature: () => '',
    isPlausibleToken: (s) => typeof s === 'string' && s.trim().length >= 3 && !/\s/.test(s.trim()),
    normalizeToken: (s) => s.trim(),
    FIRE_STRENGTH_BONUS: 1,
    firePriority: () => 0,
    getCurrentActiveHost: () => null,
    getRecentHistoryForRecall: () => historySnapshot,
    isNewlyLearned: () => false,
    runLearnedChain: () => null,
    bumpRuleStrength: async () => {},
    pruneForgottenRules: async () => {},
    queryAllRules: async () => [],
    fillTemplate: () => '',
    queryMatchesSlot: () => false,
  },
})

// ─── gating: only a plausible single-token query even attempts a lookup ───────
recallCalls = []
historySnapshot = [{ url: 'https://x.com/a', title: 'A' }]
fire.learnedLauncherItems('hello world', 'en')
assert.equal(recallCalls.length, 0, 'multi-word query never calls findHistoryRecall')

recallCalls = []
fire.learnedLauncherItems('ab', 'en')
assert.equal(recallCalls.length, 0, 'too-short query never calls findHistoryRecall')

// ─── empty history cache short-circuits before the (would-be) lookup ──────────
recallCalls = []
historySnapshot = []
fire.learnedLauncherItems('deadbeef123', 'en')
assert.equal(recallCalls.length, 0, 'empty history cache short-circuits before calling findHistoryRecall')

// ─── a hit becomes a first-class, correctly-shaped direct-answer item ─────────
recallCalls = []
recallResult = [{ url: 'https://grafana.example/d/panel-1', title: 'Latency dashboard' }]
historySnapshot = [{ url: 'https://grafana.example/d/panel-1', title: 'Latency dashboard' }]
const items = fire.learnedLauncherItems('deadbeef123', 'en')

assert.equal(recallCalls.length, 1, 'plausible token + non-empty history → exactly one lookup')
assert.equal(recallCalls[0].token, 'deadbeef123', 'the normalized query is passed as the token')
assert.equal(recallCalls[0].limit, 1, 'capped to one hit — direct answers must stay scannable')

assert.equal(items.length, 1, 'exactly one item for one hit (no learned rules cached in this test)')
const [recallItem] = items
assert.equal(recallItem.systemKey, 'learned-recall:https://grafana.example/d/panel-1')
assert.equal(recallItem.display.title, 'Latency dashboard', 'title is the page title, not the URL')
assert.equal(recallItem.display.subtitle, 'https://grafana.example/d/panel-1', 'subtitle is the URL')
assert.equal(recallItem.directAnswer.origin, 'builtin', 'a standing capability, not something taught')
assert.equal(
  recallItem.directAnswer.priority,
  35,
  'between the flat plugin-builtin tier (30) and the learned baseline (45)',
)

// ─── no hit → no item, no crash ────────────────────────────────────────────────
recallCalls = []
recallResult = []
const emptyItems = fire.learnedLauncherItems('deadbeef123', 'en')
assert.equal(emptyItems.length, 0, 'no recall hit and no learned rules → no items')

console.log('test-learning-history-recall: ok')
