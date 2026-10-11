import assert from 'node:assert/strict'
import { createHistoryPointerIntent } from '../src/plugins/clipboard-history/surfaces/historyPointerIntent.ts'

const pointer = createHistoryPointerIntent()
assert.equal(pointer.move(100, 80), false, 'first coordinate establishes a baseline, not a stationary reopen hover')
assert.equal(pointer.move(100, 80), false, 'same coordinates after virtual row mount are not pointer intent')
assert.equal(pointer.move(101, 80), true, 'genuine movement restores hover')
for (const cause of ['keyboard', 'wheel', 'native scroll without wheel', 'focus', 'visibility', 'page replacement']) {
  pointer.suspend()
  assert.equal(pointer.move(101, 80), false, `${cause}: stationary pointer cannot regain hover`)
  assert.equal(pointer.move(101, 81), true, `${cause}: actual movement remains usable`)
  pointer.move(101, 80)
}
pointer.suspend()
const layoutMoves = [{ screenX: 101, screenY: 80, clientY: 383 }, { screenX: 101, screenY: 80, clientY: 309 }]
for (const event of layoutMoves) assert.equal(pointer.move(event.screenX, event.screenY), false, 'viewport coordinates changing under a fixed screen pointer are not real movement')
assert.equal(pointer.move(102, 80, 'touch'), false)
pointer.suspend()
assert.equal(pointer.move(NaN, 80), false)
assert.equal(pointer.move(102, 80, 'pen'), true)
console.log('history pointer intent transitions passed')
