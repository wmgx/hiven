import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const code = ts.transpileModule(await readFile(new URL('../src/plugins/encode-decode/saveClipboardPng.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const { saveClipboardPng } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const png = new Uint8Array([137,80,78,71])
for (const outcome of [{ status: 'saved', pathCopied: true }, { status: 'saved', pathCopied: false }, { status: 'cancelled' }, new Error('write failed')]) {
  const calls = []
  const storage = { blob: {
    put: async value => { assert.equal(value.bytes, png); calls.push('put'); return { blobId: 'owned' } },
    savePng: async (id, options) => { assert.equal(id, 'owned'); assert.equal(options.copyPathToClipboard, true); assert.match(options.suggestedFilename, /^screenshot-.*\.png$/); calls.push('save'); if (outcome instanceof Error) throw outcome; return outcome },
    delete: async id => { assert.equal(id, 'owned'); calls.push('delete'); throw new Error('cleanup revoked') },
  } }
  const result = saveClipboardPng(storage, png, () => true)
  if (outcome instanceof Error) await assert.rejects(result, /write failed/)
  else assert.deepEqual(await result, outcome)
  assert.deepEqual(calls, ['put', 'save', 'delete'])
}
{
  let current = true, deleted = false
  const storage = { blob: { put: async () => { current = false; return { blobId: 'owned' } }, savePng: async () => assert.fail('stale view must not open dialog'), delete: async () => { deleted = true } } }
  assert.deepEqual(await saveClipboardPng(storage, png, () => current), { status: 'cancelled' })
  assert.equal(deleted, true)
}
assert.deepEqual(await saveClipboardPng({}, png, () => false), { status: 'cancelled' })
console.log('Explicit image save preserves outcomes, rejects stale owners, and always releases its own blob.')
