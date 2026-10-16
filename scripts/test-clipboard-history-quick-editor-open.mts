import assert from 'node:assert/strict'
import {
  createHistoryQuickEditorLifecycle,
  openHistoryQuickEditorSnapshot,
  readHistoryQuickEditorSnapshot,
} from '../src/plugins/clipboard-history/surfaces/historyQuickEditorOpen.ts'

const longText = `${'full history line '.repeat(20)}\nTAIL-BEYOND-PREVIEW`
const original = { id: 'text-1', kind: 'text' as const, hash: 'hash-1', text: longText }

function fixture(item: unknown = original) {
  let current = item
  let reads = 0
  const opened: string[] = []
  const repository = {
    async getItem(id: string) { reads += 1; assert.equal(id, 'text-1'); return current },
  }
  const open = async (text: string) => { opened.push(text); return true }
  return { repository, open, opened, setItem: (value: unknown) => { current = value }, get reads() { return reads } }
}

{
  const f = fixture()
  const lifecycle = createHistoryQuickEditorLifecycle()
  const prepare = lifecycle.begin()
  assert.ok(prepare)
  const result = await readHistoryQuickEditorSnapshot(f.repository as never, original.id, prepare.isCurrent)
  assert.equal(result.status, 'ready')
  if (result.status !== 'ready') throw new Error('snapshot missing')
  assert.equal(result.snapshot.text, longText, 'the full body, not a list preview, is prepared')
  prepare.finish()

  const submit = lifecycle.begin()
  assert.ok(submit)
  assert.deepEqual(await openHistoryQuickEditorSnapshot(f.repository as never, result.snapshot, f.open, submit), { status: 'opened' })
  assert.deepEqual(f.opened, [longText])
  assert.equal(JSON.stringify(original), JSON.stringify({ id: 'text-1', kind: 'text', hash: 'hash-1', text: longText }), 'the source record is unchanged')
}

for (const next of [undefined, { ...original, kind: 'image' }, { ...original, hash: 'hash-2', text: 'changed elsewhere' }]) {
  const f = fixture()
  const lifecycle = createHistoryQuickEditorLifecycle()
  const prepare = lifecycle.begin()
  assert.ok(prepare)
  const read = await readHistoryQuickEditorSnapshot(f.repository as never, original.id, prepare.isCurrent)
  assert.equal(read.status, 'ready')
  if (read.status !== 'ready') throw new Error('snapshot missing')
  prepare.finish()
  f.setItem(next)
  const submit = lifecycle.begin()
  assert.ok(submit)
  const result = await openHistoryQuickEditorSnapshot(f.repository as never, read.snapshot, f.open, submit)
  assert.equal(result.status, next && (next as { kind?: string }).kind === 'text' ? 'changed' : 'unavailable')
  assert.deepEqual(f.opened, [], 'deleted, replaced, or changed records never open the editor')
}

{
  const f = fixture()
  let ownerCurrent = true
  const lifecycle = createHistoryQuickEditorLifecycle()
  const first = lifecycle.begin({ isCurrent: () => ownerCurrent, subscribeInvalidation: () => () => {} })
  assert.ok(first)
  const second = lifecycle.begin({ isCurrent: () => ownerCurrent, subscribeInvalidation: () => () => {} })
  assert.ok(second)
  assert.equal(first.signal.aborted, true, 'a newer attempt cancels the older owner-bound attempt')
  ownerCurrent = false
  assert.equal(second.isCurrent(), false, 'owner loss makes the attempt stale')
  const before = f.reads
  assert.deepEqual(await readHistoryQuickEditorSnapshot(f.repository as never, original.id, second.isCurrent), { status: 'interrupted' })
  assert.equal(f.reads, before, 'an obsolete surface does not read history')
}

{
  const f = fixture()
  const lifecycle = createHistoryQuickEditorLifecycle()
  const prepare = lifecycle.begin()
  assert.ok(prepare)
  const read = await readHistoryQuickEditorSnapshot(f.repository as never, original.id, prepare.isCurrent)
  if (read.status !== 'ready') throw new Error('snapshot missing')
  prepare.finish()
  const submit = lifecycle.begin()
  assert.ok(submit)
  const result = await openHistoryQuickEditorSnapshot(f.repository as never, read.snapshot, async () => false, submit)
  assert.deepEqual(result, { status: 'failed' })
  assert.deepEqual(f.opened, [], 'failed handoff preserves the prepared source for retry')
}

{
  const f = fixture()
  const lifecycle = createHistoryQuickEditorLifecycle()
  const prepare = lifecycle.begin()
  assert.ok(prepare)
  const read = await readHistoryQuickEditorSnapshot(f.repository as never, original.id, prepare.isCurrent)
  if (read.status !== 'ready') throw new Error('snapshot missing')
  prepare.finish()
  const submit = lifecycle.begin()
  assert.ok(submit)
  const result = await openHistoryQuickEditorSnapshot(f.repository as never, read.snapshot, async (text, options) => {
    options?.commit?.()
    lifecycle.cancel()
    f.opened.push(text)
    return true
  }, submit)
  assert.deepEqual(result, { status: 'opened' })
  assert.equal(submit.signal.aborted, false, 'owner cancellation cannot retract a handoff after its explicit commit point')
  assert.deepEqual(f.opened, [longText])
}

console.log('clipboard history Quick Editor open logic passed')
