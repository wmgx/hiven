#!/usr/bin/env node
import assert from 'node:assert/strict'
import { load } from './ai-runtime-test-harness.mjs'

const { AiTranslationReadiness, keepSelectedOption } = load('src/plugins/translate/ai/readiness.ts', {})
const { translateWithAi, AiTranslationError } = load('src/plugins/translate/providers/adapters.ts', { './tencent': {} })
const settle = () => new Promise((resolve) => setImmediate(resolve))
const explicit = { aiProviderId: 'provider-a', aiAgentId: 'model-a', aiEffort: 'medium' }
const inherited = { aiProviderId: '', aiAgentId: '', aiEffort: 'inherit' }
const ready = (patch = {}) => ({ status: 'ready', reason: 'configuration_ready', providerId: 'provider-a', agentId: 'model-a', effort: 'medium', selectionKey: 'config-a', checkedAt: 100, ...patch })
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done }); return { promise, resolve } }
function host(result = ready()) {
  const listeners = new Set()
  const calls = { preflight: [], providers: 0, stream: [] }
  const ai = {
    providers: async () => { calls.providers += 1; return [{ id: 'provider-a', status: 'login_required', agents: [] }, { id: 'provider-b', status: 'unavailable', agents: [] }] },
    preflight: async (request) => { calls.preflight.push(request); return typeof result === 'function' ? result(request) : result },
    subscribePreflight(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    async *stream(request) { calls.stream.push(request); yield { type: 'text.delta', delta: 'hello' }; yield { type: 'completed', status: 'completed' } },
  }
  return { ai, calls, listeners, change: () => { for (const listener of [...listeners]) listener() } }
}

// Metadata only, with no per-keystroke/delta work and exact concrete execution binding.
{
  const h = host()
  const controller = new AiTranslationReadiness()
  controller.setAi(h.ai)
  controller.setSelection(inherited)
  assert.equal(h.calls.preflight.length, 0, 'setAi/setSelection only invalidate and bind')
  assert.equal(h.calls.providers, 0)
  await controller.refresh()
  assert.equal(h.calls.preflight.length, 1)
  assert.deepEqual(Object.keys(h.calls.preflight[0]).sort(), ['agentId', 'capabilities', 'effort', 'forceRefresh', 'inputModalities', 'providerId'])
  assert.equal(h.calls.preflight[0].input, undefined, 'preflight never receives translation text')
  for (let index = 0; index < 100; index += 1) {
    controller.setAi(h.ai)
    controller.setSelection({ ...inherited })
    assert.equal(controller.execution(h.ai, inherited).providerId, 'provider-a')
    controller.getSnapshot()
  }
  assert.equal(h.calls.preflight.length, 1)
  assert.equal(h.calls.providers, 0, 'surface has no provider-list reads')
  const translated = await translateWithAi({ text: '你好', sourceLang: 'zh', targetLang: 'en' }, inherited, h.ai, { aiSelection: controller.execution(h.ai, inherited) })
  assert.equal(translated.text, 'hello')
  assert.equal(h.calls.stream[0].providerId, 'provider-a')
  assert.equal(h.calls.stream[0].agentId, 'model-a')
  assert.equal(h.calls.preflight.length, 1, 'streaming makes no metadata call')
  const previousRevision = controller.getSnapshot().revision
  h.change()
  assert.ok(controller.getSnapshot().revision > previousRevision)
  assert.equal(controller.execution(h.ai, inherited), undefined, 'configuration events synchronously revoke execution')
  await settle()
  assert.equal(h.calls.preflight.length, 2)
  await controller.refresh(true)
  assert.equal(h.calls.preflight.at(-1).forceRefresh, true)
  controller.dispose()
  assert.equal(h.listeners.size, 0)
}

// Unknown metadata preserves compatible bound runs; unresolved inheritance still cannot execute.
for (const reason of ['metadata_unavailable', 'metadata_timeout', 'model_catalog_unknown', 'model_catalog_incomplete', 'model_catalog_fallback']) {
  const h = host(ready({ status: 'unknown', reason }))
  const c = new AiTranslationReadiness()
  c.setAi(h.ai); c.setSelection(explicit); await c.refresh()
  assert.equal(c.execution(h.ai, explicit).agentId, 'model-a')
  c.dispose()
}
for (const reason of ['provider_login_required', 'provider_not_registered', 'cli_missing', 'desktop_required', 'capability_unavailable', 'input_unavailable']) {
  const h = host(ready({ status: 'blocked', reason }))
  const c = new AiTranslationReadiness()
  c.setAi(h.ai); c.setSelection(explicit); await c.refresh()
  assert.equal(c.execution(h.ai, explicit), undefined)
  assert.equal(c.execution(h.ai, explicit), undefined)
  c.dispose()
}
{
  const h = host(); delete h.ai.preflight
  const c = new AiTranslationReadiness()
  c.setAi(h.ai); c.setSelection(inherited); await c.refresh()
  assert.equal(c.getSnapshot().reason, 'legacy_host')
  assert.equal(c.execution(h.ai, inherited), undefined)
  c.setSelection(explicit); await c.refresh()
  assert.equal(c.execution(h.ai, explicit).providerId, 'provider-a')
  assert.equal(c.execution(h.ai, explicit).agentId, 'model-a')
  await assert.rejects(translateWithAi({ text: 'hi', sourceLang: 'en', targetLang: 'zh' }, inherited, h.ai), (error) => error instanceof AiTranslationError && error.code === 'selection')
  await translateWithAi({ text: 'hi', sourceLang: 'en', targetLang: 'zh' }, explicit, h.ai)
  assert.equal(h.calls.stream.length, 1)
  c.dispose()
}

// A failed check is unknown (never ready), whereas a known permission denial blocks.
for (const [message, status, reason] of [
  ['native spawn failed: access denied', 'unknown', 'metadata_unavailable'],
  ['Plugin permission required: ai.use', 'blocked', 'permission_denied'],
]) {
  const h = host(() => { throw new Error(message) })
  const c = new AiTranslationReadiness()
  c.setAi(h.ai); c.setSelection(explicit); await c.refresh()
  assert.equal(c.getSnapshot().status, status)
  assert.equal(c.getSnapshot().reason, reason)
  c.dispose()
}

// Settings retain disconnected providers and unavailable saved selections, without displaying a fallback.
{
  const h = host()
  const c = new AiTranslationReadiness(true)
  c.setAi(h.ai); c.setSelection(explicit); await c.refresh()
  assert.equal(c.getSnapshot().providers.length, 2)
  assert.equal(c.getSnapshot().providers[0].status, 'login_required')
  assert.equal(c.getSnapshot().providers[1].status, 'unavailable')
  const options = [{ value: '', label: 'inherit' }, { value: 'available', label: 'Available' }]
  const saved = keepSelectedOption(options, 'removed', 'Removed (saved)')
  assert.equal(saved.at(-1).value, 'removed')
  assert.equal(keepSelectedOption(saved, 'removed', 'again').length, 3)
  c.dispose()
}

// A late result, old subscription, or old selection cannot resurrect the old execution target.
{
  const pending = deferred()
  const a = host(() => pending.promise)
  const b = host(ready({ providerId: 'provider-b', agentId: 'model-b' }))
  const c = new AiTranslationReadiness()
  c.setAi(a.ai); c.setSelection(explicit)
  const oldCallback = [...a.listeners][0]
  const oldRefresh = c.refresh()
  c.setAi(b.ai)
  assert.equal(a.listeners.size, 0)
  assert.equal(b.listeners.size, 1)
  assert.equal(b.calls.preflight.length, 0, 'rebind must not describe')
  const newSelection = { aiProviderId: 'provider-b', aiAgentId: 'model-b' }
  c.setSelection(newSelection)
  await c.refresh()
  oldCallback()
  assert.equal(b.calls.preflight.length, 1, 'a detached old callback cannot refresh the new host')
  pending.resolve(ready())
  await oldRefresh
  assert.equal(c.getSnapshot().result.providerId, 'provider-b')
  assert.equal(c.execution(b.ai, explicit), undefined)
  assert.equal(c.execution(a.ai, newSelection), undefined)
  assert.equal(c.execution(b.ai, newSelection).agentId, 'model-b')
  c.dispose()
}
{
  const pending = deferred()
  let calls = 0
  const h = host(() => ++calls === 1 ? pending.promise : ready({ agentId: 'model-b' }))
  const c = new AiTranslationReadiness()
  c.setAi(h.ai); c.setSelection(explicit)
  const old = c.refresh()
  const selection = { ...explicit, aiAgentId: 'model-b' }
  c.setSelection(selection)
  await c.refresh()
  pending.resolve(ready()); await old
  assert.equal(c.getSnapshot().result.agentId, 'model-b')
  c.dispose()
}
{
  const h = host(ready({ providerId: 'surprise-provider' }))
  const c = new AiTranslationReadiness()
  c.setAi(h.ai); c.setSelection(explicit); await c.refresh()
  assert.equal(c.getSnapshot().reason, 'configuration_changed')
  assert.equal(c.execution(h.ai, explicit), undefined, 'never silently bind a replacement provider')
  c.dispose()
}
console.log('translate AI readiness lifecycle and execution checks passed')
