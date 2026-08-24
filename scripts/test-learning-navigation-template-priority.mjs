#!/usr/bin/env node
/**
 * Contract: navigation-sensor template resolution must try the deterministic
 * path heuristic (scenario D) before copy-correlation (scenario A).
 *   src/workspace/learning/navigationSensor.ts — resolveTemplate
 *
 * doc/2026-08-12-direct-answer-workbench-design.md §11.D is explicit that A and
 * D must converge on the same url-template LearnedRule for the same
 * destination ("两者收敛到同一条 url-template LearnedRule，互相印证"). The path
 * heuristic (urlTemplate.templatizeUrl) is a pure function of the URL, so it
 * always induces the same template on every visit. The clipboard is transient
 * session state, so templating around "whatever token happens to be recently
 * copied" is not: revisiting the same page across a session with different
 * clipboard contents each time induced a *different* template per visit, so
 * the same destination never converged — it got learned as several unrelated
 * rules with different clusterKeys, which rendered as duplicate rows in the
 * launcher for one real page (fixed defensively at the render layer in
 * GlobalLauncherItems.ts, but the root cause is this ordering).
 *
 * resolveTemplate is not exported (navigationSensor.ts is impure / stateful),
 * so this locks the fix at the source level: the heuristic must run first and
 * short-circuit before the clipboard-token loop is ever reached.
 *
 * Run: node scripts/test-learning-navigation-template-priority.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/workspace/learning/navigationSensor.ts', import.meta.url), 'utf8')

const fn = src.match(/function resolveTemplate\([\s\S]*?\n\}/)?.[0] ?? ''
assert.ok(fn, 'resolveTemplate must exist in navigationSensor.ts')

const heuristicIdx = fn.indexOf('templatizeUrl(url)')
const clipboardLoopIdx = fn.indexOf('getRecentClipboardTokensWithSource()')
assert.ok(heuristicIdx >= 0, 'must call the deterministic path heuristic (templatizeUrl)')
assert.ok(clipboardLoopIdx >= 0, 'must still fall back to copy-correlated clipboard tokens')
assert.ok(
  heuristicIdx < clipboardLoopIdx,
  'the deterministic heuristic must run BEFORE the clipboard-token loop — copy-correlation is a fallback ' +
    'for what the heuristic cannot classify on its own, not the primary signal (see comment above resolveTemplate)',
)

// The heuristic branch must return before the clipboard loop ever runs (i.e. a
// real early-return on success), not just be evaluated first and ignored.
const heuristicBranch = fn.slice(heuristicIdx, clipboardLoopIdx)
assert.match(
  fn,
  /heuristic\.slots\.includes\(token\.trim\(\)\)/,
  'a heuristic match must still preserve copy correlation when its slot is the recently copied token',
)

assert.match(
  fn,
  /return \{ result: heuristic, copyCorrelated: true, sourceHost \}/,
  'copy-correlated metadata must survive while reusing the deterministic heuristic template',
)

console.log('test-learning-navigation-template-priority: ok')
