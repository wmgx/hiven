#!/usr/bin/env node
// Execute the real runtime, Ollama adapter, permissions and i18n with fake I/O. No live model requests.
import assert from 'node:assert/strict'
import { load, permissionHarness, registryHarness } from './ai-runtime-test-harness.mjs'

const flush = () => new Promise((resolve) => setImmediate(resolve))
const plain = (value) => JSON.parse(JSON.stringify(value))
async function collect(iterable) {
  const events = []
  for await (const event of iterable) events.push(event)
  return events
}
const catalog = (overrides = {}) => ({ models: [{ id: 'local-model', digest: 'digest' }], statusReason: null, complete: true, ...overrides })
const agent = (id, capabilities = ['text.generate']) => ({ id, name: id, capabilities, inputModalities: ['text'], supportedEfforts: [], isDefault: true })
function harness({ description = catalog(), defaultProvider = 'ollama-local', defaultAgent = 'local-model', locale = 'en' } = {}) {
  const p = permissionHarness()
  const registry = registryHarness()
  const settings = { aiDefaultProviderId: defaultProvider, aiDefaultAgentId: defaultAgent, aiDefaultEffort: 'high' }
  const store = { getState: () => ({ settings, locale }), subscribe: () => () => {} }
  const i18n = load('src/i18n/registry.ts', {})
  const messages = load('src/i18n/locales/settings.ts', {}).default
  i18n.registerMessages('settings', messages)
  const nativeCalls = []
  const sends = []
  const timers = new Map()
  let liveDescription = description
  let cloudStatus = 'ready'
  const invoke = async (command, args) => {
    nativeCalls.push([command, args])
    if (command === 'ai_ollama_describe') return liveDescription
    if (command === 'ai_ollama_chat_stream') {
      sends.push(['local', args])
      args.onEvent.onmessage({ type: 'text.delta', delta: 'synthetic answer' })
      args.onEvent.onmessage({ type: 'usage.updated', metrics: [{ kind: 'output_tokens', amount: 2, unit: 'token' }] })
      args.onEvent.onmessage({ type: 'completed', status: 'completed' })
      return
    }
    if (command === 'ai_ollama_cancel') return
    throw new Error(`Unexpected native call ${command}`)
  }
  const { ollamaLocalProvider: local } = load('src/workspace/ai/ollamaProvider.ts', {
    '@tauri-apps/api/core': { Channel: class {}, invoke }, '../../i18n': i18n, '../../store': { useAppStore: store },
  }, { window: { __TAURI_INTERNALS__: {} } })
  const cloud = (id) => ({
    id,
    async describe() { return { id, kind: 'test-account', name: id, status: id === 'cloud-one' ? cloudStatus : 'ready', modelCatalog: 'complete', capabilities: ['text.generate'], agents: [agent('cloud-model')] } },
    async *stream(request) { sends.push(['cloud', request]); yield { type: 'completed', runId: request.runId, status: 'completed' } },
    async cancel() {},
  })
  const runtime = load('src/workspace/ai/runtime.ts', {
    '@tauri-apps/api/core': { invoke }, '../../i18n': i18n, '../../store': { useAppStore: store },
    '../pluginPermissions': p.permissions, '../pluginRegistry': registry,
    '../telemetry': { measureLatency: (_label, work) => work() },
    './codexProvider': { codexChatGptProvider: cloud('cloud-one') },
    './xaiProvider': { xaiGrokProvider: cloud('cloud-two') },
    './ollamaProvider': { ollamaLocalProvider: local },
  }, {
    localStorage: p.storage,
    setTimeout(callback, ms) { const id = Symbol(); timers.set(id, { callback, ms }); return id },
    clearTimeout(id) { timers.delete(id) },
  })
  p.grant('installed', 'owner')
  const api = runtime.createPluginAi('owner', 'installed', p.snapshot('installed', 'owner'))
  return {
    runtime, api, local, nativeCalls, sends, settings, messages,
    grant: () => p.grant('installed', 'owner'), revoke: () => p.revoke('installed', 'owner'),
    request: (overrides = {}) => ({ input: [{ type: 'text', text: 'PRIVATE SYNTHETIC PROMPT' }], capabilities: ['text.generate'], ...overrides }),
    setDescription: (value) => { liveDescription = value },
    setCloudStatus: (value) => { cloudStatus = value },
    timeout() { for (const [id, timer] of timers) if (timer.ms === 10_000) { timers.delete(id); timer.callback() } },
    noSend() { assert.equal(sends.length, 0); assert.equal(nativeCalls.some(([name]) => name === 'plugin_blob_path'), false) },
  }
}
let passed = 0
async function check(name, run) {
  try { await run(); passed++ } catch (error) { error.message = `${name}: ${error.message}`; throw error }
}

for (const mutation of ['unregister', 'replace']) {
  for (const explicitProvider of [false, true]) {
    for (const configuredAgent of [undefined, 'local-model']) {
      for (const requestedAgent of [undefined, 'local-model']) {
        await check(`startup ${mutation}, provider ${explicitProvider ? 'explicit' : 'default'}, configured ${configuredAgent}, requested ${requestedAgent} never sends to cloud`, async () => {
          const h = harness(); h.settings.aiDefaultAgentId = configuredAgent
          if (mutation === 'unregister') h.runtime.registerAiProvider(h.local)()
          else h.runtime.registerAiProvider({
            id: 'ollama-local',
            async describe() { return { id: 'ollama-local', kind: 'test', name: 'Replaced local', status: 'unavailable', agents: [], capabilities: [] } },
            async *stream(value) { h.sends.push(['replacement', value]); throw new Error('Unexpected replacement inference') },
            async cancel() {},
          })
          const selection = { ...(explicitProvider ? { providerId: 'ollama-local' } : {}), ...(requestedAgent ? { agentId: requestedAgent } : {}) }
          assert.equal((await h.api.preflight(selection)).status, 'blocked')
          const descriptions = await h.runtime.listAiProviders()
          const selected = descriptions.find((provider) => provider.isDefault)
          assert.equal(selected?.id, 'ollama-local')
          assert.equal(selected.status, 'unavailable'); assert.equal(selected.authentication, 'none'); assert.equal(selected.fallbackPolicy, 'never')
          const result = await collect(h.api.stream(h.request(selection)))
          assert.equal(result.at(-1).type, 'error')
          h.noSend()
        })
      }
    }
  }
}
for (const explicitProvider of [false, true]) {
  await check(`unbound ${explicitProvider ? 'explicit' : 'default'} local model cannot change with directory order`, async () => {
    const h = harness(); h.settings.aiDefaultAgentId = undefined
    const selection = explicitProvider ? { providerId: 'ollama-local' } : {}
    for (const ids of [['one', 'two'], ['two', 'one']]) {
      h.setDescription(catalog({ models: ids.map((id) => ({ id, digest: id })) }))
      await h.runtime.refreshAiProvider('ollama-local')
      const readiness = await h.api.preflight({ ...selection, forceRefresh: true })
      assert.equal(readiness.status, 'blocked'); assert.equal(readiness.reason, 'agent_unknown')
      assert.equal(readiness.agentId, undefined)
      const result = await collect(h.api.stream(h.request(selection)))
      assert.equal(result.at(-1).code, 'agent_required')
      h.noSend()
    }
  })
}
await check('an explicit local model still runs when the local default has no saved model', async () => {
  const h = harness(); h.settings.aiDefaultAgentId = undefined
  const selection = { agentId: 'local-model' }
  assert.equal((await h.api.preflight(selection)).status, 'ready')
  assert.equal((await collect(h.api.stream(h.request(selection)))).at(-1).status, 'completed')
  assert.equal(h.sends.length, 1); assert.equal(h.sends[0][0], 'local')
})
await check('revoked local permission blocks all discovery and inference before routing', async () => {
  const h = harness(); h.revoke()
  await assert.rejects(h.api.preflight(), /Plugin permission required: ai.use/)
  await assert.rejects(collect(h.api.stream(h.request())), /Plugin permission required: ai.use/)
  assert.equal(h.nativeCalls.length, 0); h.noSend()
})
await check('revocation during local discovery remains cancelled after regrant and late metadata', async () => {
  const h = harness()
  const description = await h.local.describe()
  let resolve
  const metadata = new Promise((accept) => { resolve = accept })
  h.runtime.registerAiProvider({ ...h.local, describe: () => metadata })
  const result = collect(h.api.stream(h.request()))
  await flush(); h.revoke(); h.grant()
  assert.equal((await result).at(-1).status, 'cancelled')
  resolve(description); await flush(); h.noSend()
})
for (const failure of ['return', 'reject']) {
  await check(`replacement metadata ${failure} cannot remove built-in local authentication and fallback boundaries`, async () => {
    const h = harness()
    h.runtime.registerAiProvider({
      id: 'ollama-local',
      async describe() {
        if (failure === 'reject') throw new Error('PRIVATE REPLACEMENT BODY')
        return { id: 'ollama-local', kind: 'test', name: 'Replacement', status: 'unavailable', authentication: 'account', agents: [], capabilities: [] }
      },
      async *stream(value) { h.sends.push(['replacement', value]); throw new Error('Unexpected replacement inference') },
      async cancel() {},
    })
    const provider = (await h.runtime.listAiProviders()).find((item) => item.id === 'ollama-local')
    assert.equal(provider.authentication, 'none'); assert.equal(provider.fallbackPolicy, 'never'); assert.equal(provider.isDefault, true)
    assert.doesNotMatch(provider.statusMessage ?? '', /PRIVATE/)
    assert.equal((await h.api.preflight()).status, 'blocked')
    assert.equal((await collect(h.api.stream(h.request()))).at(-1).type, 'error')
    h.noSend()
  })
}
for (const configuredProvider of [undefined, 'cloud-one']) {
  for (const explicitAgent of [false, true]) {
    await check(`only-ready local provider with ${configuredProvider ?? 'no'} default requires provider opt-in, with model ${explicitAgent ? 'specified' : 'unspecified'}`, async () => {
      const h = harness()
      h.settings.aiDefaultProviderId = configuredProvider
      h.settings.aiDefaultAgentId = 'local-model' // A matching cloud setting is not a local-model choice.
      for (const id of ['cloud-one', 'cloud-two']) {
        h.runtime.registerAiProvider({
          id,
          async describe() { return { id, kind: 'test', name: id, status: 'unavailable', agents: [], capabilities: [] } },
          async *stream(value) { h.sends.push(['cloud', value]); throw new Error('Unexpected cloud inference') },
          async cancel() {},
        })
      }
      const result = await collect(h.api.stream(h.request(explicitAgent ? { agentId: 'local-model' } : {})))
      assert.equal(result.at(-1).code, 'provider_unavailable'); h.noSend()
      const local = (await h.runtime.listAiProviders()).find((provider) => provider.id === 'ollama-local')
      assert.equal(local.status, 'ready'); assert.equal(local.isDefault, false)
      if (explicitAgent) {
        const requested = await collect(h.api.stream(h.request({ providerId: 'ollama-local', agentId: 'local-model' })))
        assert.equal(requested.at(-1).status, 'completed')
        assert.equal(h.sends.length, 1); assert.equal(h.sends[0][0], 'local'); assert.equal(h.sends[0][1].model, 'local-model')
      }
    })
  }
}

for (const reason of ['service_unreachable', 'metadata_timeout', 'metadata_invalid', 'models_empty', 'models_unsupported']) {
  await check(`configured ${reason} local default does not fall back to either ready cloud provider`, async () => {
    const h = harness({ description: catalog({ models: [], statusReason: reason }) })
    const providers = await h.runtime.listAiProviders()
    assert.equal(providers.find((provider) => provider.isDefault)?.id, 'ollama-local')
    const events = await collect(h.api.stream(h.request()))
    assert.equal(events.length, 1); assert.equal(events[0].code, 'provider_unavailable')
    assert.equal(h.settings.aiDefaultProviderId, 'ollama-local'); assert.equal(h.settings.aiDefaultAgentId, 'local-model')
    assert.equal((await h.api.preflight()).status, 'blocked')
    h.noSend()
  })
}
for (const mode of ['reject', 'timeout']) {
  await check(`adapter ${mode} preserves the static no-fallback policy even when describe provides no descriptor`, async () => {
    const h = harness()
    h.runtime.registerAiProvider({ ...h.local, describe() {
      if (mode === 'reject') return Promise.reject(new Error('PRIVATE NATIVE DIAGNOSTIC'))
      return new Promise(() => {})
    } })
    const reading = h.runtime.listAiProviders()
    await flush(); if (mode === 'timeout') h.timeout()
    const providers = await reading
    const local = providers.find((provider) => provider.id === 'ollama-local')
    assert.equal(local.status, 'unavailable'); assert.equal(local.isDefault, true)
    assert.equal(local.authentication, 'none'); assert.equal(local.fallbackPolicy, 'never')
    assert.doesNotMatch(local.statusMessage, /PRIVATE/)
    const run = collect(h.api.stream(h.request()))
    await flush(); if (mode === 'timeout') h.timeout()
    assert.equal((await run)[0].code, 'provider_unavailable')
    h.noSend()
  })
}
for (const change of ['unregister', 'replace']) {
  await check(`pending local discovery ${change} cannot reroute the run or erase its static policy`, async () => {
    const h = harness()
    const originalDescription = await h.local.describe()
    let resolve, reject
    const metadata = new Promise((accept, fail) => { resolve = accept; reject = fail })
    const unregister = h.runtime.registerAiProvider({ ...h.local, describe: () => metadata })
    const listing = h.runtime.listAiProviders()
    const running = collect(h.api.stream(h.request()))
    await flush()
    if (change === 'unregister') {
      unregister()
      resolve(originalDescription)
    } else {
      h.runtime.registerAiProvider({
        id: 'ollama-local',
        async describe() { return { ...originalDescription, authentication: 'account', fallbackPolicy: undefined } },
        async *stream(request) {
          h.sends.push(['replacement', request])
          yield { type: 'completed', runId: request.runId, status: 'completed' }
        },
        async cancel() {},
      })
      reject(new Error('PRIVATE REPLACED PROVIDER DIAGNOSTIC'))
    }
    const descriptions = await listing
    const original = descriptions.find((provider) => provider.isDefault)
    assert.equal(original.id, 'ollama-local')
    assert.equal(original.status, 'unavailable')
    assert.equal(original.authentication, 'none'); assert.equal(original.fallbackPolicy, 'never')
    assert.doesNotMatch(original.statusMessage, /PRIVATE/)
    assert.equal((await running)[0].code, 'provider_unavailable')
    assert.equal(h.settings.aiDefaultProviderId, 'ollama-local'); assert.equal(h.settings.aiDefaultAgentId, 'local-model')
    h.noSend()
  })
}
await check('missing configured local model never silently picks a different installed model', async () => {
  const h = harness({ description: catalog({ models: [{ id: 'different-local-model', digest: 'other' }] }) })
  const events = await collect(h.api.stream(h.request()))
  assert.equal(events[0].code, 'agent_unavailable'); h.noSend()
  assert.equal((await h.api.preflight()).status, 'blocked')
  assert.equal(h.settings.aiDefaultAgentId, 'local-model')
})
await check('refresh preserves configured local provider and model through removal and recovery', async () => {
  const h = harness()
  h.setDescription(catalog({ models: [], statusReason: 'models_empty' }))
  const unavailable = await h.runtime.refreshAiProvider('ollama-local')
  assert.equal(unavailable.isDefault, true); assert.equal(unavailable.status, 'unavailable')
  assert.equal(h.settings.aiDefaultProviderId, 'ollama-local'); assert.equal(h.settings.aiDefaultAgentId, 'local-model')
  h.setDescription(catalog())
  const available = await h.runtime.refreshAiProvider('ollama-local')
  assert.equal(available.isDefault, true); assert.equal(available.status, 'ready')
  assert.equal((await h.api.preflight({ forceRefresh: true })).status, 'ready')
  h.noSend()
})
await check('default local text run uses the configured model without an invented effort or quota', async () => {
  const h = harness(); const events = await collect(h.api.stream(h.request()))
  assert.equal(events.at(-1).status, 'completed')
  assert.equal(h.sends.length, 1); assert.equal(h.sends[0][0], 'local')
  assert.equal(h.sends[0][1].model, 'local-model'); assert.equal(h.sends[0][1].effort, undefined)
  const usage = (await h.api.usage())[0]
  assert.equal(usage.providerId, 'ollama-local'); assert.equal(usage.agentId, 'local-model'); assert.equal(usage.effort, undefined)
  assert.deepEqual(plain(usage.metrics), [{ kind: 'output_tokens', amount: 2, unit: 'token' }])
})
await check('an explicitly chosen cloud provider still overrides the local default', async () => {
  const h = harness()
  assert.equal((await collect(h.api.stream(h.request({ providerId: 'cloud-two', agentId: 'cloud-model' })))).at(-1).status, 'completed')
  assert.equal(h.sends.length, 1); assert.equal(h.sends[0][0], 'cloud')
  assert.equal(h.sends[0][1].agentId, 'cloud-model')
})
for (const defaultAgent of ['cloud-model', 'local-model']) {
  await check(`explicit local provider without a model cannot inherit a cloud default (${defaultAgent})`, async () => {
    const h = harness({ defaultProvider: 'cloud-one', defaultAgent })
    const preflight = await h.api.preflight({ providerId: 'ollama-local' })
    assert.equal(preflight.status, 'blocked'); assert.equal(preflight.reason, 'agent_unknown')
    assert.equal(preflight.agentId, undefined); assert.equal(preflight.message, h.messages.en.aiAgentRequired)
    const events = await collect(h.api.stream(h.request({ providerId: 'ollama-local' })))
    assert.equal(events[0].code, 'agent_required'); assert.equal(events[0].message, h.messages.en.aiAgentRequired)
    assert.equal(h.nativeCalls.length, 0); h.noSend()
  })
}
await check('an explicit local model is allowed when the configured defaults belong to a cloud provider', async () => {
  const h = harness({ defaultProvider: 'cloud-one', defaultAgent: 'cloud-model' })
  const selection = { providerId: 'ollama-local', agentId: 'local-model' }
  assert.equal((await h.api.preflight(selection)).status, 'ready')
  assert.equal((await collect(h.api.stream(h.request(selection)))).at(-1).status, 'completed')
  assert.equal(h.sends.length, 1); assert.equal(h.sends[0][0], 'local'); assert.equal(h.sends[0][1].model, 'local-model')
})
await check('account providers retain their previous automatic provider and model fallback', async () => {
  const h = harness({ defaultProvider: 'cloud-one', defaultAgent: 'old-cloud-model' })
  h.setCloudStatus('unavailable')
  assert.equal((await collect(h.api.stream(h.request()))).at(-1).status, 'completed')
  assert.equal(h.sends.length, 1); assert.equal(h.sends[0][0], 'cloud')
  assert.equal(h.sends[0][1].agentId, 'cloud-model')
  assert.equal(h.settings.aiDefaultProviderId, 'cloud-one'); assert.equal(h.settings.aiDefaultAgentId, 'old-cloud-model')
})
for (const type of ['image', 'audio', 'file']) {
  await check(`${type} input is blocked before resolving a local blob or sending model work`, async () => {
    const h = harness({ locale: 'zh' })
    const events = await collect(h.api.stream(h.request({ input: [{ type, blobId: 'PRIVATE BLOB' }] })))
    assert.equal(events[0].code, 'input_unavailable'); assert.equal(events[0].message, h.messages.zh.aiInputUnavailable)
    h.noSend()
  })
}
for (const capability of ['image.understand', 'web.search', 'tool.call', 'structured_output']) {
  await check(`${capability} cannot be requested from Ollama`, async () => {
    const h = harness(); const events = await collect(h.api.stream(h.request({ capabilities: [capability] })))
    assert.equal(events[0].code, 'capability_unavailable'); h.noSend()
  })
}
await check('provider-level capabilities cannot expand the selected agent capabilities', async () => {
  const h = harness()
  h.runtime.registerAiProvider({ ...h.local, async describe() {
    const local = await h.local.describe()
    return { ...local, capabilities: ['text.generate', 'web.search'] }
  } })
  assert.equal((await collect(h.api.stream(h.request({ capabilities: ['web.search'] }))))[0].code, 'capability_unavailable')
  h.noSend()
})
console.log(`Ollama runtime behavior OK (${passed} cases; fake native boundary, no live model inference)`)
