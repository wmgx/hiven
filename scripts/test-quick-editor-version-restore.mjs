import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const compiled = ts.transpileModule(readFileSync('src/workspace/quickEditor/quickEditorStore.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const entries = new Map()
let writes = 0
let rejectWrite = false
const storage = {
  getItem: (key) => entries.get(key) ?? null,
  setItem: (key, value) => {
    if (rejectWrite) throw new Error('QuotaExceededError')
    writes += 1
    entries.set(key, value)
  },
  removeItem: (key) => entries.delete(key),
}
globalThis.localStorage = storage
globalThis.window = { localStorage: storage }

function createStore() {
  const exports = {}
  vm.runInNewContext(compiled, { exports, require, localStorage: storage, console })
  return exports.useQuickEditorStore
}

const api = createStore()
const s = () => api.getState()
const original = 'ORIGINAL historical version\nline 2\n'
const replacement = 'REPLACEMENT from tool'
const current = 'CURRENT unsaved-looking draft\nkeep me\n'
s().setText(original)
s().overwriteActiveText(replacement, { source: 'synthetic' })
const originalVersionId = s().externalVersionHistory[0].id
s().setText(current)

const durableBeforePreview = entries.get('hiven-quick-editor')
const writesBeforePreview = writes
const preview = s().requestExternalVersionRestore(originalVersionId)
assert.ok(preview)
assert.equal(preview.version.text, original)
assert.equal(s().text, current, 'Preview must leave the live draft untouched')
assert.equal(entries.get('hiven-quick-editor'), durableBeforePreview)
assert.equal(writes, writesBeforePreview, 'Preview must not write persistent state')
s().cancelExternalVersionRestore(preview)
assert.equal(s().text, current)
assert.equal(entries.get('hiven-quick-editor'), durableBeforePreview)

const confirmed = s().requestExternalVersionRestore(originalVersionId)
assert.equal(s().confirmExternalVersionRestore(confirmed), 'restored')
assert.equal(s().text, original)
assert.equal(s().externalVersionHistory[0].text, current, 'Confirm must archive the displaced draft first')
assert.equal(s().externalVersionHistory[0].source, 'history-restore')
assert.equal(createStore().getState().text, original, 'The archive + restore commit must be durable')

const currentVersionId = s().externalVersionHistory[0].id
const recoverCurrent = s().requestExternalVersionRestore(currentVersionId)
assert.equal(s().confirmExternalVersionRestore(recoverCurrent), 'restored')
assert.equal(s().text, current, 'The displaced draft must be recoverable from History')

const originalAgain = s().externalVersionHistory.find((entry) => entry.text === original)
assert.ok(originalAgain)
const editedPreview = s().requestExternalVersionRestore(originalAgain.id)
s().setText('CONCURRENT local edit')
assert.equal(s().confirmExternalVersionRestore(editedPreview), 'stale')
assert.equal(s().text, 'CONCURRENT local edit', 'A changed pane must not be overwritten')
s().cancelExternalVersionRestore(editedPreview)

const invalidVersion = s().requestExternalVersionRestore(originalAgain.id)
s().clearExternalVersionHistory()
assert.equal(s().confirmExternalVersionRestore(invalidVersion), 'stale')
assert.equal(s().text, 'CONCURRENT local edit', 'A removed version must not be restored from a stale preview')
s().cancelExternalVersionRestore(invalidVersion)

s().overwriteActiveText('LATEST replacement', { source: 'synthetic' })
const concurrentVersionId = s().externalVersionHistory[0].id
const crossWindowPreview = s().requestExternalVersionRestore(concurrentVersionId)
const other = createStore()
const paneId = other.getState().activePaneId
other.getState().setPaneText(paneId, 'NEWER cross-window draft')
assert.equal(s().confirmExternalVersionRestore(crossWindowPreview), 'stale')
assert.equal(createStore().getState().text, 'NEWER cross-window draft', 'Stale memory must not replace newer durable state')
s().cancelExternalVersionRestore(crossWindowPreview)

await api.persist.rehydrate()
const failureVersion = s().externalVersionHistory[0]
const failedPreview = s().requestExternalVersionRestore(failureVersion.id)
const memoryBeforeFailure = s()
const durableBeforeFailure = entries.get('hiven-quick-editor')
rejectWrite = true
assert.equal(s().confirmExternalVersionRestore(failedPreview), 'storage-error')
assert.equal(s(), memoryBeforeFailure, 'A failed write must publish no in-memory replacement')
assert.equal(entries.get('hiven-quick-editor'), durableBeforeFailure)
rejectWrite = false
assert.equal(s().confirmExternalVersionRestore(failedPreview), 'restored', 'The same preview can retry after storage recovers')
assert.equal(s().externalVersionHistory[0].text, 'NEWER cross-window draft')

assert.equal(s().requestExternalVersionRestore('missing-version'), null)

entries.clear()
const languageApi = createStore()
const languageState = () => languageApi.getState()
languageState().setText('SAME TEXT')
languageState().overwriteActiveText('temporary replacement', { source: 'synthetic' })
const plaintextVersion = languageState().externalVersionHistory[0]
languageState().setText('SAME TEXT')
languageState().setLanguage('json')
const languagePreview = languageState().requestExternalVersionRestore(plaintextVersion.id)
assert.equal(languageState().confirmExternalVersionRestore(languagePreview), 'restored')
assert.equal(languageState().externalVersionHistory[0].text, 'SAME TEXT')
assert.equal(languageState().externalVersionHistory[0].language, 'json', 'Same text with a changed language must still be archived')
assert.equal(languageState().externalVersionHistory[0].languageSource, 'manual')

entries.clear()
const legacyAt = 1700000000000
const legacyPane = {
  id: 'quick-pane-1',
  text: 'CURRENT legacy-era draft',
  revision: 4,
  language: 'plaintext',
  languageSource: 'auto',
  cursorPosition: { lineNumber: 1, column: 1 },
  scrollPosition: { scrollTop: 0, scrollLeft: 0 },
}
entries.set('hiven-quick-editor', JSON.stringify({
  state: {
    panes: { [legacyPane.id]: legacyPane },
    paneOrder: [legacyPane.id],
    activePaneId: legacyPane.id,
    splitDirection: 'horizontal',
    text: legacyPane.text,
    language: legacyPane.language,
    languageSource: legacyPane.languageSource,
    cursorPosition: legacyPane.cursorPosition,
    scrollPosition: legacyPane.scrollPosition,
    overwriteSnapshot: {
      paneId: legacyPane.id,
      text: 'LEGACY snapshot',
      language: 'markdown',
      languageSource: 'manual',
      at: legacyAt,
      source: 'legacy-test',
    },
  },
  version: 0,
}))
const legacyApi = createStore()
const legacyState = () => legacyApi.getState()
const legacyVersion = legacyState().externalVersionHistory[0]
assert.equal(legacyVersion.id, `qe-ver-legacy-${legacyAt}`)
const legacyPreview = legacyState().requestExternalVersionRestore(legacyVersion.id)
assert.equal(legacyState().confirmExternalVersionRestore(legacyPreview), 'restored', 'A migrated legacy snapshot must restore on its first attempt')
assert.equal(legacyState().text, 'LEGACY snapshot')
assert.equal(legacyState().externalVersionHistory[0].text, legacyPane.text)

console.log('PASS Quick Editor safe version preview/restore: cancel, archive/recovery, language identity, legacy migration, stale pane/version, cross-window and storage failure')
