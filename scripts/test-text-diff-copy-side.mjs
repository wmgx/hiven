#!/usr/bin/env node
// Exercise the plugin's clipboard gate with controlled promises and synthetic text only.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const code = ts.transpileModule(readFileSync('src/plugins/textDiff/copySideText.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2023 },
}).outputText
const { createDiffSideCopier } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function harness() {
  const copier = createDiffSideCopier()
  const writes = [], pending = [], results = []
  return {
    copier, writes, pending, results,
    button(side, text) {
      const request = { side, text, revision: copier.getRevision() }
      return (write = async () => {}) => copier.copy(request, snapshot => {
        writes.push(snapshot)
        return write(snapshot)
      }, side => pending.push(side), success => results.push(success))
    },
  }
}
let passed = 0
async function check(name, run) {
  try { await run(); passed += 1 }
  catch (error) { error.message = `${name}: ${error.message}`; throw error }
}

for (const side of ['original', 'modified']) {
  for (const text of ['  \t\r\n\n', '  Current draft\r\n中文🙂\t\r\n\n']) {
    await check(`${side} writes the entire exact snapshot`, async () => {
      const h = harness()
      const write = deferred()
      const copying = h.button(side, text)(() => write.promise)
      assert.deepEqual(h.writes, [text])
      assert.deepEqual(h.pending, [side], 'busy feedback starts before host completion')
      assert.deepEqual(h.results, [])
      write.resolve()
      await copying
      assert.deepEqual(h.pending, [side, null])
      assert.deepEqual(h.results, [true])
    })
  }
  await check(`${side} rejects only an empty string`, async () => {
    const h = harness()
    await h.button(side, '')()
    assert.deepEqual(h.writes, [])
    assert.deepEqual(h.pending, [])
    assert.deepEqual(h.results, [])
  })
}

for (const side of ['original', 'modified']) await check(`${side} locks repeat and opposite-side writes synchronously`, async () => {
  const h = harness(), write = deferred()
  const other = side === 'original' ? 'modified' : 'original'
  const start = h.button(side, 'FIRST')
  const copying = start(() => write.promise)
  await start()
  await h.button(other, 'SECOND')()
  assert.deepEqual(h.writes, ['FIRST'])
  assert.deepEqual(h.pending, [side])
  write.resolve()
  await copying
  await h.button(other, 'SECOND')()
  assert.deepEqual(h.writes, ['FIRST', 'SECOND'])
  assert.deepEqual(h.results, [true, true])
})

await check('editing rejects a retained old button and writes the current full draft', async () => {
  const h = harness()
  const oldButton = h.button('original', 'OLD HIGHLIGHT SNAPSHOT')
  h.copier.invalidate()
  await oldButton()
  assert.deepEqual(h.writes, [])
  await h.button('original', '  CURRENT\r\n\n')()
  assert.deepEqual(h.writes, ['  CURRENT\r\n\n'])
})

for (const outcome of ['resolve', 'reject']) await check(`invalidation revokes late ${outcome} without unlocking an issued write`, async () => {
  const h = harness(), write = deferred()
  const oldButton = h.button('original', '  SUBMITTED SNAPSHOT\r\n\n')
  const copying = oldButton(() => write.promise)
  h.copier.invalidate()
  const nextButton = h.button('modified', '  CURRENT DRAFT\r\n\n')
  await nextButton()
  assert.deepEqual(h.writes, ['  SUBMITTED SNAPSHOT\r\n\n'], 'invalidation cannot cancel a system write or allow reordering')
  if (outcome === 'resolve') write.resolve()
  else write.reject(new Error('Late permission/host failure'))
  await copying
  assert.deepEqual(h.results, [], 'an obsolete result cannot describe the current draft')
  assert.deepEqual(h.pending, ['original', null], 'the actual lock releases even when feedback is stale')
  await oldButton()
  assert.equal(h.writes.length, 1, 'settlement does not revive a stale button')
  await nextButton()
  assert.deepEqual(h.writes, ['  SUBMITTED SNAPSHOT\r\n\n', '  CURRENT DRAFT\r\n\n'])
  assert.deepEqual(h.results, [true])
})

for (const synchronous of [false, true]) await check(`${synchronous ? 'synchronous denial' : 'rejected host write'} releases both buttons for retry`, async () => {
  const h = harness(), denied = deferred()
  const text = '  RETAIN THIS DRAFT\r\n\n'
  const retry = h.button('modified', text)
  const copying = retry(synchronous ? () => { throw new Error('Permission denied') } : () => denied.promise)
  if (!synchronous) denied.reject(new Error('Clipboard unavailable'))
  await copying
  assert.deepEqual(h.results, [false])
  assert.deepEqual(h.pending, ['modified', null])
  await retry()
  assert.deepEqual(h.writes, [text, text], 'failure does not consume or transform the snapshot')
  assert.deepEqual(h.results, [false, true])
})

await check('hide/reopen without editing renews buttons while retaining the same draft', async () => {
  const h = harness()
  const text = 'UNCHANGED DRAFT'
  const oldButton = h.button('original', text)
  h.copier.invalidate()
  await oldButton()
  await h.button('original', text)()
  assert.deepEqual(h.writes, [text])
})

console.log(`Text Diff whole-side copy passed: ${passed} controlled asynchronous cases`)
