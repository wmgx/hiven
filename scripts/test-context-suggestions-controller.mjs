import assert from 'node:assert/strict'
import { createServer } from 'vite'
const values = new Map()
const storage = { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) }
globalThis.window = { localStorage: storage, sessionStorage: storage, addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) }
globalThis.localStorage = storage; globalThis.sessionStorage = storage
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
try {
  const { LauncherController } = await server.ssrLoadModule('/src/workspace/launcher/controller.ts')
  const observed = []
  let session = 'first', resolve
  const controller = new LauncherController({
    surfaceId: 'global-launcher', api: {}, locale: 'en', makeT: () => k => k, getSettings: () => ({}),
    onChange() {}, requestClose() {}, recordSelection() {},
    captureSuccessfulSelection() { const captured = session; return item => observed.push([captured,item.systemKey]) },
  })
  const item = execute => ({ systemKey: 'host:action:fixture', kind: 'host', display: { title: 'Synthetic' },
    behavior: { type: 'perform' }, experienceRecord: false, execute })
  await controller.selectItem(item(async () => ({ ok: false, message: 'Synthetic failure' })))
  assert.equal(observed.length,0)
  let entered
  const started = new Promise(done => { entered = done })
  const pending = controller.selectItem(item(() => new Promise(done => { resolve = done; entered() })))
  await started
  session = 'second'; controller.reset(); resolve({ ok: true }); await pending
  assert.equal(observed.length,0,'cancelled old execution cannot enter a new session')
  await controller.selectItem(item(async () => ({ ok: true })))
  assert.deepEqual(observed,[['second','host:action:fixture']])
  session = 'surface-source'
  const recorder = controller.captureSuccessfulSelection()
  session = 'later'
  controller.recordSuccessfulSelection(item(async () => ({ok:true})), {}, recorder)
  assert.equal(observed.at(-1)[0],'surface-source','surface success uses capture before async preparation')
  const safe = new LauncherController({ surfaceId:'global-launcher', api:{},locale:'en',makeT:()=>k=>k,getSettings:()=>({}),
    onChange(){},requestClose(){},recordSelection(){},
    captureSuccessfulSelection: () => () => { throw Error('Optional storage failed') } })
  await safe.selectItem(item(async () => ({ok:true})))
  assert.equal(safe.getState().error,null,'optional collection never turns success into failure')
  console.log('Context suggestion controller attribution, failure, cancellation and observer isolation passed')
} finally { await server.close() }
