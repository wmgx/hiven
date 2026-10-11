import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { randomUUID } from 'node:crypto'
import ts from 'typescript'
const storage = new Map()
let failWrites = false
const browser = { addEventListener() {} }
function load(name, dependencies = {}) {
  const module = { exports: {} }
  const code = ts.transpileModule(readFileSync(`src/workspace/launcher/${name}.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
  }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, require: id => {
    if (!(id in dependencies)) throw Error(id)
    return dependencies[id]
  }, crypto: { randomUUID }, window: browser, localStorage: { getItem: k => storage.get(k), setItem: (k,v) => { if (failWrites) throw Error('quota'); storage.set(k,v) } }, console })
  return module.exports
}
const logic = load('contextSuggestions', { './visitFrecency': load('visitFrecency') })
const now = Date.now(), key = n => `plugin:test:tool:action-${n}`
const event = (n, session, originAppId = 'x11-class:terminal', age = 0) => ({ actionKey: key(n), session, originAppId, at: now - age })
const availableKeys = [1,2,3,4,5].map(key)
const select = events => logic.selectContextSuggestions({ events, originAppId: 'x11-class:terminal', availableKeys, now })
assert.equal(select([]).length, 0, 'cold start must not invent evidence')
const repeated = [event(1,'one',undefined,200), event(1,'one',undefined,100), event(1,'one'), event(2,'two')]
assert.ok(select(repeated).every(s => s.reason === 'recent'), 'one session is not an app habit')
const events = [event(1,'one',undefined,300), event(1,'two',undefined,200), event(1,'three',undefined,100), event(2,'four'), event(3,'five'), event(4,'six')]
assert.equal(select(events).length, 3)
assert.equal(select(events)[0].actionKey, key(1))
assert.equal(select(events)[0].reason, 'app')
const excluded = logic.selectContextSuggestions({ events, originAppId: null, availableKeys: [key(1),key(2)], excludedKeys: [key(1)], now })
assert.equal(excluded.length, 1)
assert.equal(excluded[0].reason, 'recent')
for (const k of ['plugin:browser:dynamic:https://private.example','host:app:/private/path','saved-action:secret','object-action:copy','plugin:x:tool:foo/bar']) assert.equal(logic.isSuggestionActionKey(k), false)
assert.equal(logic.retainEvents([event(1,'old',null,logic.RETENTION_MS+1), event(2,'future',null,-1)], now).length, 0)
assert.equal(logic.retainEvents(Array.from({length:1200},(_,i) => event(1,`s-${i}`)), now).length, 1000)
const store = load('contextSuggestionsStore', { './contextSuggestions': logic, react: { useSyncExternalStore() {} } })
const off = store.beginSuggestionSession('x11-class:terminal')
store.recordSuggestionSuccess(off,key(1))
assert.equal(storage.size,0,'disabled default never writes data')
store.suggestionStore.enable(true)
const session = store.beginSuggestionSession('x11-class:terminal')
store.recordSuggestionShown(session); store.recordSuggestionShown(session)
store.recordSuggestionSelected(session,key(1)); store.recordSuggestionSuccess(session,key(1))
assert.equal(store.suggestionStore.get().metrics.length,1)
assert.equal(store.suggestionStore.get().metrics[0].executed,true)
assert.equal(store.suggestionStore.get().events[0].originAppId,'x11-class:terminal')
store.beginSuggestionSession('mac-bundle:other')
store.recordSuggestionSuccess(session,key(2))
assert.equal(store.suggestionStore.get().events[1].session,session.id,'late success keeps original session')
store.suggestionStore.clear()
store.recordSuggestionSuccess(session,key(1))
assert.equal(store.suggestionStore.get().events.length,0,'clear fences in-flight callbacks')
const later = store.beginSuggestionSession('x11-class:terminal')
store.suggestionStore.enable(false)
store.recordSuggestionSuccess(later,key(1)); store.recordSuggestionShown(later)
assert.equal(store.suggestionStore.get().events.length,0)
assert.equal(store.suggestionStore.get().metrics.length,0)
store.suggestionStore.enable(true)
store.recordSuggestionSuccess(later,key(1))
assert.equal(store.suggestionStore.get().events.length,0,'reenabling never revives old callbacks')
// A sibling window may persist its change before this window receives storage events.
const siblingSession = store.beginSuggestionSession('x11-class:terminal')
const storageKey = 'hiven-context-suggestions-v1'
let sibling = JSON.parse(storage.get(storageKey))
storage.set(storageKey, JSON.stringify({ ...sibling, enabled: false, epoch: randomUUID() }))
store.recordSuggestionSuccess(siblingSession,key(1)); store.recordSuggestionShown(siblingSession)
assert.equal(JSON.parse(storage.get(storageKey)).events.length,0,'latest storage blocks success after sibling disable')
store.suggestionStore.enable(true)
const siblingClearSession = store.beginSuggestionSession('x11-class:terminal')
sibling = JSON.parse(storage.get(storageKey))
storage.set(storageKey, JSON.stringify({ ...sibling, epoch: randomUUID(), events: [], metrics: [] }))
store.recordSuggestionSuccess(siblingClearSession,key(1)); store.recordSuggestionShown(siblingClearSession)
assert.equal(JSON.parse(storage.get(storageKey)).events.length,0,'latest epoch blocks success after sibling clear')
assert.equal(JSON.parse(storage.get(storageKey)).metrics.length,0,'latest epoch blocks metrics after sibling clear')
store.suggestionStore.enable(true)
const failSession = store.beginSuggestionSession('x11-class:terminal')
failWrites = true
store.suggestionStore.enable(false)
store.recordSuggestionSuccess(failSession,key(1))
assert.equal(store.suggestionStore.get().enabled,false)
assert.equal(store.suggestionStore.get().events.length,0,'failed disable persistence still stops in-memory collection')
failWrites = false
store.suggestionStore.enable(true)
const clearSession = store.beginSuggestionSession('x11-class:terminal')
failWrites = true
store.suggestionStore.clear()
store.recordSuggestionSuccess(clearSession,key(1))
assert.equal(store.suggestionStore.get().events.length,0,'failed clear persistence still fences callbacks')
console.log('Context suggestions: selection, evidence, privacy, retention, metrics and epoch tests passed')
