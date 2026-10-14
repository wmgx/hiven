import assert from 'node:assert/strict'
import { HudTranslationSession, type HudTranslationDependencies, type HudTranslationView } from '../src/plugins/translate/hud/session.ts'

function harness() {
  let now = 1000, input = 'Hello 世界', sensitive = false, prepared = true, serial = 0
  let pending: { resolve(value: string): void; reject(error: Error): void; signal: AbortSignal; onText(text: string): void } | null = null
  const views: HudTranslationView[] = [], fullTexts: Array<string | undefined> = [], dismissals: Array<[string, number]> = [], writes: string[] = []
  const timers = new Map<number, () => void>()
  const dependencies: HudTranslationDependencies = {
    async prepare() { return prepared ? { translate(_input, options) { return new Promise<string>((resolve, reject) => { pending = { resolve, reject, signal: options.signal, onText: options.onText } }) } } : null },
    async readClipboard(signal) { if (signal.aborted) throw Error('aborted'); return input },
    isSensitive() { return sensitive },
    async writeClipboard(text, signal) { if (signal.aborted) throw Error('aborted'); writes.push(text) },
    present(view, fullText) { views.push(structuredClone(view)); fullTexts.push(fullText) },
    async activate() { return now + 120_000 },
    dismiss(id, revision) { dismissals.push([id, revision]) },
    now: () => now,
    schedule(callback) { const id = ++serial; timers.set(id, callback); return id as unknown as ReturnType<typeof setTimeout> },
    clearSchedule(timer) { timers.delete(timer as unknown as number) },
    randomId: () => `session-${++serial}`,
  }
  return { dependencies, views, fullTexts, dismissals, writes, timers, get pending() { return pending }, set input(value: string) { input = value }, set sensitive(value: boolean) { sensitive = value }, set prepared(value: boolean) { prepared = value }, advance(ms: number) { now += ms } }
}

async function settle() { await Promise.resolve(); await Promise.resolve() }
async function settleUntil(predicate: () => boolean) {
  for (let index = 0; index < 20 && !predicate(); index += 1) await settle()
  assert.equal(predicate(), true, 'expected asynchronous state was not reached')
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject })
  return { promise, resolve, reject }
}

{
  const h = harness(), session = new HudTranslationSession(h.dependencies, { ttlMs: 100, previewCharacters: 4 })
  assert.equal(await session.trigger(), 'started')
  h.pending!.onText('一二三四五'); await settle()
  assert.deepEqual({ preview: h.views.at(-1)?.preview, truncated: h.views.at(-1)?.truncated }, { preview: '一二三四', truncated: true })
  h.pending!.resolve('完整翻译结果'); await settle()
  assert.equal(h.views.at(-1)?.phase, 'ready')
  assert.equal(await session.trigger(), 'activated')
  assert.equal(h.fullTexts.at(-1), '完整翻译结果', 'only the active completed view receives the full result')
  assert.equal(await session.copyAndClose(), true)
  assert.deepEqual(h.writes, ['完整翻译结果'], 'bounded preview never truncates the full copy')
}
{
  const h = harness()
  h.dependencies.activate = async () => h.dependencies.now() + 100
  const session = new HudTranslationSession(h.dependencies, { ttlMs: 10, activeTtlMs: 100 })
  await session.trigger(); h.pending!.resolve('long reading result'); await settleUntil(() => h.views.at(-1)?.phase === 'ready')
  const stalePassiveTimer = [...h.timers.values()][0]
  assert.equal(await session.trigger(), 'activated')
  h.advance(11); stalePassiveTimer(); await settle()
  assert.equal(h.views.at(-1)?.phase, 'active', 'the old passive deadline cannot retire an activated reading session')
  assert.equal(await session.trigger(), 'activated', 'repeated activation does not renew the reading deadline')
  h.advance(90)
  for (const callback of [...h.timers.values()]) callback()
  await settle()
  assert.ok(h.dismissals.length > 0, 'the fixed active reading deadline retires the session')
}
{
  const h = harness(), session = new HudTranslationSession(h.dependencies, { maxOutputCharacters: 4 })
  await session.trigger()
  assert.throws(() => h.pending!.onText('12345'))
  h.pending!.reject(Error('provider stopped after output limit')); await settle()
  assert.equal(h.views.at(-1)?.phase, 'error')
  assert.equal(h.views.some((view) => view.preview.includes('12345')), false, 'oversized streaming output never enters a HUD view')
  assert.equal(h.fullTexts.some(Boolean), false)
}
{
  const h = harness(), session = new HudTranslationSession(h.dependencies, { maxOutputCharacters: 4 })
  await session.trigger(); h.pending!.resolve('12345'); await settle()
  assert.equal(h.views.at(-1)?.phase, 'error')
  assert.equal(h.views.some((view) => view.preview.includes('12345')), false, 'oversized final output fails closed')
}
{
  const h = harness(), session = new HudTranslationSession(h.dependencies)
  let attempts = 0
  h.dependencies.writeClipboard = async (text, signal) => {
    if (signal.aborted) throw Error('aborted')
    attempts += 1
    if (attempts === 1) throw Error('synthetic copy failure')
    h.writes.push(text)
  }
  await session.trigger(); h.pending!.resolve('line 1\r\nline 2  '); await settle(); await session.trigger()
  assert.equal(await session.copyAndClose(), false)
  assert.equal(h.views.at(-1)?.copyFailed, true)
  assert.equal(await session.copyAndClose(), true)
  assert.deepEqual(h.writes, ['line 1\r\nline 2  '], 'retry keeps and copies the exact completed output')
}
{
  const h = harness(), session = new HudTranslationSession(h.dependencies)
  h.sensitive = true
  assert.equal(await session.trigger(), 'rejected')
  assert.equal(h.pending, null); assert.equal(h.views.length, 0)
}
{
  const h = harness(); h.prepared = false
  let reads = 0; h.dependencies.readClipboard = async () => { reads += 1; return 'private' }
  const session = new HudTranslationSession(h.dependencies)
  assert.equal(await session.trigger(), 'unavailable'); assert.equal(reads, 0)
  assert.equal(h.views.at(-1)?.phase, 'error')
  assert.equal(h.views.at(-1)?.failure, 'unavailable', 'readiness failure gives bounded feedback without reading content')
  h.prepared = true
  assert.equal(await session.trigger(), 'started', 'a later explicit retry replaces the unavailable state')
  assert.equal(reads, 1)
}
{
  const h = harness()
  let reads = 0
  h.dependencies.prepare = async () => { throw Error('synthetic readiness failure') }
  h.dependencies.readClipboard = async () => { reads += 1; return 'private' }
  const session = new HudTranslationSession(h.dependencies)
  assert.equal(await session.trigger(), 'unavailable')
  assert.equal(reads, 0)
  assert.equal(h.views.at(-1)?.failure, 'unavailable', 'readiness exceptions produce the same opaque feedback')
}
{
  const h = harness(); h.prepared = false
  const session = new HudTranslationSession(h.dependencies, { ttlMs: 10 })
  await session.trigger(); h.advance(11)
  for (const callback of [...h.timers.values()]) callback()
  await settle()
  assert.equal(h.dismissals.length, 1, 'unavailable feedback retains the bounded passive lifetime')
}
{
  const h = harness(), session = new HudTranslationSession(h.dependencies, { ttlMs: 10 })
  await session.trigger(); const old = h.pending!
  await session.cancel('cancelled'); assert.equal(old.signal.aborted, true)
  old.onText('late secret result'); old.resolve('late result'); await settle()
  assert.equal(h.views.some(view => view.preview.includes('late')), false)
}
{
  const h = harness(), session = new HudTranslationSession(h.dependencies, { ttlMs: 10 })
  await session.trigger(); h.pending!.resolve('done'); await settle(); h.advance(11)
  for (const callback of [...h.timers.values()]) callback(); await settle()
  assert.equal(await session.copyAndClose(), false); assert.ok(h.dismissals.length > 0)
}
{
  const h = harness(), session = new HudTranslationSession(h.dependencies)
  await session.trigger(); h.pending!.reject(Error('provider exposed raw secret')); await settle()
  assert.equal(h.views.at(-1)?.phase, 'error'); assert.equal(h.views.at(-1)?.preview, '')
}
{
  const h = harness(), session = new HudTranslationSession(h.dependencies)
  h.dependencies.isSensitive = () => { throw Error('classifier unavailable') }
  assert.equal(await session.trigger(), 'rejected')
  assert.equal(h.pending, null, 'classifier failures must fail closed before provider execution')
  assert.equal(h.dismissals.length, 1)
}
{
  const h = harness(), session = new HudTranslationSession(h.dependencies, { ttlMs: 10 })
  h.dependencies.readClipboard = async () => { throw Error('synthetic clipboard failure') }
  assert.equal(await session.trigger(), 'rejected')
  assert.equal(h.views.at(-1)?.phase, 'error')
  h.advance(11)
  for (const callback of [...h.timers.values()]) callback()
  await settle()
  assert.equal(h.dismissals.length, 1, 'read failures retain the same bounded lifetime')
}
{
  const h = harness(), session = new HudTranslationSession(h.dependencies, { ttlMs: 10 })
  const activation = deferred<number | null>()
  let activationStarted = false
  h.dependencies.activate = () => { activationStarted = true; return activation.promise }
  await session.trigger(); h.pending!.resolve('done'); await settleUntil(() => h.views.at(-1)?.phase === 'ready')
  const result = session.trigger()
  await settleUntil(() => activationStarted)
  h.advance(11); activation.resolve(1010)
  assert.equal(await result, 'unavailable')
  assert.equal(h.views.some(view => view.phase === 'active'), false)
  assert.equal(h.dismissals.length, 1)
}
{
  const h = harness(), session = new HudTranslationSession(h.dependencies)
  const copy = deferred<void>()
  h.dependencies.writeClipboard = async (text) => { h.writes.push(text); await copy.promise }
  await session.trigger(); h.pending!.resolve('copy once'); await settleUntil(() => h.views.at(-1)?.phase === 'ready'); await session.trigger()
  const first = session.copyAndClose()
  assert.equal(await session.copyAndClose(), false, 'a concurrent copy cannot duplicate the clipboard write')
  copy.resolve(); assert.equal(await first, true)
  assert.deepEqual(h.writes, ['copy once'])
}
{
  const h = harness(), session = new HudTranslationSession(h.dependencies, { ttlMs: 10 })
  await session.trigger(); h.advance(11); h.pending!.resolve('late result'); await settle()
  assert.equal(h.views.some(view => view.phase === 'ready'), false)
  assert.equal(h.dismissals.length, 1, 'provider completion after the deadline retires the session')
}
{
  const h = harness(), session = new HudTranslationSession(h.dependencies)
  const firstPresent = deferred<void>()
  const events: string[] = []
  h.dependencies.present = async (view) => {
    events.push(`present:${view.revision}:${view.phase}`)
    if (view.revision === 1) await firstPresent.promise
  }
  h.dependencies.dismiss = (id, revision) => { events.push(`dismiss:${id}:${revision}`) }
  const started = session.trigger(); await settleUntil(() => events.length === 1)
  const cancelled = session.cancel('cancelled'); await settle()
  firstPresent.resolve()
  assert.equal(await started, 'cancelled'); await cancelled
  assert.equal(h.pending, null, 'a cancelled session never sends clipboard text to the provider after presentation unblocks')
  assert.deepEqual(events, ['present:1:translating', 'present:2:cancelled'], 'queued delivery cannot revive an older view after cancellation')
}
{
  const h = harness(), session = new HudTranslationSession(h.dependencies)
  assert.equal(await session.trigger(), 'started')
  assert.equal(await session.trigger(), 'activated', 'the second explicit shortcut activates instead of cancelling an in-flight result')
  assert.equal(h.pending!.signal.aborted, false)
  h.pending!.resolve('completed while active'); await settleUntil(() => h.views.at(-1)?.preview === 'completed while active')
  assert.equal(h.views.at(-1)?.phase, 'active', 'provider completion cannot demote an explicitly active HUD')
}
{
  const h = harness(), session = new HudTranslationSession(h.dependencies, { ttlMs: 10, activeTtlMs: 100 })
  const activation = deferred<number | null>()
  h.dependencies.activate = () => activation.promise
  await session.trigger()
  h.pending!.onText('streamed before activation returns'); await settle()
  const activating = session.trigger(); await settle()
  h.pending!.resolve('completed before activation returns'); await settle()
  h.advance(5); activation.resolve(1105)
  assert.equal(await activating, 'activated')
  assert.equal(h.views.at(-1)?.phase, 'active')
  assert.equal(h.views.at(-1)?.preview, 'completed before activation returns')
  assert.equal(h.views.at(-1)?.expiresAt, 1105, 'provider completion cannot restore the passive deadline')
  h.advance(6)
  for (const callback of [...h.timers.values()]) callback()
  await settle()
  assert.equal(h.views.at(-1)?.phase, 'active', 'a stale passive timer cannot clear the newly active session')
}
{
  const h = harness(), session = new HudTranslationSession(h.dependencies)
  const readiness = deferred<ReturnType<HudTranslationDependencies['prepare']> extends Promise<infer T> ? T : never>()
  let reads = 0
  h.dependencies.prepare = () => readiness.promise
  h.dependencies.readClipboard = async () => { reads += 1; return 'must not be read twice' }
  const first = session.trigger(); await settle()
  assert.equal(await session.trigger(), 'unavailable', 'a second press during metadata preflight cannot queue another clipboard read')
  readiness.resolve(null)
  assert.equal(await first, 'unavailable'); assert.equal(reads, 0)
}
{
  const h = harness(), session = new HudTranslationSession(h.dependencies)
  h.dependencies.present = async () => { throw Error('native HUD unavailable') }
  assert.equal(await session.trigger(), 'unavailable')
  assert.equal(h.pending, null, 'clipboard content is not sent when the native HUD cannot accept the initial bounded preview')
}
{
  const h = harness(), session = new HudTranslationSession(h.dependencies)
  await session.trigger(); h.pending!.resolve('old result'); await settleUntil(() => h.views.at(-1)?.phase === 'ready')
  await session.trigger()
  const old = h.views.at(-1)!
  await session.cancel()
  await session.trigger(); h.pending!.resolve('new result'); await settleUntil(() => h.views.at(-1)?.preview === 'new result')
  await session.trigger()
  assert.equal(await session.copyAndClose({ sessionId: old.sessionId, revision: old.revision }), false)
  assert.equal(await session.cancelExpected({ sessionId: old.sessionId, revision: old.revision }), false)
  const current = h.views.at(-1)!
  assert.equal(await session.copyAndClose({ sessionId: current.sessionId, revision: current.revision }), true)
  assert.deepEqual(h.writes, ['new result'], 'a delayed native action cannot affect the replacement session')
}
{
  const h = harness(), session = new HudTranslationSession(h.dependencies)
  await session.trigger(); const run = h.pending!; await session.trigger()
  const close = h.views.at(-1)!
  run.onText('newer streaming revision'); await settle()
  assert.equal(await session.cancelExpected({ sessionId: close.sessionId, revision: close.revision }), true)
  assert.equal(run.signal.aborted, true, 'close remains valid after a newer delta in the same active session')
}
{
  const h = harness(), session = new HudTranslationSession(h.dependencies)
  const firstPresent = deferred<void>()
  const events: string[] = []
  h.dependencies.present = async (view) => {
    events.push(`${view.sessionId}:${view.revision}:${view.phase}`)
    if (events.length === 1) await firstPresent.promise
  }
  const first = session.trigger(); await settleUntil(() => events.length === 1)
  const cancelled = session.cancel('cancelled')
  const second = session.trigger()
  await settle()
  assert.equal(events.length, 1, 'a replacement session cannot overtake native delivery from the old session')
  firstPresent.resolve()
  assert.equal(await first, 'cancelled'); await cancelled
  assert.equal(await second, 'started')
  assert.deepEqual(events.map((event) => event.split(':').slice(1).join(':')), [
    '1:translating', '2:cancelled', '1:translating',
  ], 'all native updates stay globally ordered across session ids')
}
{
  const firstHarness = harness(), secondHarness = harness()
  const blocked = deferred<void>()
  const events: string[] = []
  firstHarness.dependencies.present = async (view) => {
    events.push(`old:${view.phase}`)
    if (events.length === 1) await blocked.promise
  }
  secondHarness.dependencies.present = (view) => { events.push(`new:${view.phase}`) }
  const oldController = new HudTranslationSession(firstHarness.dependencies)
  const newController = new HudTranslationSession(secondHarness.dependencies)
  const oldStart = oldController.trigger(); await settleUntil(() => events.length === 1)
  const oldCancel = oldController.cancel('cancelled')
  const newStart = newController.trigger(); await settle()
  assert.deepEqual(events, ['old:translating'])
  blocked.resolve(); assert.equal(await oldStart, 'cancelled'); await oldCancel
  assert.equal(await newStart, 'started')
  assert.deepEqual(events, ['old:translating', 'old:cancelled', 'new:translating'],
    'native delivery remains ordered across replacement controller instances')
}
console.log('hud translation session passed: readiness-before-read, fail-closed sensitivity, exact copy, serialized delivery, cancellation, races, expiry and opaque errors')
