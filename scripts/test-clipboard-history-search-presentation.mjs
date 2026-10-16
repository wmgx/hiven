#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync('src/plugins/clipboard-history/surfaces/clipboardHistorySearchPresentation.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2023 },
}).outputText
const { getClipboardHistorySearchDebounceMs, getClipboardHistorySearchPresentation } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
)

assert.equal(getClipboardHistorySearchDebounceMs(undefined, undefined, 'initial'), 0, 'the first request starts immediately')
assert.equal(getClipboardHistorySearchDebounceMs(undefined, 'initial', 'typed'), 120, 'typing before the first request settles still debounces replacement work')
assert.equal(getClipboardHistorySearchDebounceMs('same', 'same', 'same'), 0, 'same-criteria paging and refresh start immediately')
assert.equal(getClipboardHistorySearchDebounceMs('applied', 'failed', 'failed'), 0, 'retrying the same failed criteria starts immediately')
assert.equal(getClipboardHistorySearchDebounceMs('applied', 'intermediate', 'applied'), 0, 'returning to the settled criteria starts immediately')
assert.equal(getClipboardHistorySearchDebounceMs('applied', 'applied', 'cleared'), 120, 'every new criteria replacement, including clear, shares the debounce')

assert.deepEqual(
  getClipboardHistorySearchPresentation({ desiredKey: 'empty', loadState: 'loading' }),
  { hasAppliedResults: false, stale: false, pending: true, showInitialSkeleton: true, actionsBlocked: true },
  'the first read owns the only full skeleton',
)

assert.deepEqual(
  getClipboardHistorySearchPresentation({ desiredKey: 'old', appliedKey: 'old', loadState: 'idle' }),
  { hasAppliedResults: true, stale: false, pending: false, showInitialSkeleton: false, actionsBlocked: false },
  'settled rows are actionable when controls and applied criteria agree',
)

assert.deepEqual(
  getClipboardHistorySearchPresentation({ desiredKey: 'new', appliedKey: 'old', loadState: 'loading' }),
  { hasAppliedResults: true, stale: true, pending: true, showInitialSkeleton: false, actionsBlocked: true },
  'typing retains applied rows but blocks actions that could target stale selection',
)

assert.deepEqual(
  getClipboardHistorySearchPresentation({ desiredKey: 'new', appliedKey: 'old', loadState: 'error' }),
  { hasAppliedResults: true, stale: true, pending: false, showInitialSkeleton: false, actionsBlocked: true },
  'a failed replacement keeps old rows readable without making them belong to the failed query',
)

assert.deepEqual(
  getClipboardHistorySearchPresentation({ desiredKey: 'same', appliedKey: 'same', loadState: 'error' }),
  { hasAppliedResults: true, stale: false, pending: false, showInitialSkeleton: false, actionsBlocked: false },
  'a failed same-criteria refresh does not disable still-matching settled rows',
)

assert.deepEqual(
  getClipboardHistorySearchPresentation({ desiredKey: 'criteria/page-2', appliedKey: 'criteria/page-1', loadState: 'error' }),
  { hasAppliedResults: true, stale: true, pending: false, showInitialSkeleton: false, actionsBlocked: true },
  'a failed page transition cannot make the previous page actionable as the requested page',
)

console.log('✓ Clipboard history retained-result search presentation passed')
