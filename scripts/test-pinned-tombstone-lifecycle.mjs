import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { restorePinnedFromTombstone } from '../src/workspace/pinnedActionRuntime.ts'

function makePinned(patch = {}) {
  return {
    id: 'pinned-date-time',
    kind: 'plugin-command',
    actionId: 'timestamp.run',
    pluginId: 'date-time-assistant',
    title: 'Time Assistant',
    inputText: 'now',
    outputText: '',
    outputKind: 'text',
    params: {},
    autoRun: true,
    debounceMs: 250,
    controlsOpen: false,
    ...patch,
  }
}

const staleTombstone = {
  pinnedId: 'pinned-date-time',
  actionId: 'timestamp.run',
  inputText: 'now',
  params: {},
  autoRun: true,
  debounceMs: 250,
  controlsOpen: false,
  outputSummary: {
    kind: 'text',
    preview: '1781024414589 | 2026-06-10 01:00:14',
    generatedAt: 1781024414589,
  },
  disposedAt: 1781024414590,
  reason: 'idle-timeout',
}

const freshPinned = makePinned({
  outputText: '1781064306000 | 2026-06-10 12:05:06',
  outputKind: 'text',
  lastRunAt: 1781064306000,
  lastDurationMs: 4,
})

const restoredFresh = restorePinnedFromTombstone(freshPinned, staleTombstone)
assert.equal(
  restoredFresh.outputText,
  freshPinned.outputText,
  'reactivating a pinned action with fresh output should not replace it with an old stale preview',
)
assert.equal(restoredFresh.outputKind, 'text', 'fresh output should remain applicable after pinned action switching')

const emptyPinned = makePinned()
const restoredEmpty = restorePinnedFromTombstone(emptyPinned, staleTombstone)
assert.match(
  restoredEmpty.outputText,
  /^Previous result preview \(stale\): /,
  'an empty runner can still restore a tombstone preview as stale context',
)
assert.equal(restoredEmpty.outputKind, 'stale', 'restored tombstone preview should remain stale')

const storeSource = readFileSync('src/store.ts', 'utf8')
const pinnedRunnerSource = readFileSync('src/views/PinnedRunnerView.tsx', 'utf8')
assert.match(
  storeSource,
  /updatePinnedAction:[\s\S]*discardPinnedTombstoneAfterPatch\(patch\)[\s\S]*pinnedTombstones:\s*nextTombstones/,
  'store should discard an old tombstone from the pinned action update lifecycle',
)
assert.match(
  pinnedRunnerSource,
  /activationRunKey[\s\S]*pinnedRuntime\?\.lastActivatedAt[\s\S]*runKey = `\$\{pinned\.id\}\\0\$\{pinned\.inputText\}\\0\$\{paramsFingerprint\}\\0\$\{activationRunKey\}`/,
  'pinned runner auto-run should rerun after pinned action activation even when input and params did not change',
)

console.log('pinned tombstone lifecycle checks passed')
