#!/usr/bin/env node
// Executes the real AI runtime, app settings, permission store and registry. No model requests.
import assert from 'node:assert/strict'
import * as zustand from 'zustand'
import * as middleware from 'zustand/middleware'
import { load, permissionHarness, registryHarness } from './ai-runtime-test-harness.mjs'

function deferred() {
  let resolve, reject
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}
const flush = () => new Promise((resolve) => setImmediate(resolve))
const plain = (value) => JSON.parse(JSON.stringify(value))
const descriptor = (overrides = {}) => ({
  id: 'selected', kind: 'test', name: 'Selected provider', status: 'ready', modelCatalog: 'complete',
  capabilities: ['text.generate', 'image.understand'],
  agents: [{ id: 'model', name: 'Selected model', capabilities: ['text.generate'], inputModalities: ['text'], supportedEfforts: ['low', 'medium'], defaultEffort: 'low', isDefault: true }],
  ...overrides,
})

function appStoreHarness(storage) {
  const previous = globalThis.localStorage
  const previousWindow = globalThis.window
  let store
  try {
    globalThis.localStorage = storage
    globalThis.window = { localStorage: storage }
    store = load('src/store.ts', {
      zustand, 'zustand/middleware': middleware,
      './workspace/ai/jev': load('src/workspace/ai/jev.ts', { '@tauri-apps/api/core': {} }),
      './utils/persistMigration': load('src/utils/persistMigration.ts', {}),
      './workspace/launcher/persistableRecents': load('src/workspace/launcher/persistableRecents.ts', {
        '../../i18n': {}, '../effectRunner': {},
      }),
      './workspace/launcher/usage': load('src/workspace/launcher/usage.ts', {
        './types': load('src/workspace/launcher/types.ts', {}),
      }),
      './workspace/launcher/favorites': load('src/workspace/launcher/favorites.ts', {}),
      './workspace/appHotkeys': load('src/workspace/appHotkeys.ts', {}),
      './workspace/appLauncher/appSearchAliases': load('src/workspace/appLauncher/appSearchAliases.ts', {}),
    }, { localStorage: storage }).useAppStore
  } finally {
    if (previous === undefined) delete globalThis.localStorage
    else globalThis.localStorage = previous
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
  const subscriptions = new Set()
  const subscribe = store.subscribe
  store.subscribe = (listener) => {
    subscriptions.add(listener)
    const unsubscribe = subscribe(listener)
    return () => { subscriptions.delete(listener); unsubscribe() }
  }
  return { store, subscriptions }
}

function harness({ source = 'installed' } = {}) {
  const p = permissionHarness()
  const app = appStoreHarness(p.storage)
  const registry = registryHarness()
  app.store.getState().updateSetting('aiDefaultProviderId', 'selected')
  app.store.getState().updateSetting('aiDefaultAgentId', 'model')
  assert.equal(JSON.parse(p.storage.getItem('hiven-settings')).state.settings.aiDefaultAgentId, 'model')
  const calls = []
  let time = 100_000
  const timers = new Map()
  const runtime = load('src/workspace/ai/runtime.ts', {
    '@tauri-apps/api/core': { invoke(...args) { calls.push(['native', ...args]); throw new Error('Unexpected native call') } },
    '../../store': { useAppStore: app.store }, '../pluginPermissions': p.permissions,
    '../pluginRegistry': registry, '../telemetry': { measureLatency: (_label, work) => work() },
    './codexProvider': { codexChatGptProvider: { id: 'codex-unused', async describe() { calls.push(['other-describe']); return descriptor({ id: 'codex-unused' }) } } },
    './xaiProvider': { xaiGrokProvider: { id: 'xai-unused', async describe() { calls.push(['other-describe']); return descriptor({ id: 'xai-unused' }) } } },
  }, {
    localStorage: p.storage,
    Date: class extends Date { static now() { return time } },
    setTimeout(callback, ms) { const id = Symbol(); timers.set(id, { callback, ms }); return id },
    clearTimeout(id) { timers.delete(id) },
  })
  const h = {
    ...p, app, registry, runtime, calls,
    advance: (ms) => { time += ms },
    timeout: () => { for (const [id, timer] of timers) if (timer.ms === 10_000) { timers.delete(id); timer.callback() } },
    api: (declared = ['ai.use']) => runtime.createPluginAi('owner', source, p.snapshot(source, 'owner', declared)),
    grant: () => p.grant(source, 'owner'), revoke: () => p.revoke(source, 'owner'),
    setting: (name, value) => app.store.getState().updateSetting(name, value),
    register(overrides = {}) {
      return runtime.registerAiProvider({
        id: 'selected', async describe(...args) { calls.push(['describe', ...args]); return descriptor() },
        async *stream(request) { calls.push(['send', request]); yield { type: 'completed', runId: request.runId, status: 'completed' } },
        async cancel() {}, ...overrides,
      })
    },
    clean() {
      assert.equal(p.subscriptions.size, 0, 'permission listener leaked')
      assert.equal(registry.subscriptions.size, 0, 'registry listener leaked')
      assert.equal(app.subscriptions.size, 0, 'app settings listener leaked')
    },
  }
  return h
}
const request = { capabilities: ['text.generate'], inputModalities: ['text'] }
let passed = 0
async function check(name, work) {
  try { await work(); passed++ } catch (error) { error.message = `${name}: ${error.message}`; throw error }
}

await check('metadata-only configuration check resolves actual defaults and reports no invented quota', async () => {
  const h = harness(); h.grant(); h.register()
  const result = await h.api().preflight({ ...request, input: [{ type: 'text', text: 'PRIVATE BODY' }], prompt: 'PRIVATE PROMPT', blobId: 'PRIVATE BLOB' })
  assert.deepEqual(plain(result), {
    status: 'ready', reason: 'configuration_ready', checkedAt: 100_000,
    providerId: 'selected', providerName: 'Selected provider', agentId: 'model', agentName: 'Selected model', effort: 'medium', selectionKey: result.selectionKey,
  })
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0][0], 'describe')
  assert.equal(h.calls[0].length, 2); assert.equal(typeof h.calls[0][1], 'function')
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|quota|limit|contextWindow/)
  assert.equal(h.storage.getItem('hiven-ai-usage'), null)
  h.clean()
})

await check('TTL is a real short circuit, refresh bypasses cache, and same-provider concurrent checks coalesce', async () => {
  const h = harness(); h.grant(); const pending = deferred(); let describes = 0
  h.register({ describe() { describes++; return pending.promise } })
  const api = h.api()
  const first = api.preflight(request)
  const second = api.preflight({ ...request, forceRefresh: true, agentId: 'missing' })
  assert.equal(describes, 1)
  pending.resolve(descriptor())
  assert.equal((await first).status, 'ready'); assert.equal((await second).reason, 'agent_unknown')
  h.advance(59_999)
  assert.equal((await api.preflight(request)).checkedAt, 100_000); assert.equal(describes, 1)
  h.advance(1)
  assert.equal((await api.preflight(request)).checkedAt, 160_000); assert.equal(describes, 2)
  await api.preflight({ ...request, forceRefresh: true }); assert.equal(describes, 3)
  h.clean()
})

for (const source of ['builtin', 'installed', 'dev']) {
  await check(`${source}: denied and cached calls enforce current permission and the captured ceiling`, async () => {
    const h = harness({ source }); h.register(); const denied = h.api([]); h.grant()
    await assert.rejects(denied.preflight(request), /Plugin permission required: ai.use/)
    assert.equal(h.calls.length, 0)
    const api = h.api(); await api.preflight(request); h.revoke()
    await assert.rejects(api.preflight(request), /Plugin permission required: ai.use/)
    assert.equal(h.calls.length, 1); h.clean()
  })
}

await check('revocation latches across regrant while shared describe completes for another authorized caller', async () => {
  const h = harness(); h.grant(); const pending = deferred(); let describes = 0
  h.register({ describe() { describes++; return pending.promise } })
  const old = assert.rejects(h.api().preflight(request), /Plugin permission required: ai.use/)
  h.revoke(); h.grant(); await old; await flush(); h.clean()
  const fresh = h.api().preflight(request)
  pending.resolve(descriptor())
  assert.equal((await fresh).status, 'ready'); assert.equal(describes, 1); h.clean()
})

await check('cached await also latches a transient revocation', async () => {
  const h = harness(); h.grant(); h.register(); const api = h.api(); await api.preflight(request)
  const pending = assert.rejects(api.preflight(request), /Plugin permission required: ai.use/)
  h.revoke(); h.grant(); await pending; await flush(); h.clean()
  assert.equal(h.calls.length, 1)
})

await check('configured unavailable provider never silently switches to another ready provider', async () => {
  const h = harness(); h.grant(); h.register({ async describe() { return descriptor({ status: 'login_required' }) } })
  const result = await h.api().preflight(request)
  assert.equal(result.reason, 'provider_login_required'); assert.equal(result.status, 'blocked')
  assert.equal(result.providerId, 'selected'); assert.equal(h.calls.length, 0)
  h.setting('aiDefaultProviderId', 'not-registered')
  assert.equal((await h.api().preflight(request)).reason, 'provider_not_registered')
  h.setting('aiDefaultProviderId', undefined)
  assert.equal((await h.api().preflight(request)).reason, 'provider_not_configured')
  assert.equal(h.calls.length, 0); h.clean()
})

await check('default selection changes, including change and restore during await, invalidate a check', async () => {
  const h = harness(); h.grant(); const pending = deferred()
  h.register({ describe: () => pending.promise })
  const old = h.api().preflight(request)
  h.setting('aiDefaultAgentId', 'new'); h.setting('aiDefaultAgentId', 'model')
  pending.resolve(descriptor())
  assert.equal((await old).reason, 'configuration_changed')
  const before = await h.api().preflight(request)
  h.setting('aiDefaultAgentId', 'new')
  const after = await h.api().preflight(request)
  assert.equal(after.reason, 'agent_unknown'); assert.equal(after.agentId, 'new')
  assert.notEqual(before.selectionKey, after.selectionKey)
  h.clean()
})

await check('an explicitly bound provider/model/effort survives unrelated default selection changes', async () => {
  const h = harness(); h.grant(); const pending = deferred(); h.register({ describe: () => pending.promise })
  const result = h.api().preflight({ ...request, providerId: 'selected', agentId: 'model', effort: 'low' })
  h.setting('aiDefaultProviderId', 'other'); h.setting('aiDefaultAgentId', 'other'); h.setting('aiDefaultEffort', 'high')
  pending.resolve(descriptor())
  assert.equal((await result).status, 'ready'); assert.equal((await result).effort, 'low'); h.clean()
})

for (const [modelCatalog, agents, reason] of [
  ['complete', [], 'agent_unknown'], ['partial', [], 'model_catalog_incomplete'],
  ['unknown', undefined, 'model_catalog_unknown'], [undefined, undefined, 'model_catalog_unknown'],
  ['fallback', undefined, 'model_catalog_fallback'],
]) {
  await check(`${String(modelCatalog)} catalogue evidence never invents a missing model conclusion`, async () => {
    const h = harness(); h.grant(); h.register({ async describe() { return descriptor({ modelCatalog, ...(agents ? { agents } : {}) }) } })
    const result = await h.api().preflight(request)
    assert.equal(result.status, 'unknown'); assert.equal(result.reason, reason)
    assert.equal(result.agentId, 'model'); h.clean()
  })
}

await check('a model present in a partial live catalogue is evidence for its configuration only', async () => {
  const h = harness(); h.grant(); h.register({ async describe() { return descriptor({ modelCatalog: 'partial', quota: { buckets: [{ id: 'test', primary: { usedPercent: 100 } }] } }) } })
  const result = await h.api().preflight(request)
  assert.equal(result.reason, 'configuration_ready')
  assert.equal(result.quota, undefined); h.clean()
})

for (const [overrides, reason] of [
  [{ capabilities: ['image.understand'] }, 'capability_unavailable'],
  [{ inputModalities: ['image'] }, 'input_unavailable'],
]) {
  await check(`known model ${reason} is blocked`, async () => {
    const h = harness(); h.grant(); h.register()
    const result = await h.api().preflight({ ...request, ...overrides })
    assert.equal(result.status, 'blocked'); assert.equal(result.reason, reason); h.clean()
  })
}

await check('string startup failures retain diagnostics without asserting missing CLI', async () => {
  const h = harness(); h.grant()
  const diagnostic = 'Codex executable was not found (codex: Permission denied (os error 13))'
  h.register({ async describe() { throw diagnostic } })
  const result = await h.api().preflight(request)
  assert.equal(result.status, 'unknown'); assert.equal(result.reason, 'metadata_unavailable'); assert.equal(result.message, diagnostic)
  const provider = (await h.api().providers()).find((item) => item.id === 'selected')
  assert.equal(provider.statusMessage, diagnostic); h.clean()
})

await check('desktop-required evidence is distinct from generic metadata failure', async () => {
  const h = harness(); h.grant(); h.register({ async describe() { throw new Error('Codex App Server requires the desktop app') } })
  const result = await h.api().preflight(request)
  assert.equal(result.status, 'blocked'); assert.equal(result.reason, 'desktop_required'); h.clean()
})

await check('metadata timeout is unknown, late work cannot overwrite the final cached result', async () => {
  const h = harness(); h.grant(); const gate = deferred(); h.register({ describe: () => gate.promise })
  const api = h.api(); const pending = api.preflight(request); h.timeout()
  assert.equal((await pending).reason, 'metadata_timeout'); h.clean()
  gate.resolve(descriptor()); await flush()
  assert.equal((await api.preflight(request)).reason, 'metadata_timeout'); h.clean()
})

await check('quota timeout does not discard already returned account and model metadata', async () => {
  const h = harness(); h.grant(); const gate = deferred()
  h.register({ describe(publish) { publish(descriptor()); return gate.promise } })
  const pending = h.api().preflight(request); h.timeout()
  assert.equal((await pending).reason, 'configuration_ready'); h.clean()
  gate.resolve(descriptor()); await flush()
})

await check('replacement while awaiting invalidates old results and cannot pollute a new provider cache', async () => {
  const h = harness(); h.grant(); const gate = deferred()
  const unregisterOld = h.register({ describe: () => gate.promise })
  const api = h.api(); const old = api.preflight(request)
  h.register({ async describe() { return descriptor({ status: 'login_required' }) } })
  unregisterOld()
  assert.equal((await api.preflight(request)).reason, 'provider_login_required')
  gate.resolve(descriptor()); assert.equal((await old).reason, 'configuration_changed')
  assert.equal((await api.preflight(request)).reason, 'provider_login_required'); h.clean()
})

await check('logout invalidates cached and pending metadata before and after the account action', async () => {
  const h = harness(); h.grant(); const oldMetadata = deferred(); const logout = deferred()
  let calls = 0; let ready = true
  h.register({
    describe() {
      calls++
      return calls === 2 ? oldMetadata.promise : Promise.resolve(descriptor({ status: ready ? 'ready' : 'login_required' }))
    },
    async logout() { await logout.promise; ready = false },
  })
  const api = h.api(); const before = await api.preflight(request)
  const old = api.preflight({ ...request, forceRefresh: true })
  const signingOut = h.runtime.logoutAiProvider('selected')
  logout.resolve(); await signingOut
  const after = await api.preflight(request)
  assert.equal(after.reason, 'provider_login_required'); assert.notEqual(before.selectionKey, after.selectionKey)
  oldMetadata.resolve(descriptor())
  assert.equal((await old).reason, 'configuration_changed')
  assert.equal((await api.preflight(request)).reason, 'provider_login_required')
  assert.equal(calls, 3); h.clean()
})

await check('default model omission resolves a visible provider default, not a made-up model', async () => {
  const h = harness(); h.grant(); h.setting('aiDefaultAgentId', undefined); h.register()
  const result = await h.api().preflight(request)
  assert.equal(result.agentId, 'model'); assert.equal(result.status, 'ready')
  h.register({ async describe() { return descriptor({ agents: [] }) } })
  const missing = await h.api().preflight(request)
  assert.equal(missing.agentId, undefined); assert.equal(missing.reason, 'agent_unknown'); h.clean()
})

await check('subscriptions observe only defaults, permissions and explicit provider/account actions', async () => {
  const h = harness(); h.grant(); h.register({ async login() { return {} }, async logout() {} })
  const api = h.api(); let changed = 0
  const unsubscribe = api.subscribePreflight(() => changed++)
  h.setting('fontSize', 18); h.setting('theme', 'dark'); await api.preflight(request); await api.providers()
  assert.equal(changed, 0)
  for (const [key, value] of [['aiDefaultProviderId', 'other'], ['aiDefaultAgentId', 'other'], ['aiDefaultEffort', 'high']]) h.setting(key, value)
  assert.equal(changed, 3)
  h.revoke(); h.grant(); assert.equal(changed, 5)
  await h.runtime.loginAiProvider('selected'); assert.equal(changed, 7)
  await h.runtime.logoutAiProvider('selected'); assert.equal(changed, 9)
  const unregister = h.register(); assert.equal(changed, 10); unregister(); assert.equal(changed, 11)
  unsubscribe(); h.clean()
})

await check('actual stream rechecks metadata after a ready preflight and keeps legacy default fallback', async () => {
  const h = harness(); h.grant(); let describes = 0; let ready = true
  h.register({ async describe() { describes++; return descriptor({ status: ready ? 'ready' : 'login_required' }) } })
  const api = h.api(); const selection = await api.preflight(request); assert.equal(selection.status, 'ready')
  ready = false
  const events = []
  for await (const event of api.stream({ providerId: selection.providerId, agentId: selection.agentId, effort: selection.effort, input: [{ type: 'text', text: 'explicit run' }] })) events.push(event)
  assert.equal(describes, 2); assert.equal(events[0].code, 'provider_login_required')
  assert.equal(h.calls.filter(([name]) => name === 'send').length, 0)
  const listed = await api.providers()
  assert.notEqual(listed.find((item) => item.isDefault)?.id, 'selected', 'legacy ready-other fallback must remain')
  h.clean()
})

await check('actual Codex metadata calls flag pagination and send no turn or prompt', async () => {
  const calls = []
  const { codexChatGptProvider } = load('src/workspace/ai/codexProvider.ts', {
    '@tauri-apps/api/core': { async invoke(command, args) {
      calls.push([command, args])
      const value = args.method === 'account/read' ? { account: { type: 'chatgpt' } }
        : args.method === 'model/list' ? { data: [{ id: 'model', inputModalities: ['text'] }], nextCursor: 'page-2' } : {}
      return { ...value, _hivenConnectionId: 'connection' }
    } },
    '@tauri-apps/api/event': { async listen() { return () => {} } },
  }, { window: { __TAURI_INTERNALS__: {} } })
  assert.equal((await codexChatGptProvider.describe()).modelCatalog, 'partial')
  assert.deepEqual(calls.map(([, args]) => args.method), ['initialize', 'initialized', 'account/read', 'model/list', 'account/rateLimits/read'])
  assert.doesNotMatch(JSON.stringify(calls), /thread\/start|turn\/start|prompt|blobId/)
})

await check('actual xAI metadata distinguishes fallback models from returned live models', async () => {
  const calls = []; let models = []
  const { xaiGrokProvider } = load('src/workspace/ai/xaiProvider.ts', {
    '@tauri-apps/api/core': { Channel: class {}, async invoke(command, ...args) {
      calls.push([command, ...args]); return { status: 'ready', models }
    } },
  })
  assert.equal((await xaiGrokProvider.describe()).modelCatalog, 'fallback')
  models = [{ id: 'live-model' }]
  assert.equal((await xaiGrokProvider.describe()).modelCatalog, 'partial')
  assert.deepEqual(calls, [['ai_xai_describe'], ['ai_xai_describe']])
})

console.log(`AI metadata preflight behavior passed: ${passed} real runtime/store/provider cases`)
