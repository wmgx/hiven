#!/usr/bin/env node
// Execute production merge logic with synthetic history and controlled storage reads.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const code = ts.transpileModule(readFileSync('src/plugins/clipboard-history/merge/clipboardTextMerge.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2023 },
}).outputText
const {
  CLIPBOARD_TEXT_MERGE_MIN_ITEMS,
  CLIPBOARD_TEXT_MERGE_MAX_ITEMS,
  toggleClipboardTextMergeSelection,
  removeClipboardTextMergeSelection,
  moveClipboardTextMergeSelection,
  joinClipboardTexts,
  createClipboardTextMergeReader,
} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

function textItem(id, text = `FULL_${id}`) {
  return { id, kind: 'text', text, preview: `TRUNCATED_${id}`, hash: id, firstCopiedAt: 1, lastCopiedAt: 1, copyCount: 1, byteSize: text.length }
}
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function session() {
  const reader = createClipboardTextMergeReader()
  const state = { previews: [], errors: [], reads: [] }
  return {
    reader, state,
    read(ids, separator = 'newline', getItem = async (id) => textItem(id)) {
      return reader.read({ getItem: (id) => { state.reads.push(id); return getItem(id) } }, ids, separator,
        (preview) => state.previews.push(preview), (error) => state.errors.push(error))
    },
    deliver(preview) {
      if (!reader.isCurrent(preview)) return null
      reader.invalidate()
      return { kind: 'text', text: preview.text }
    },
  }
}
let passed = 0
async function check(name, run) {
  try { await run(); passed += 1 }
  catch (error) { error.message = `${name}: ${error.message}`; throw error }
}

await check('explicit text selection is stable across changing list/search order', () => {
  let ids = Object.freeze([])
  const history = [textItem('a'), textItem('b'), textItem('c')]
  ids = toggleClipboardTextMergeSelection(ids, history[2]).ids
  ids = toggleClipboardTextMergeSelection(ids, history[0]).ids
  const selected = ids
  history.unshift(textItem('new'))
  history.reverse()
  history.filter((item) => item.id === 'b')
  assert.deepEqual(ids, ['c', 'a'])
  assert.equal(ids, selected, 'background changes cannot reconcile or reorder session selection')
  ids = toggleClipboardTextMergeSelection(ids, history.find((item) => item.id === 'b')).ids
  assert.deepEqual(ids, ['c', 'a', 'b'])
  ids = toggleClipboardTextMergeSelection(ids, textItem('a')).ids
  assert.deepEqual(ids, ['c', 'b'])
  ids = toggleClipboardTextMergeSelection(ids, textItem('a')).ids
  assert.deepEqual(ids, ['c', 'b', 'a'], 'reselecting appends at the new explicit selection position')
  for (const kind of ['image', 'files']) {
    const denied = toggleClipboardTextMergeSelection(ids, { id: kind, kind })
    assert.equal(denied.error, 'not-text')
    assert.equal(denied.ids, ids)
  }
})

await check('limits, remove and adjacent moves preserve original arrays', () => {
  assert.equal(CLIPBOARD_TEXT_MERGE_MIN_ITEMS, 2)
  assert.equal(CLIPBOARD_TEXT_MERGE_MAX_ITEMS, 20)
  let ids = []
  for (let i = 0; i < 20; i++) {
    const next = toggleClipboardTextMergeSelection(Object.freeze(ids), textItem(`item-${i}`))
    assert.equal(next.error, null)
    ids = next.ids
  }
  const before = [...ids]
  assert.deepEqual(toggleClipboardTextMergeSelection(ids, textItem('overflow')), { ids, error: 'limit' })
  const removed = toggleClipboardTextMergeSelection(ids, textItem('item-2')).ids
  assert.equal(removed.length, 19, 'removal remains possible at the limit')
  assert.equal(toggleClipboardTextMergeSelection(removed, textItem('replacement')).ids.at(-1), 'replacement')
  const short = Object.freeze(['c', 'a', 'b'])
  assert.deepEqual(moveClipboardTextMergeSelection(short, 'a', -1), ['a', 'c', 'b'])
  assert.deepEqual(moveClipboardTextMergeSelection(short, 'a', 1), ['c', 'b', 'a'])
  assert.equal(moveClipboardTextMergeSelection(short, 'c', -1), short)
  assert.equal(moveClipboardTextMergeSelection(short, 'b', 1), short)
  assert.equal(moveClipboardTextMergeSelection(short, 'missing', 1), short)
  assert.deepEqual(removeClipboardTextMergeSelection(short, 'a'), ['c', 'b'])
  assert.equal(removeClipboardTextMergeSelection(short, 'missing'), short)
  assert.deepEqual(ids, before)
  assert.deepEqual(short, ['c', 'a', 'b'])
})

await check('joins preserve exact empty, whitespace, Unicode and mixed line endings', () => {
  const texts = ['\ufeff  世界\r\n\n', '', ' \t ', '🪷\r\nEND\n']
  assert.equal(joinClipboardTexts(texts, 'newline'), '\ufeff  世界\r\n\n\n\n \t \n🪷\r\nEND\n')
  assert.equal(joinClipboardTexts(texts, 'blankline'), texts.join('\n\n'))
  assert.equal(joinClipboardTexts(['same', 'same'], 'newline'), 'same\nsame', 'never deduplicate distinct selections')
})

await check('all selected IDs load full bodies in order despite out-of-order completion', async () => {
  const test = session(), first = deferred(), second = deferred()
  const ids = ['b', 'a']
  const pending = test.read(ids, 'blankline', (id) => id === 'b' ? first.promise : second.promise)
  assert.deepEqual(test.state.reads, ['b', 'a'])
  ids.reverse()
  second.resolve(textItem('a', ' \r\nFULL_A\n'))
  await Promise.resolve()
  assert.equal(test.state.previews.length, 0, 'partial success must not publish')
  first.resolve(textItem('b', 'FULL_B'.repeat(1000)))
  await pending
  const preview = test.state.previews[0]
  assert.deepEqual(preview.ids, ['b', 'a'], 'reader snapshots IDs before asynchronous work')
  assert.equal(preview.text, `${'FULL_B'.repeat(1000)}\n\n \r\nFULL_A\n`)
  assert.equal(preview.separator, 'blankline')
  assert.equal(test.reader.isCurrent(preview), true)
  assert.equal(Object.isFrozen(preview), true)
  assert.equal(Object.isFrozen(preview.ids), true)
  assert.equal(test.reader.isCurrent({ ...preview }), false, 'only this session issued previews are eligible')
  assert.deepEqual(test.deliver(preview), { kind: 'text', text: preview.text })
  assert.equal(test.deliver(preview), null, 'revocation prevents repeated delivery')
})

await check('empty and whitespace full bodies are valid and never replaced by previews', async () => {
  const test = session()
  await test.read(['empty', 'spaces'], 'newline', async (id) => textItem(id, id === 'empty' ? '' : ' \r\n '))
  assert.equal(test.state.previews[0].text, '\n \r\n ')
  assert.deepEqual(test.state.errors, [])
})

await check('20 complete entries succeed without truncating any body', async () => {
  const test = session(), ids = Array.from({ length: 20 }, (_, i) => `id-${i}`)
  await test.read(ids)
  assert.deepEqual(test.state.reads, ids)
  assert.equal(test.state.previews[0].text, ids.map((id) => `FULL_${id}`).join('\n'))
})

for (const ids of [[], ['one'], Array.from({ length: 21 }, (_, i) => `id-${i}`), ['duplicate', 'duplicate']]) {
  await check(`invalid selection ${ids.length} never reads storage`, async () => {
    const test = session()
    await test.read(ids)
    assert.equal(test.state.previews.length, 0)
    assert.equal(test.state.reads.length, 0)
    assert.equal(test.state.errors[0].code, ids.length === 2 ? 'duplicate' : 'count')
  })
}

for (const [reason, getBadItem, code] of [
  ['deleted item', () => undefined, 'missing'],
  ['image', () => ({ id: 'bad', kind: 'image' }), 'not-text'],
  ['files', () => ({ id: 'bad', kind: 'files' }), 'not-text'],
  ['read rejection', () => Promise.reject(new Error('PRIVATE SYNTHETIC BODY')), 'read-failed'],
  ['synchronous read throw', () => { throw new Error('PRIVATE SYNTHETIC BODY') }, 'read-failed'],
  ['wrong record', () => textItem('different'), 'read-failed'],
  ['malformed text', () => ({ ...textItem('bad'), text: undefined }), 'read-failed'],
]) {
  await check(`${reason} fails atomically and keeps the full selection retryable`, async () => {
    const test = session(), ids = Object.freeze(['first', 'bad', 'last'])
    await test.read(ids, 'newline', (id) => id === 'bad' ? getBadItem() : textItem(id))
    assert.deepEqual(test.state.reads, ids)
    assert.deepEqual(test.state.errors, [{ code, id: 'bad' }])
    assert.equal(test.state.previews.length, 0)
    assert.deepEqual(ids, ['first', 'bad', 'last'])
    await test.read(ids)
    assert.equal(test.state.previews[0].text, 'FULL_first\nFULL_bad\nFULL_last')
  })
}

for (const interruption of ['cancel', 'leave', 'disable', 'unmount', 'new selection', 'separator change', 'reorder', 'remove']) {
  for (const outcome of ['success', 'failure']) {
    await check(`${interruption} suppresses late ${outcome}`, async () => {
      const test = session(), late = deferred()
      const pending = test.read(['slow', 'second'], 'newline', (id) => id === 'slow' ? late.promise : textItem(id))
      test.reader.invalidate()
      if (outcome === 'success') late.resolve(textItem('slow', 'STALE_BODY'))
      else late.reject(new Error('STALE_ERROR'))
      await pending
      assert.deepEqual(test.state.previews, [])
      assert.deepEqual(test.state.errors, [])
      assert.equal(test.reader.isCurrent(null), false)
    })
  }
}

for (const firstToFinish of ['old', 'new']) {
  for (const oldFails of [false, true]) {
    await check(`new request supersedes old request; ${firstToFinish} finishes first, old fails=${oldFails}`, async () => {
      const test = session(), oldRead = deferred(), newRead = deferred()
      const old = test.read(['same', 'second'], 'newline', (id) => id === 'same' ? oldRead.promise : textItem(id))
      const next = test.read(['same', 'second'], 'blankline', (id) => id === 'same' ? newRead.promise : textItem(id))
      const finishOld = () => oldFails ? oldRead.reject(new Error('STALE_ERROR')) : oldRead.resolve(textItem('same', 'STALE_BODY'))
      if (firstToFinish === 'old') {
        finishOld()
        await old
        assert.equal(test.state.previews.length, 0)
        newRead.resolve(textItem('same', 'CURRENT_BODY'))
      } else {
        newRead.resolve(textItem('same', 'CURRENT_BODY'))
        await next
        finishOld()
      }
      await Promise.all([old, next])
      assert.equal(test.state.previews.length, 1)
      assert.equal(test.state.previews[0].text, 'CURRENT_BODY\n\nFULL_second')
      assert.deepEqual(test.state.errors, [])
      assert.equal(test.reader.isCurrent(test.state.previews[0]), true)
    })
  }
}

await check('a new or invalid request synchronously revokes the displayed preview', async () => {
  const test = session()
  await test.read(['a', 'b'])
  const previous = test.state.previews[0], late = deferred()
  const pending = test.read(['a', 'c'], 'newline', (id) => id === 'c' ? late.promise : textItem(id))
  assert.equal(test.reader.isCurrent(previous), false)
  assert.equal(test.deliver(previous), null)
  late.resolve(textItem('c'))
  await pending
  const current = test.state.previews[1]
  assert.equal(test.reader.isCurrent(current), true)
  await test.read(['one'])
  assert.equal(test.reader.isCurrent(current), false)
})

await check('cancel and retry the same IDs cannot revive earlier work', async () => {
  const test = session(), oldRead = deferred(), currentRead = deferred()
  const old = test.read(['a', 'b'], 'newline', (id) => id === 'a' ? oldRead.promise : textItem(id))
  test.reader.invalidate()
  const current = test.read(['a', 'b'], 'newline', (id) => id === 'a' ? currentRead.promise : textItem(id))
  oldRead.resolve(textItem('a', 'STALE_BODY'))
  await old
  assert.equal(test.state.previews.length, 0)
  currentRead.resolve(textItem('a', 'CURRENT_BODY'))
  await current
  assert.equal(test.state.previews[0].text, 'CURRENT_BODY\nFULL_b')
})

console.log(`Clipboard text merge: ${passed} important logic checks passed (synthetic data only)`)
