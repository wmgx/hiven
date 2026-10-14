import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHistoryOpenSession, resetHistoryOpenSession } from '../src/plugins/clipboard-history/surfaces/historyOpenSession.ts'

const visibleSession = createHistoryOpenSession('visible')
assert.equal(visibleSession.visibilityChanged('visible'), false, 'ordinary visible updates do not start a new session')
assert.equal(visibleSession.visibilityChanged('hidden'), false, 'hiding only arms the next genuine reopen')
assert.equal(visibleSession.visibilityChanged('hidden'), false, 'repeated hidden events do not start a session')
assert.equal(visibleSession.visibilityChanged('visible'), true, 'hidden to visible starts exactly one new session')
assert.equal(visibleSession.visibilityChanged('visible'), false, 'focus or preview returns while visible do not reset the session')

const initiallyHiddenSession = createHistoryOpenSession('hidden')
assert.equal(initiallyHiddenSession.visibilityChanged('visible'), true, 'a retained window first shown from hidden starts a session')

const calls: string[] = []
resetHistoryOpenSession({
  invalidatePasteNotice: () => calls.push('invalidate-paste'),
  clearPasteNotice: () => calls.push('clear-notice'),
  clearSelection: () => calls.push('clear-selection'),
  resetPage: () => calls.push('first-page'),
  clearNextCursor: () => calls.push('clear-next-cursor'),
  resetScroll: () => calls.push('top'),
  clearDomSelection: () => calls.push('clear-dom-selection'),
  suspendPointerHover: () => calls.push('suspend-hover'),
  refreshPage: () => calls.push('refresh'),
  focusSearch: () => calls.push('focus-search'),
})
assert.deepEqual(calls, [
  'invalidate-paste', 'clear-notice', 'clear-selection', 'first-page', 'clear-next-cursor',
  'top', 'clear-dom-selection', 'suspend-hover', 'refresh', 'focus-search',
], 'a genuine reopen resets stale actions, selection, pagination, scroll and hover before refreshing and focusing search')

const surface = readFileSync(new URL('../src/plugins/clipboard-history/surfaces/ClipboardHistorySurface.tsx', import.meta.url), 'utf8')
assert.match(
  surface,
  /if \(!openSession\.visibilityChanged\(document\.visibilityState\)\) return[\s\S]*resetHistoryOpenSession\(\{/,
  'the surface must run the tested reset only after a genuine reopen transition',
)

console.log('clipboard history open session transitions passed')
