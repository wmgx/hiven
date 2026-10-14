import assert from 'node:assert/strict'
import { createHistoryCopyLifecycle } from '../src/plugins/clipboard-history/surfaces/historyCopyLifecycle.ts'

{
  const lifecycle = createHistoryCopyLifecycle()
  const first = lifecycle.begin(() => true)
  const second = lifecycle.begin(() => true)
  assert.equal(first.signal.aborted, true, 'a newer copy must cancel the previous copy')
  assert.equal(first.isCurrent(), false)
  assert.equal(second.isCurrent(), true)
  first.finish()
  assert.equal(second.isCurrent(), true, 'a stale callback must not release the newer copy')
}

{
  const lifecycle = createHistoryCopyLifecycle()
  const pending = lifecycle.begin(() => true)
  lifecycle.cancel()
  assert.equal(pending.signal.aborted, true, 'leaving must cancel a pending clipboard write')
  assert.equal(pending.isCurrent(), false)
}

{
  let ownerCurrent = true
  const lifecycle = createHistoryCopyLifecycle()
  const pending = lifecycle.begin(() => ownerCurrent)
  ownerCurrent = false
  assert.equal(pending.isCurrent(), false, 'a revoked surface owner must make the copy stale')
}

{
  const lifecycle = createHistoryCopyLifecycle()
  const delivered = lifecycle.begin(() => true)
  delivered.commit()
  lifecycle.cancel()
  assert.equal(delivered.signal.aborted, false, 'successful native writes cannot be retracted during normal completion')
  assert.equal(delivered.isCurrent(), false)
}

console.log('clipboard history copy lifecycle tests passed')
