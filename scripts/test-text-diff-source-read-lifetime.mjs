#!/usr/bin/env node
// Exercise the plugin's real source reader with controlled promises and synthetic text only.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const code = ts.transpileModule(readFileSync('src/plugins/textDiff/sourceReadLifetime.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2023 },
}).outputText
const { createDiffSourceReader } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const clipboard = { sourceId: 'clipboard', kind: 'clipboard', title: 'Synthetic clipboard' }
const snapshot = {
  sourceId: 'pane:synthetic', kind: 'editor-pane', paneId: 'synthetic', origin: 'editor',
  title: 'Synthetic editor snapshot', text: '  SNAPSHOT_B\r\n\n',
}
const failRead = () => { throw new Error('Unexpected clipboard read') }
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function side(text = '  EXISTING DRAFT\r\n\n') {
  const reader = createDiffSourceReader()
  const state = { text, imported: [], errors: 0, clipboardReads: 0 }
  return {
    reader, state,
    select(source, read = failRead) {
      return reader.select(source, () => {
        state.clipboardReads += 1
        return read()
      }, imported => {
        state.text = imported.text
        state.imported.push(imported)
      }, () => { state.errors += 1 })
    },
    edit(next) {
      reader.invalidate()
      state.text = next
    },
  }
}
let passed = 0
async function check(name, run) {
  try { await run(); passed += 1 }
  catch (error) { error.message = `${name}: ${error.message}`; throw error }
}

for (const latest of [snapshot, { sourceId: 'empty', kind: 'empty', title: 'Empty' }]) {
  for (const outcome of ['resolve', 'reject']) await check(`${latest.kind} choice supersedes clipboard ${outcome}`, async () => {
    const left = side(), a = deferred()
    const pending = left.select(clipboard, () => a.promise)
    await left.select(latest)
    const current = latest.text ?? ''
    assert.equal(left.state.text, current)
    if (outcome === 'resolve') a.resolve('LATE_A')
    else a.reject(new Error('Late read failed'))
    await pending
    assert.equal(left.state.text, current)
    assert.equal(left.state.errors, 0)
    assert.equal(left.state.clipboardReads, 1, 'a pane snapshot or empty choice never reads clipboard')
    assert.deepEqual(left.state.imported, [{ sourceId: latest.sourceId, kind: 'empty', title: latest.title, text: current }],
      'selected sources stay local snapshots without paneId/origin write-through bindings')
  })
}

for (const firstToFinish of ['older', 'newer']) await check(`same source selected twice, ${firstToFinish} completes first`, async () => {
  const left = side(), older = deferred(), newer = deferred()
  const before = left.state.text
  const a = left.select(clipboard, () => older.promise)
  const b = left.select(clipboard, () => newer.promise)
  if (firstToFinish === 'older') {
    older.resolve('OLD')
    await a
    assert.equal(left.state.text, before, 'an obsolete read cannot fill the gap while the latest is pending')
    newer.resolve('  NEW\r\n\n')
  } else {
    newer.resolve('  NEW\r\n\n')
    await b
    older.resolve('OLD')
  }
  await Promise.all([a, b])
  assert.equal(left.state.text, '  NEW\r\n\n')
  assert.equal(left.state.imported.length, 1)
})

await check('returning to an earlier source never revives its old read', async () => {
  const left = side(), older = deferred(), current = deferred()
  const a = left.select(clipboard, () => older.promise)
  await left.select(snapshot)
  const b = left.select(clipboard, () => current.promise)
  older.resolve('OBSOLETE_SAME_SOURCE')
  await a
  assert.equal(left.state.text, snapshot.text)
  current.resolve('CURRENT_SAME_SOURCE')
  await b
  assert.equal(left.state.text, 'CURRENT_SAME_SOURCE')
})

for (const outcome of ['resolve', 'reject']) await check(`editing revokes pending ${outcome} without touching the new draft`, async () => {
  const left = side(), read = deferred()
  const pending = left.select(clipboard, () => read.promise)
  left.edit('  MANUAL DRAFT\r\n\n')
  if (outcome === 'resolve') read.resolve('LATE_A')
  else read.reject(new Error('Late read failed'))
  await pending
  assert.equal(left.state.text, '  MANUAL DRAFT\r\n\n')
  assert.equal(left.state.errors, 0)
  assert.equal(left.state.imported.length, 0)
})

await check('both comparison sides can read independently', async () => {
  const left = side(), right = side(), a = deferred(), b = deferred()
  const l = left.select(clipboard, () => a.promise)
  const r = right.select(clipboard, () => b.promise)
  b.resolve('RIGHT')
  await r
  a.resolve('LEFT')
  await l
  assert.equal(left.state.text, 'LEFT')
  assert.equal(right.state.text, 'RIGHT')
})

await check('editing one side leaves the other pending read current', async () => {
  const left = side(), right = side(), a = deferred(), b = deferred()
  const l = left.select(clipboard, () => a.promise)
  const r = right.select(clipboard, () => b.promise)
  left.edit('EDITED_LEFT')
  a.resolve('OBSOLETE_LEFT')
  b.resolve('CURRENT_RIGHT')
  await Promise.all([l, r])
  assert.equal(left.state.text, 'EDITED_LEFT')
  assert.equal(right.state.text, 'CURRENT_RIGHT')
})

await check('replacing both drafts revokes both pending reads', async () => {
  const left = side('LEFT'), right = side('RIGHT'), a = deferred(), b = deferred()
  const l = left.select(clipboard, () => a.promise)
  const r = right.select(clipboard, () => b.promise)
  const original = left.state.text
  left.edit(right.state.text)
  right.edit(original)
  a.resolve('STALE_LEFT')
  b.reject(new Error('Stale right failure'))
  await Promise.all([l, r])
  assert.equal(left.state.text, 'RIGHT')
  assert.equal(right.state.text, 'LEFT')
  assert.equal(left.state.errors + right.state.errors, 0)
})

for (const lifecycle of ['hide/reopen', 'effect cleanup/replay']) await check(`${lifecycle} cancels old reads while allowing new choices`, async () => {
  const left = side(), right = side(), a = deferred(), b = deferred()
  const l = left.select(clipboard, () => a.promise)
  const r = right.select(clipboard, () => b.promise)
  const beforeLeft = left.state.text, beforeRight = right.state.text
  left.reader.invalidate()
  right.reader.invalidate()
  a.resolve('STALE_LEFT')
  b.reject(new Error('Stale right failure'))
  await Promise.all([l, r])
  assert.equal(left.state.text, beforeLeft)
  assert.equal(right.state.text, beforeRight)
  assert.equal(left.state.errors + right.state.errors, 0)
  // The hidden window can reuse these readers, and React can replay an effect setup.
  await left.select(clipboard, async () => 'REOPENED_LEFT')
  await right.select(clipboard, async () => 'REOPENED_RIGHT')
  assert.equal(left.state.text, 'REOPENED_LEFT')
  assert.equal(right.state.text, 'REOPENED_RIGHT')
})

await check('cleanup then a new read never restores the cancelled generation', async () => {
  const left = side(), old = deferred(), next = deferred()
  const a = left.select(clipboard, () => old.promise)
  left.reader.invalidate()
  const b = left.select(clipboard, () => next.promise)
  next.resolve('NEW_LIFETIME')
  await b
  old.resolve('OLD_LIFETIME')
  await a
  assert.equal(left.state.text, 'NEW_LIFETIME')
})

for (const synchronous of [false, true]) await check(`current ${synchronous ? 'synchronous' : 'async'} read failure preserves the draft and allows retry`, async () => {
  const left = side(), failed = deferred()
  const before = left.state.text
  const pending = left.select(clipboard, synchronous ? () => { throw new Error('Read failed') } : () => failed.promise)
  if (!synchronous) failed.reject(new Error('Read failed'))
  await pending
  assert.equal(left.state.text, before)
  assert.equal(left.state.imported.length, 0)
  assert.equal(left.state.errors, 1)
  await left.select(clipboard, async () => '  RETRIED\r\n\n')
  assert.equal(left.state.text, '  RETRIED\r\n\n')
  assert.equal(left.state.errors, 1)
})

await check('failure of the latest read does not revive an older success', async () => {
  const left = side(), old = deferred(), latest = deferred()
  const before = left.state.text
  const a = left.select(clipboard, () => old.promise)
  const b = left.select(clipboard, () => latest.promise)
  latest.reject(new Error('Current failure'))
  await b
  old.resolve('OLD_SUCCESS')
  await a
  assert.equal(left.state.text, before)
  assert.equal(left.state.errors, 1)
  assert.equal(left.state.imported.length, 0)
})

console.log(`Text Diff source read lifetime passed: ${passed} controlled asynchronous cases`)
