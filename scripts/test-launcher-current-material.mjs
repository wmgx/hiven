#!/usr/bin/env node
/** Important material transitions only; no UI or source-text assertions. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const compiled = ts.transpileModule(readFileSync('src/launcher/clipboard/currentMaterial.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText
const { acceptMaterialHandoff, replaceCurrentMaterial, forgetPreviousMaterial, discardCurrentMaterial, restorePreviousMaterial, canEditMaterialText, reconcileMaterialTextInput } =
  await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

let serial = 0
const block = (source, extras = {}) => ({
  id: `material:${++serial}`, source, createdAt: serial, kind: 'text',
  title: source, payloadText: `  full material ${serial}\n\n`,
  removable: true, validity: 'unknown', ...extras,
})
let passed = 0
function check(name, run) {
  try { run(); passed++ } catch (error) { error.message = `${name}: ${error.message}`; throw error }
}

for (const source of ['clipboard', 'history-item', 'query', 'tool-result', 'editor-selection']) {
  check(`${source} material restores its full original object once`, () => {
    const original = block(source, { meta: { paneId: 'pane', charCount: 111 }, secretMasked: true })
    const result = block('tool-result')
    const processed = acceptMaterialHandoff(replaceCurrentMaterial(original), result, true)
    assert.equal(processed.block, result)
    assert.equal(processed.previousBlock, original)
    const restored = restorePreviousMaterial(processed)
    assert.equal(restored.block, original)
    assert.equal(restored.previousBlock, null)
    assert.equal(restorePreviousMaterial(restored), restored, 'restoration is consumed; no redo')
    assert.equal(acceptMaterialHandoff(restored, { ...result }, true), restored,
      'a duplicate delivered after restore cannot put the result back')
  })
}

check('repeated handoff does not replace original with processed material', () => {
  const original = block('query'), result = block('tool-result')
  const state = acceptMaterialHandoff(replaceCurrentMaterial(original), result, true)
  assert.equal(acceptMaterialHandoff(state, { ...result }, true), state)
  assert.equal(state.previousBlock, original)
})

check('independent tool output keeps literal safety without borrowing an old filename', () => {
  const original = block('query', { meta: { textOrigin: 'file-content', fileName: 'sample.json' } })
  const result = block('tool-result', { payloadText: '/synthetic/another.json', meta: { charCount: 23 } })
  const state = acceptMaterialHandoff(replaceCurrentMaterial(original), result, true)
  assert.equal(state.block.meta.textOrigin, 'file-content', 'path-shaped output stays literal')
  assert.equal(state.block.meta.fileName, undefined, 'an unrelated result must not claim the previous file')
  assert.equal(state.block.meta.charCount, 23)
  assert.equal(restorePreviousMaterial(state).block, original, 'restore retains the actual file identity')
  const named = block('tool-result', { meta: { textOrigin: 'file-content', fileName: 'explicit.txt' } })
  assert.equal(acceptMaterialHandoff(state, named, true).block, named, 'explicit new provenance is unchanged')
})

check('sequential processing retains only the immediately preceding material', () => {
  const original = block('query'), first = block('tool-result'), second = block('tool-result')
  const state = acceptMaterialHandoff(acceptMaterialHandoff(replaceCurrentMaterial(original), first, true), second, true)
  assert.equal(state.previousBlock, first)
  const restored = restorePreviousMaterial(state)
  assert.equal(restored.block, first)
  assert.equal(restored.previousBlock, null)
})

for (const source of ['query', 'history-item', 'clipboard']) {
  check(`explicit ${source} replacement discards the previous restore`, () => {
    const before = acceptMaterialHandoff(replaceCurrentMaterial(block('query')), block('tool-result'), true)
    const replacement = block(source)
    const state = acceptMaterialHandoff(before, replacement, true)
    assert.equal(state.block, replacement)
    assert.equal(state.previousBlock, null)
    assert.equal(restorePreviousMaterial(state), state)
  })
}

check('dismissal immediately forgets restoration while retaining the animated token', () => {
  const state = acceptMaterialHandoff(replaceCurrentMaterial(block('query')), block('tool-result'), true)
  const removed = forgetPreviousMaterial(state)
  assert.equal(removed.block, state.block)
  assert.equal(removed.previousBlock, null)
  const newer = acceptMaterialHandoff(removed, block('tool-result'), false)
  assert.equal(newer.previousBlock, null, 'an exiting/dismissed token is not previous material')
})

check('empty material, closed session and consumed session never offer restoration', () => {
  assert.equal(acceptMaterialHandoff(replaceCurrentMaterial(null), block('tool-result'), true).previousBlock, null)
  assert.equal(acceptMaterialHandoff(replaceCurrentMaterial(block('query')), block('tool-result'), false).previousBlock, null)
  const consumed = replaceCurrentMaterial(null)
  assert.equal(consumed.block, null)
  assert.equal(consumed.previousBlock, null)
  assert.equal(consumed.lastHandoffKey, null)
})

check('removed or consumed material ignores its last handoff until new material or a new session', () => {
  const result = block('tool-result')
  const state = acceptMaterialHandoff(replaceCurrentMaterial(block('query')), result, true)
  const discarded = discardCurrentMaterial(state)
  assert.equal(discarded.block, null)
  assert.equal(discarded.previousBlock, null)
  assert.equal(acceptMaterialHandoff(discarded, { ...result }, true), discarded)
  const next = block('tool-result')
  const replaced = acceptMaterialHandoff(discarded, next, true)
  assert.equal(replaced.block, next)
  assert.equal(replaced.previousBlock, null)
  assert.equal(acceptMaterialHandoff(replaceCurrentMaterial(null), result, true).block, result)
})

check('a new session can accept an old backup without inheriting its restore point', () => {
  const result = block('tool-result')
  const reopened = acceptMaterialHandoff(replaceCurrentMaterial(null), result, true)
  assert.equal(reopened.block, result)
  assert.equal(reopened.previousBlock, null)
})

check('same text from a distinct handoff remains a distinct processing step', () => {
  const first = block('tool-result'), second = block('tool-result', { payloadText: first.payloadText })
  const state = acceptMaterialHandoff(replaceCurrentMaterial(first), second, true)
  assert.equal(state.block, second)
  assert.equal(state.previousBlock, first)
})

check('only visible real text may be edited', () => {
  assert.equal(canEditMaterialText(null), false)
  for (const payloadText of ['', '  \n\n', '{"bad":}']) assert.equal(canEditMaterialText(block('query', { payloadText })), true)
  for (const extras of [
    { payloadText: undefined }, { kind: 'image' }, { kind: 'files' },
    { payloadImage: { blobId: 'image' } }, { payloadFiles: { paths: ['/tmp/example'] } },
    { secretMasked: true }, { kind: 'secret' }, { kind: 'secret-like' }, { payloadText: 'binary\0payload' },
  ]) assert.equal(canEditMaterialText(block('query', extras)), false)
})

check('textarea reconciliation preserves whitespace and uniform CRLF', () => {
  for (const original of ['  first\n\nsecond  \n', 'first\r\n\r\nsecond\r\n', 'first\rsecond\nthird\r\n']) {
    assert.equal(reconcileMaterialTextInput(original, original), original)
    assert.equal(reconcileMaterialTextInput(original, original.replace(/\r\n|\r/g, '\n')), original)
  }
  assert.equal(reconcileMaterialTextInput('first\r\n\r\nlast\r\n', '  changed\n\nlast\n'), '  changed\r\n\r\nlast\r\n')
  assert.equal(reconcileMaterialTextInput('first\nlast', ' first\n\nlast  \n'), ' first\n\nlast  \n')
  assert.equal(reconcileMaterialTextInput('mixed\r\nline\nend', 'mixed\nline\nchanged'), 'mixed\nline\nchanged')
  assert.equal(reconcileMaterialTextInput('before', ''), '')
})

console.log(`Launcher current material passed: ${passed} material lifecycle cases`)
