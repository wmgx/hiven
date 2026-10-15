import assert from 'node:assert/strict'
import {
  createHistoryImageSaveLifecycle,
  getClipboardHistoryImageFilename,
  saveClipboardHistoryImage,
} from '../src/plugins/clipboard-history/surfaces/historyImageSave.ts'

const original = {
  id: 'image-1', kind: 'image' as const, hash: 'original-hash',
  blobId: 'original-full-blob', previewBlobId: 'different-preview-blob',
  contentType: 'image/png', width: 96, height: 64, byteSize: 2048,
  firstCopiedAt: Date.parse('2026-10-15T08:09:10.123Z'),
  lastCopiedAt: Date.parse('2026-10-15T08:09:10.123Z'),
  copyCount: 4, pasteCount: 2, isFavorite: false,
}

function fixture(item: unknown = original) {
  const calls: Array<{ blobId: string; options: unknown }> = []
  let reads = 0
  const repository = {
    async getItem(id: string) {
      reads += 1
      assert.equal(id, 'image-1')
      return item
    },
  }
  const storage = {
    blob: {
      async savePng(blobId: string, options: unknown) {
        calls.push({ blobId, options })
        return { status: 'saved' as const }
      },
    },
  }
  return { repository, storage, calls, get reads() { return reads } }
}

{
  const f = fixture()
  const metadataBefore = JSON.stringify(original)
  assert.deepEqual(await saveClipboardHistoryImage(f.repository as never, f.storage as never, 'image-1', () => true), { status: 'saved' })
  assert.equal(f.reads, 1, 'the active record is always re-read')
  assert.deepEqual(f.calls, [{
    blobId: 'original-full-blob',
    options: { suggestedFilename: 'clipboard-image-2026-10-15T08-09-10-123Z.png' },
  }], 'save uses the original blob and never requests clipboard path copying')
  assert.equal(JSON.stringify(original), metadataBefore, 'save does not mutate history metadata')
}

for (const unavailable of [null, { ...original, kind: 'text', text: 'not an image' }, { ...original, blobId: '' }]) {
  const f = fixture(unavailable)
  assert.deepEqual(await saveClipboardHistoryImage(f.repository as never, f.storage as never, 'image-1', () => true), { status: 'unavailable' })
  assert.equal(f.calls.length, 0, 'missing, replaced or invalid records never open a save dialog')
}

{
  const f = fixture()
  assert.deepEqual(await saveClipboardHistoryImage(f.repository as never, f.storage as never, 'image-1', () => false), { status: 'interrupted' })
  assert.equal(f.reads, 0, 'an obsolete surface does not read storage')
}

{
  let current = true
  const f = fixture()
  f.repository.getItem = async () => { current = false; return original }
  assert.deepEqual(await saveClipboardHistoryImage(f.repository as never, f.storage as never, 'image-1', () => current), { status: 'interrupted' })
  assert.equal(f.calls.length, 0, 'owner loss after the read does not open a native dialog')
}

{
  const f = fixture()
  f.storage.blob.savePng = async () => ({ status: 'cancelled' as const })
  assert.deepEqual(await saveClipboardHistoryImage(f.repository as never, f.storage as never, 'image-1', () => true), { status: 'cancelled' })
}

{
  const lifecycle = createHistoryImageSaveLifecycle()
  let ownerCurrent = true
  const first = lifecycle.begin(() => ownerCurrent)
  assert.ok(first)
  assert.equal(lifecycle.begin(() => true), null, 'a second trigger cannot open another dialog')
  ownerCurrent = false
  assert.equal(first.isCurrent(), false, 'owner loss makes the submission stale')
  ownerCurrent = true
  assert.equal(first.isCurrent(), false, 'a stale submission cannot revive')
  first.finish()
  const second = lifecycle.begin(() => true)
  assert.ok(second, 'the action can be retried after the first transaction settles')
  lifecycle.invalidate()
  assert.equal(second.isCurrent(), false, 'unmount suppresses stale UI completion')
}

assert.equal(
  getClipboardHistoryImageFilename(Number.NaN).startsWith('clipboard-image-'),
  true,
  'invalid legacy timestamps still receive a safe PNG filename',
)

console.log('clipboard history image save logic passed')
