#!/usr/bin/env node
// Real runtime, permission snapshots, Zustand store and registry; only I/O boundaries are controlled.
import assert from 'node:assert/strict'
import { load, permissionHarness, registryHarness } from './ai-runtime-test-harness.mjs'

function deferred() {
  let resolve, reject
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}
const flush = () => new Promise((resolve) => setImmediate(resolve))
async function bounded(promise) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Permission cancellation did not settle')), 1500)
    })])
  } finally { clearTimeout(timer) }
}
async function collect(iterable) {
  const events = []
  for await (const event of iterable) events.push(event)
  return events
}
const descriptor = (id = 'selected') => ({
  id, kind: id, name: id, status: 'ready', capabilities: ['text.generate'],
  agents: [{ id: 'model', name: 'Model', capabilities: ['text.generate'], inputModalities: ['text', 'image'], supportedEfforts: [], isDefault: true }],
})
function observedController() {
  const controller = new AbortController()
  const listeners = new Set()
  const add = controller.signal.addEventListener.bind(controller.signal)
  const remove = controller.signal.removeEventListener.bind(controller.signal)
  controller.signal.addEventListener = (type, listener, options) => {
    if (type === 'abort') listeners.add(listener)
    add(type, listener, options)
  }
  controller.signal.removeEventListener = (type, listener, options) => {
    if (type === 'abort') listeners.delete(listener)
    remove(type, listener, options)
  }
  return { controller, listeners }
}
function harness({ native, source = 'installed', pluginId = 'owner', registered = false } = {}) {
  const p = permissionHarness()
  const registry = registryHarness()
  const calls = []
  const records = new Map()
  const registerPlugin = (targetSource = source, id = pluginId, definition = {}, declared = ['ai.use']) => {
    const method = targetSource === 'dev' ? 'registerDevPlugin' : 'registerProductionPlugin'
    registry.pluginRegistry[method](id, [], [], [], [], definition, declared)
    return definition
  }
  if (registered) registerPlugin()
  const runtime = load('src/workspace/ai/runtime.ts', {
    '@tauri-apps/api/core': { async invoke(command, args) {
      calls.push([command, args])
      const pending = native?.(command, args)
      if (pending !== undefined) return pending
      if (command === 'ai_usage_record_upsert') { records.set(args.record.runId, args.record); return }
      if (command === 'ai_usage_record_list') return [...records.values()]
      throw new Error(`Unexpected native call: ${command}`)
    } },
    '../../store': { useAppStore: { getState: () => ({ settings: { aiDefaultProviderId: 'selected', aiDefaultAgentId: 'model' } }) } },
    '../pluginPermissions': p.permissions,
    '../pluginRegistry': registry,
    '../telemetry': { measureLatency: (_label, work) => work() },
    './codexProvider': { codexChatGptProvider: { id: 'unused-codex', async describe() { return { ...descriptor('unused-codex'), status: 'unavailable' } } } },
    './xaiProvider': { xaiGrokProvider: { id: 'unused-xai', async describe() { return { ...descriptor('unused-xai'), status: 'unavailable' } } } },
    './ollamaProvider': { ollamaLocalProvider: { id: 'unused-ollama', async describe() { return { ...descriptor('unused-ollama'), status: 'unavailable' } } } },
    '../../i18n': { translate: (_locale, _namespace, key) => key },
  }, { localStorage: p.storage, ...(native ? { window: { __TAURI_INTERNALS__: {} } } : {}) })
  const h = {
    ...p, runtime, registry, calls, records, source, pluginId, registerPlugin,
    api(targetSource = source, id = pluginId, declared = ['ai.use']) {
      return runtime.createPluginAi(id, targetSource, p.snapshot(targetSource, id, declared))
    },
    grant: (targetSource = source, id = pluginId) => p.grant(targetSource, id),
    revoke: (targetSource = source, id = pluginId) => p.revoke(targetSource, id),
    clear: (targetSource = source, id = pluginId) => p.store.getState().clearPluginPermissions(targetSource, id),
    request: (overrides = {}) => ({ providerId: 'selected', input: [{ type: 'text', text: 'synthetic input' }], ...overrides }),
    register(overrides = {}) {
      return runtime.registerAiProvider({
        id: 'selected',
        async describe() { calls.push(['describe']); return descriptor() },
        async *stream(request) { calls.push(['send', request]); yield { type: 'completed', runId: request.runId, status: 'completed' } },
        async cancel(runId) { calls.push(['cancel', runId]) },
        ...overrides,
      })
    },
    clean(external) {
      assert.equal(p.subscriptions.size, 0, 'permission subscription leaked')
      assert.equal(registry.subscriptions.size, 0, 'registry subscription leaked')
      if (external) assert.equal(external.listeners.size, 0, 'external abort listener leaked')
    },
  }
  return h
}
function pendingProvider(h) {
  const event = deferred()
  const entered = deferred()
  let request
  h.register({ stream(value) {
    request = value
    h.calls.push(['send', request])
    let first = true
    return { [Symbol.asyncIterator]() { return {
      async next() {
        if (first) { first = false; return { value: { type: 'run.started', runId: request.runId, providerId: 'selected', agentId: 'model' } } }
        entered.resolve()
        return event.promise
      },
      async return() { h.calls.push(['close']); return { done: true } },
    } } }
  } })
  return { event, entered, request: () => request }
}
const permissionDenied = /Plugin permission required: ai.use/
let passed = 0
async function check(name, work) {
  try { await work(); passed++ } catch (error) { error.message = `${name}: ${error.message}`; throw error }
}

for (const source of ['builtin', 'installed', 'dev']) {
  await check(`${source}: real snapshot semantics, stale calls and the initial ceiling`, async () => {
    const h = harness({ source }); h.register()
    assert.equal(h.snapshot(source, 'owner')['ai.use'].granted, source === 'builtin')
    const denied = h.api(source, 'owner', [])
    h.grant()
    assert.equal(JSON.parse(h.storage.getItem('hiven-plugin-permissions')).state.permissions[source].owner['ai.use'].granted, true)
    for (const call of [() => denied.providers(), () => denied.usage(), () => collect(denied.stream(h.request())), () => denied.cancel('unknown')]) {
      await assert.rejects(call, permissionDenied)
    }
    assert.equal(h.calls.length, 0)
    const owner = h.api()
    assert.equal((await collect(owner.stream(h.request())))[0].status, 'completed')
    h.revoke()
    assert.equal(JSON.parse(h.storage.getItem('hiven-plugin-permissions')).state.permissions[source].owner['ai.use'].granted, false)
    const count = h.calls.length
    for (const call of [() => owner.providers(), () => owner.usage(), () => collect(owner.stream(h.request())), () => owner.cancel('unknown')]) {
      await assert.rejects(call, permissionDenied)
    }
    assert.equal(h.calls.length, count, 'revoked entrypoints must not touch provider/native I/O')
    h.clean()
  })
}

await check('provider metadata revocation latches across regrant and discards a late result', async () => {
  const h = harness({ registered: true }); const gate = deferred(); const entered = deferred(); h.grant()
  h.register({ describe() { entered.resolve(); return gate.promise } })
  const owner = h.api()
  const rejected = assert.rejects(owner.providers(), permissionDenied)
  await entered.promise; h.revoke(); h.grant()
  await bounded(rejected); h.clean()
  gate.resolve(descriptor()); await flush(); h.clean()
  assert.ok((await owner.providers()).some((provider) => provider.id === 'selected'))
  h.clean()
})

await check('usage revocation rejects even after regrant, with scoped query and listener cleanup', async () => {
  const gate = deferred(); const entered = deferred()
  const h = harness({ native(command) { if (command === 'ai_usage_record_list') { entered.resolve(); return gate.promise } } }); h.grant()
  const owner = h.api()
  const rejected = assert.rejects(owner.usage({ providerId: 'selected', limit: 7 }), permissionDenied)
  await entered.promise
  const args = h.calls[0][1]
  assert.equal(args.pluginId, 'owner'); assert.equal(args.pluginSource, 'installed'); assert.equal(args.limit, 7)
  h.revoke(); h.grant(); await bounded(rejected); h.clean()
  gate.resolve([{ runId: 'private-result' }]); await flush(); h.clean()
})

for (const stage of ['describe', 'running-write', 'blob']) {
  await check(`revocation during ${stage} prevents later blob/body dispatch after regrant`, async () => {
    const gate = deferred(); const entered = deferred()
    const h = harness({ registered: true, native(command, args) {
      if ((stage === 'running-write' && command === 'ai_usage_record_upsert' && args.record.status === 'running')
        || (stage === 'blob' && command === 'plugin_blob_path')) { entered.resolve(); return gate.promise }
      if (command === 'plugin_blob_path') return Promise.resolve('/synthetic/file')
    } }); h.grant()
    h.register(stage === 'describe' ? { describe() { entered.resolve(); return gate.promise } } : {})
    const external = observedController()
    const pending = collect(h.api().stream(h.request({ signal: external.controller.signal, input: [
      { type: 'file', blobId: 'first' }, { type: 'file', blobId: 'second' },
    ] })))
    await entered.promise; h.revoke(); h.grant()
    const events = await bounded(pending)
    assert.equal(events.length, 1); assert.equal(events[0].status, 'cancelled')
    assert.equal(h.calls.filter(([name]) => name === 'send').length, 0)
    assert.equal(h.calls.filter(([name]) => name === 'plugin_blob_path').length, stage === 'blob' ? 1 : 0)
    h.clean(external)
    gate.resolve(stage === 'describe' ? descriptor() : '/synthetic/late-file'); await flush()
    assert.equal(h.calls.filter(([name]) => name === 'send').length, 0); h.clean(external)
    const terminal = [...h.records.values()][0]
    if (stage !== 'describe') assert.equal(terminal.status, 'cancelled')
  })
}

for (const waiting of [false, true]) {
  await check(`active revocation cancels a ${waiting ? 'pending' : 'paused'} iterator; owner/source isolation remains`, async () => {
    const h = harness({ registered: true }); h.grant(); h.grant('dev'); h.grant('installed', 'other')
    const provider = pendingProvider(h)
    const external = observedController()
    const owner = h.api()
    const iterator = owner.stream(h.request({ signal: external.controller.signal }))[Symbol.asyncIterator]()
    const started = (await iterator.next()).value
    await h.api('dev').cancel(started.runId); await h.api('installed', 'other').cancel(started.runId)
    h.revoke('dev'); h.revoke('installed', 'other')
    assert.equal(provider.request().signal.aborted, false)
    assert.equal(h.calls.filter(([name]) => name === 'cancel').length, 0)
    let next
    if (waiting) { next = iterator.next(); await provider.entered.promise }
    h.revoke(); h.grant()
    assert.equal(provider.request().signal.aborted, true); h.clean(external)
    await owner.cancel(started.runId)
    await flush()
    const cancelledUsage = (await owner.usage())[0]
    assert.equal(cancelledUsage.status, 'cancelled', 'usage must finalize while the consumer remains paused')
    assert.ok(cancelledUsage.finishedAt)
    provider.event.resolve({ value: { type: 'text.delta', runId: started.runId, delta: 'late private data' } })
    const terminal = (await bounded(next ?? iterator.next())).value
    assert.equal(terminal.type, 'completed'); assert.equal(terminal.status, 'cancelled')
    assert.equal((await iterator.next()).done, true)
    assert.equal(h.calls.filter(([name]) => name === 'cancel').length, 1)
    assert.equal((await owner.usage())[0].status, 'cancelled'); h.clean(external)
  })
}

for (const source of ['installed', 'dev']) {
  await check(`${source}: clearing stored grants aborts an active request`, async () => {
    const h = harness({ source }); h.grant(); const provider = pendingProvider(h)
    const iterator = h.api().stream(h.request())[Symbol.asyncIterator]()
    await iterator.next(); h.clear()
    assert.equal(provider.request().signal.aborted, true)
    assert.equal((await iterator.next()).value.status, 'cancelled'); await iterator.next(); h.clean()
  })
}

for (const change of ['unregister', 'replace', 'manifest']) {
  await check(`registered builtin ${change} cancels its old identity without affecting dev`, async () => {
    const h = harness({ source: 'builtin', registered: true }); h.grant('dev'); h.registerPlugin('dev')
    const provider = pendingProvider(h)
    const owner = h.api()
    const iterator = owner.stream(h.request())[Symbol.asyncIterator]()
    await iterator.next()
    h.registry.pluginRegistry.unregisterDevPlugin('owner')
    assert.equal(provider.request().signal.aborted, false)
    if (change === 'unregister') h.registry.pluginRegistry.unregisterProductionPlugin('owner')
    else if (change === 'replace') h.registerPlugin()
    else h.registerPlugin('builtin', 'owner', h.registry.pluginRegistry.getPluginDefinition('owner', 'builtin'), [])
    assert.equal(provider.request().signal.aborted, true)
    assert.equal((await iterator.next()).value.status, 'cancelled'); await iterator.next()
    await assert.rejects(owner.providers(), permissionDenied); h.clean()
  })
}

await check('registry unload and restoration during metadata await cannot revive its old result', async () => {
  const h = harness({ source: 'builtin', registered: true }); const entered = deferred(); const gate = deferred()
  h.register({ describe() { entered.resolve(); return gate.promise } })
  const definition = h.registry.pluginRegistry.getPluginDefinition('owner', 'builtin')
  const pending = assert.rejects(h.api().providers(), permissionDenied)
  await entered.promise; h.registry.pluginRegistry.unregisterProductionPlugin('owner'); h.registerPlugin('builtin', 'owner', definition)
  await bounded(pending); h.clean(); gate.resolve(descriptor()); await flush(); h.clean()
})

for (const outcome of ['completed', 'error', 'eof', 'throw', 'return', 'removed', 'unavailable', 'agent', 'capability', 'empty', 'input']) {
  await check(`${outcome}: terminal and early exits detach listeners and remove active cancellation`, async () => {
    const h = harness({ registered: true }); h.grant(); const external = observedController()
    let unregister
    unregister = h.register({
      async describe() { if (outcome === 'removed') unregister(); return outcome === 'unavailable' ? { ...descriptor(), status: 'unavailable' } : descriptor() },
      stream(request) {
        let first = true
        return { [Symbol.asyncIterator]() { return {
          async next() {
            if (outcome === 'throw') throw new Error('synthetic failure')
            if (outcome === 'eof') return { done: true }
            if (outcome === 'return' && first) { first = false; return { value: { type: 'text.delta', runId: request.runId, delta: 'partial' } } }
            return { value: outcome === 'error'
              ? { type: 'error', runId: request.runId, code: 'synthetic', message: 'synthetic failure' }
              : { type: 'completed', runId: request.runId, status: 'completed' } }
          },
          async return() { h.calls.push(['close']); return { done: true } },
        } } }
      },
    })
    const overrides = { signal: external.controller.signal }
    if (outcome === 'agent') overrides.agentId = 'missing'
    if (outcome === 'capability') overrides.capabilities = ['audio.generate']
    if (outcome === 'empty') overrides.input = []
    if (outcome === 'input') overrides.input = [{ type: 'audio', blobId: 'unsupported' }]
    const owner = h.api()
    const iterator = owner.stream(h.request(overrides))[Symbol.asyncIterator]()
    const event = (await iterator.next()).value
    if (outcome === 'return') await iterator.return()
    else {
      assert.ok(event.type === 'completed' || event.type === 'error')
      h.clean(external) // Must detach before yielding terminal, even if the consumer never resumes.
      const cancels = h.calls.filter(([name]) => name === 'cancel').length
      await owner.cancel(event.runId); await flush()
      assert.equal(h.calls.filter(([name]) => name === 'cancel').length, cancels)
      await iterator.next()
    }
    h.clean(external)
  })
}

for (const outcome of ['completed', 'error']) {
  await check(`${outcome} committed before revocation keeps its terminal and final usage`, async () => {
    const gate = deferred(); const entered = deferred()
    const h = harness({ native(command, args) {
      if (command === 'ai_usage_record_upsert' && args.record.status !== 'running') { entered.resolve(); return gate.promise }
    } }); h.grant()
    h.register({ async *stream(request) {
      yield outcome === 'error' ? { type: 'error', runId: request.runId, code: 'first', message: 'first failure' }
        : { type: 'completed', runId: request.runId, status: 'completed' }
    } })
    const external = observedController()
    const pending = collect(h.api().stream(h.request({ signal: external.controller.signal })))
    await entered.promise; h.clean(external); h.revoke(); external.controller.abort(); gate.resolve()
    const events = await bounded(pending)
    assert.equal(events.length, 1); assert.equal(events[0].type, outcome)
    if (outcome === 'completed') assert.equal(events[0].status, 'completed')
    const writes = h.calls.filter(([name]) => name === 'ai_usage_record_upsert').map(([, args]) => args.record.status)
    assert.deepEqual(writes, ['running', outcome === 'error' ? 'failed' : 'completed']); h.clean(external)
  })
}

await check('usage failure and provider discovery failure release temporary watchers', async () => {
  const h = harness({ registered: true, native(command) {
    if (command === 'ai_usage_record_list') return Promise.reject(new Error('synthetic storage failure'))
  } }); h.grant(); h.register({ async describe() { throw new Error('synthetic discovery failure') } })
  const owner = h.api()
  await assert.rejects(owner.usage(), /synthetic storage failure/); h.clean()
  assert.equal((await owner.providers()).find((provider) => provider.id === 'selected').status, 'unavailable'); h.clean()
})

for (const kind of ['Codex', 'xAI']) {
  await check(`revocation reaches the real ${kind} adapter and cancels its native operation once`, async () => {
    const h = harness(); h.grant()
    const calls = []; const entered = deferred(); const pendingNative = deferred()
    let emit
    let adapter
    if (kind === 'Codex') {
      const module = load('src/workspace/ai/codexProvider.ts', {
        '@tauri-apps/api/core': { async invoke(command, args) {
          calls.push([command, args])
          const result = args.method === 'thread/start' ? { thread: { id: 'thread' } }
            : args.method === 'turn/start' ? { turn: { id: 'turn' } } : {}
          return { ...result, _hivenConnectionId: 'connection' }
        } },
        '@tauri-apps/api/event': { async listen(_name, callback) {
          emit = () => callback({ payload: {
            method: 'item/agentMessage/delta',
            params: { threadId: 'thread', turnId: 'turn', delta: 'late private data' },
            _hivenConnectionId: 'connection',
          } })
          return () => {}
        } },
      }, { window: { __TAURI_INTERNALS__: {} } })
      adapter = module.codexChatGptProvider
    } else {
      const module = load('src/workspace/ai/xaiProvider.ts', {
        '@tauri-apps/api/core': {
          Channel: class { constructor() { emit = () => this.onmessage({ type: 'response.output_text.delta', delta: 'late private data' }) } },
          invoke(command, args) {
            calls.push([command, args])
            if (command === 'ai_xai_response_stream') { entered.resolve(); return pendingNative.promise }
            return Promise.resolve()
          },
        },
      })
      adapter = module.xaiGrokProvider
    }
    h.runtime.registerAiProvider({ ...adapter, id: 'selected', async describe() { return descriptor() } })
    const owner = h.api()
    const iterator = owner.stream(h.request())[Symbol.asyncIterator]()
    assert.equal((await iterator.next()).value.type, 'run.started')
    const next = iterator.next()
    if (kind === 'xAI') await entered.promise
    h.revoke(); h.grant(); emit()
    assert.equal((await bounded(next)).value.status, 'cancelled')
    assert.equal((await iterator.next()).done, true)
    assert.equal(calls.filter(([command, args]) => kind === 'Codex' ? args.method === 'turn/interrupt' : command === 'ai_xai_cancel').length, 1)
    if (kind === 'xAI') pendingNative.reject(new Error('late transport failure'))
    emit(); await flush(); h.clean()
    assert.equal((await owner.usage())[0].status, 'cancelled')
  })
}

console.log(`AI permission behavior passed: ${passed} real runtime/store/registry cases`)
