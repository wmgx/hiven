import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
const require = createRequire(import.meta.url)
const entries = new Map()
let writes = 0, fail = false
const storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => { if (fail) throw Error('QuotaExceeded'); writes++; entries.set(key, value) }, removeItem: key => entries.delete(key) }
globalThis.localStorage = storage
globalThis.window = { localStorage: storage }
const compiled = ts.transpileModule(readFileSync('src/workspace/quickEditor/quickEditorStore.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function store() { const exports = {}; vm.runInNewContext(compiled, { exports, require, localStorage: storage, console }); return exports.useQuickEditorStore }
const api = store(), s = () => api.getState()
const a = s().activePaneId, fullA = 'A full draft\r\n  空格  \nEND-A', fullB = 'B full draft\n  whitespace  \nEND-B'
s().setText(fullA)
const b = s().createPane({ text: fullB })
const durable = entries.get('hiven-quick-editor'), count = writes
assert.equal(s().closePane(b), false)
const first = s().pendingPaneClose
assert.equal(first.paneId, b)
assert.equal(s().panes[b].text, fullB)
assert.equal(entries.get('hiven-quick-editor'), durable)
assert.equal(writes, count, 'requesting confirmation must not publish stale persisted state')
s().closeActivePane(); assert.equal(s().pendingPaneClose, first)
s().cancelPaneClose(first); assert.equal(s().pendingPaneClose, null)
assert.equal(s().confirmPaneClose(first), false)
assert.equal(s().panes[b].text, fullB)
// A -> B -> A content is a new revision, never permission to close the old draft.
s().closePane(b); const aba = s().pendingPaneClose
s().setPaneText(b, 'new draft'); s().setPaneText(b, fullB)
assert.equal(s().confirmPaneClose(aba), false)
assert.ok(s().panes[b].revision > aba.revision)
s().closePane(b); const focus = s().pendingPaneClose
s().setActivePaneId(a); assert.equal(s().confirmPaneClose(focus), false)
s().setActivePaneId(b); s().closePane(b); const overwrite = s().pendingPaneClose
s().overwriteActiveText(fullB, { source: 'synthetic' }); assert.equal(s().confirmPaneClose(overwrite), false)
s().closePane(b); const restore = s().pendingPaneClose
s().restoreExternalVersion(s().externalVersionHistory[0].id); assert.equal(s().confirmPaneClose(restore), false)
// Cross-window revision change must not be overwritten by an old close intent.
s().closePane(b); const crossWindow = s().pendingPaneClose
const other = store(); other.getState().setPaneText(b, 'new remote synthetic draft')
const newer = entries.get('hiven-quick-editor')
assert.equal(s().confirmPaneClose(crossWindow), false)
assert.equal(entries.get('hiven-quick-editor'), newer)
s().cancelPaneClose(crossWindow)
await api.persist.rehydrate(); assert.equal(s().pendingPaneClose, null)
assert.equal(s().panes[b].text, 'new remote synthetic draft')
s().closePane(b); const quota = s().pendingPaneClose
const memory = s(); fail = true
assert.equal(s().confirmPaneClose(quota), false)
assert.equal(s(), memory); assert.equal(entries.get('hiven-quick-editor'), newer)
s().cancelPaneClose(quota); fail = false
s().closePane(b); const final = s().pendingPaneClose
assert.equal(s().confirmPaneClose(final), true)
assert.equal(s().confirmPaneClose(final), false)
assert.equal(s().panes[b], undefined); assert.equal(s().panes[a].text, fullA)
assert.equal(store().getState().panes[a].text, fullA)
const empty = s().createPane(); assert.equal(s().closePane(empty), true); assert.equal(s().pendingPaneClose, null)
const whitespace = s().createPane({ text: ' \n\t' }); assert.equal(s().closePane(whitespace), false)
assert.equal(JSON.parse(entries.get('hiven-quick-editor')).state.pendingPaneClose, undefined)
assert.equal(store().getState().pendingPaneClose, null)
s().reset(); assert.equal(s().confirmPaneClose(final), false)
console.log('PASS pane close: default retain, explicit consume, edit/ABA/focus/overwrite/restore invalidation, durable cross-window checks, quota safety, empty/whitespace and rehydrate')
