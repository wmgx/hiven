#!/usr/bin/env node
// Exercise the real TS modules with controlled provider/native boundaries. No UI or source-pattern checks.
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
      timer = setTimeout(() => reject(new Error('Cancellation or cleanup did not settle')), 1000)
    })])
  } finally { clearTimeout(timer) }
}
async function collect(iterable) {
  const events = []
  for await (const event of iterable) events.push(event)
  return events
}
let passed = 0
async function check(name, test) {
  if (process.argv.includes('--codex-only') && !name.startsWith('Codex')) return
  try { await test(); passed++ } catch (error) { error.message = `${name}: ${error.message}`; throw error }
}
function descriptor(id = 'selected') {
  return {
    id, kind: id, name: id, status: 'ready', capabilities: ['text.generate'],
    agents: [
      { id: 'default-model', name: 'Default', capabilities: ['text.generate'], inputModalities: ['text'], supportedEfforts: ['low', 'high'], defaultEffort: 'low', isDefault: true },
      { id: 'chosen-model', name: 'Chosen', capabilities: ['text.generate'], inputModalities: ['text'], supportedEfforts: ['low', 'high'], defaultEffort: 'low' },
    ],
  }
}
function runtimeHarness(nativeInvoke) {
  const permissionState = permissionHarness()
  const discovery = []
  const settings = { aiDefaultProviderId: 'selected', aiDefaultAgentId: 'chosen-model', aiDefaultEffort: 'high' }
  const inactive = (id) => ({ id, async describe() { discovery.push(id); return { ...descriptor(id), status: 'unavailable' } } })
  const runtime = load('src/workspace/ai/runtime.ts', {
    '@tauri-apps/api/core': { invoke: nativeInvoke ?? (async () => { throw new Error('Unexpected native call') }) },
    '../../store': { useAppStore: { getState: () => ({ settings }) } },
    '../pluginPermissions': permissionState.permissions,
    '../pluginRegistry': registryHarness(),
    '../telemetry': { measureLatency: (_label, work) => work() },
    './codexProvider': { codexChatGptProvider: inactive('openai-chatgpt') },
    './xaiProvider': { xaiGrokProvider: inactive('xai-grok') },
    './ollamaProvider': { ollamaLocalProvider: inactive('ollama-local') },
    '../../i18n': { translate: (_locale, _namespace, key) => key },
  }, { ...(nativeInvoke ? { window: { __TAURI_INTERNALS__: {} } } : {}), localStorage: permissionState.storage })
  permissionState.grant('installed', 'translate')
  const owner = runtime.createPluginAi('translate', 'installed', permissionState.snapshot('installed', 'translate'))
  const calls = []
  const h = { runtime, owner, calls, discovery, settings, permissionState }
  h.register = (overrides = {}) => runtime.registerAiProvider({
    id: 'selected',
    async describe() { discovery.push('selected'); return descriptor() },
    async *stream(request) { calls.push(['request', request]); yield { type: 'completed', runId: request.runId, status: 'completed' } },
    async cancel(runId) { calls.push(['cancel', runId]) },
    ...overrides,
  })
  h.request = (overrides = {}) => ({ providerId: 'selected', input: [{ type: 'text', text: 'input' }], ...overrides })
  h.usage = async () => (await owner.usage())[0]
  return h
}

await check('pre-abort skips discovery and starting a run', async () => {
  const h = runtimeHarness(); h.register()
  const controller = new AbortController(); controller.abort()
  const events = await collect(h.owner.stream(h.request({ signal: controller.signal })))
  assert.equal(events.length, 1); assert.equal(events[0].status, 'cancelled')
  assert.equal(h.discovery.length, 0); assert.equal(h.calls.length, 0)
})
await check('abort while discovery is pending cannot resume startup later', async () => {
  const h = runtimeHarness(); const gate = deferred(); const entered = deferred()
  h.register({ describe() { entered.resolve(); return gate.promise } })
  const controller = new AbortController()
  const result = collect(h.owner.stream(h.request({ signal: controller.signal })))
  await entered.promise; controller.abort()
  assert.equal((await bounded(result))[0].status, 'cancelled')
  gate.resolve(descriptor()); await flush()
  assert.equal(h.calls.length, 0)
})
await check('explicit provider isolates discovery and preserves chosen agent and effort', async () => {
  const h = runtimeHarness(); h.register()
  await collect(h.owner.stream(h.request()))
  assert.deepEqual(h.discovery, ['selected'])
  const request = h.calls[0][1]
  assert.equal(request.agentId, 'chosen-model'); assert.equal(request.effort, 'high')
  assert.ok(request.signal instanceof AbortSignal)
  assert.equal((await h.usage()).status, 'completed')
})
await check('unavailable explicit provider and agent never fall back', async () => {
  const h = runtimeHarness(); h.register()
  assert.equal((await collect(h.owner.stream(h.request({ providerId: 'missing' }))))[0].code, 'provider_unavailable')
  assert.equal((await collect(h.owner.stream(h.request({ providerId: '' }))))[0].code, 'provider_unavailable')
  assert.equal(h.discovery.length, 0)
  assert.equal((await collect(h.owner.stream(h.request({ agentId: 'missing' }))))[0].code, 'agent_unavailable')
  assert.equal(h.calls.length, 0)
})
await check('abort-caused next rejection is cancelled, with cancel before close', async () => {
  const h = runtimeHarness(); const entered = deferred()
  h.register({ stream(request) { return { [Symbol.asyncIterator]() { return {
    next() { entered.resolve(); return new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(new Error('transport aborted')), { once: true })) },
    async return() { h.calls.push(['close']); return { done: true } },
  } } } } })
  const controller = new AbortController()
  const result = collect(h.owner.stream(h.request({ signal: controller.signal })))
  await entered.promise; controller.abort()
  const events = await bounded(result)
  assert.equal(events.length, 1); assert.equal(events[0].status, 'cancelled')
  assert.deepEqual(h.calls.map(([name]) => name), ['cancel', 'close'])
  assert.equal((await h.usage()).status, 'cancelled'); assert.ok((await h.usage()).finishedAt)
})
await check('only the exact plugin and source owner can cancel; adapter remains pinned', async () => {
  const h = runtimeHarness(); const pending = deferred(); let request
  const unregister = h.register({ stream(value) { request = value; return { [Symbol.asyncIterator]() { let first = true; return {
    async next() { if (first) { first = false; return { value: { type: 'run.started', runId: request.runId, providerId: 'selected', agentId: request.agentId } } } return pending.promise },
    async return() { return { done: true } },
  } } } }, async cancel(id) { h.calls.push(['cancel', id]); pending.resolve({ done: true }) } })
  const iterator = h.owner.stream(h.request())[Symbol.asyncIterator]()
  const first = await iterator.next()
  for (const [id, source] of [['other', 'installed'], ['translate', 'dev']]) {
    h.permissionState.grant(source, id)
    await h.runtime.createPluginAi(id, source, h.permissionState.snapshot(source, id)).cancel(first.value.runId)
  }
  assert.equal(h.calls.length, 0); assert.equal(request.signal.aborted, false)
  unregister()
  const waiting = iterator.next()
  await h.owner.cancel(first.value.runId)
  assert.equal((await bounded(waiting)).value.status, 'cancelled')
  await iterator.next()
  assert.equal(h.calls.length, 1); assert.equal((await h.usage()).status, 'cancelled')
})
await check('first successful terminal wins, late events and cleanup errors cannot turn it into failure', async () => {
  const h = runtimeHarness()
  h.register({ async *stream(request) { try {
    yield { type: 'text.delta', runId: 'another-run', delta: 'wrong' }
    yield { type: 'usage.updated', runId: request.runId, metrics: [{ kind: 'output_tokens', amount: 3, unit: 'token' }] }
    yield { type: 'completed', runId: request.runId, status: 'completed' }
    yield { type: 'text.delta', runId: request.runId, delta: 'late' }
    yield { type: 'error', runId: request.runId, code: 'late', message: 'late' }
  } finally { h.calls.push(['close']); throw new Error('cleanup failed') } } })
  const events = await collect(h.owner.stream(h.request()))
  assert.deepEqual(events.map((event) => event.type), ['usage.updated', 'completed'])
  assert.deepEqual(h.calls.map(([name]) => name), ['close'])
  const usage = await h.usage(); assert.equal(usage.status, 'completed'); assert.equal(usage.metrics[0].amount, 3)
})
for (const outcome of ['eof', 'error', 'throw', 'return']) {
  await check(`${outcome} closes with one final usage status and cancels before return`, async () => {
    const h = runtimeHarness()
    // Observe the outer close invocation, distinct from a generator's own EOF/throw cleanup.
    const adapter = { async describe() { return descriptor() }, id: 'selected', async cancel() { h.calls.push(['cancel']) }, stream(request) {
      let first = true
      return { [Symbol.asyncIterator]() { return {
        async next() {
          if (first) { first = false; return { value: { type: 'text.delta', runId: request.runId, delta: 'partial' } } }
          if (outcome === 'throw') throw new Error('failed')
          if (outcome === 'error') return { value: { type: 'error', runId: request.runId, code: 'failed', message: 'failed' } }
          return { done: true }
        },
        async return() { h.calls.push(['close']); return { done: true } },
      } } }
    } }
    h.runtime.registerAiProvider(adapter)
    const iterator = h.owner.stream(h.request())[Symbol.asyncIterator]()
    assert.equal((await iterator.next()).value.type, 'text.delta')
    if (outcome === 'return') await iterator.return()
    else {
      const events = await collect({ [Symbol.asyncIterator]: () => iterator })
      assert.equal(events.length, 1); assert.equal(events[0].type, 'error')
      if (outcome === 'eof') assert.equal(events[0].code, 'provider_incomplete')
    }
    assert.deepEqual(h.calls.map(([name]) => name), ['cancel', 'close'])
    assert.equal((await h.usage()).status, outcome === 'return' ? 'cancelled' : 'failed')
    assert.ok((await h.usage()).finishedAt)
  })
}

await check('cancelled startup serializes terminal usage after a delayed running upsert', async () => {
  const gate = deferred(); const entered = deferred(); const writes = []; let saved
  const h = runtimeHarness(async (command, args) => {
    if (command === 'ai_usage_record_upsert') {
      writes.push(args.record.status)
      if (args.record.status === 'running') { entered.resolve(); await gate.promise }
      saved = args.record
      return
    }
    if (command === 'ai_usage_record_list') return saved ? [saved] : []
    throw new Error(`Unexpected command ${command}`)
  })
  h.register(); const controller = new AbortController()
  const pending = collect(h.owner.stream(h.request({ signal: controller.signal })))
  await entered.promise; controller.abort()
  assert.equal((await bounded(pending))[0].status, 'cancelled')
  assert.deepEqual(writes, ['running']); assert.equal(h.calls.length, 0)
  gate.resolve(); await flush()
  assert.deepEqual(writes, ['running', 'cancelled']); assert.equal((await h.usage()).status, 'cancelled')
})
await check('an adapter whose cleanup never settles cannot hold a completed run forever', async () => {
  const h = runtimeHarness()
  h.register({ stream(request) { return { [Symbol.asyncIterator]() { return {
    async next() { return { value: { type: 'completed', runId: request.runId, status: 'completed' } } },
    return() { return new Promise(() => {}) },
  } } } } })
  const iterator = h.owner.stream(h.request())[Symbol.asyncIterator]()
  assert.equal((await iterator.next()).value.status, 'completed')
  let timer
  try {
    const result = await Promise.race([iterator.next(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('cleanup stayed pending')), 2500) })])
    assert.equal(result.done, true); assert.equal((await h.usage()).status, 'completed')
  } finally { clearTimeout(timer) }
})

function codexHarness(hooks = {}) {
  const calls = []; let listener; let currentConnection = 'connection-1'
  const api = load('src/workspace/ai/codexProvider.ts', {
    './loginSession': load('src/workspace/ai/loginSession.ts', {}, { URL }),
    '@tauri-apps/api/core': { async invoke(command, args) {
      calls.push([command, args])
      const connection = currentConnection
      if (args.expectedConnectionId && args.expectedConnectionId !== connection) throw new Error('HIVEN_CODEX_CONNECTION_CHANGED')
      const result = hooks.invoke?.(command, args)
      if (result !== undefined) return { ...await result, _hivenConnectionId: connection }
      if (args.method === 'thread/start') return { thread: { id: 'thread-1' }, _hivenConnectionId: connection }
      if (args.method === 'turn/start') return { turn: { id: 'turn-1' }, _hivenConnectionId: connection }
      return { _hivenConnectionId: connection }
    } },
    '@tauri-apps/api/event': { listen(_name, callback) { listener = callback; return hooks.listen?.() ?? Promise.resolve(() => {}) } },
  }, { window: { __TAURI_INTERNALS__: {} } })
  return {
    provider: api.codexChatGptProvider, calls, methods: () => calls.map(([, args]) => args.method),
    replaceConnection: (id) => { currentConnection = id },
    emit: (method, params = {}, id = currentConnection) => listener({ payload: { method, params, _hivenConnectionId: id } }),
  }
}

const providerRequest = (signal) => ({ runId: 'provider-run', agentId: 'chosen-model', input: [{ type: 'text', text: 'input' }], signal })
for (const stage of ['listen', 'initialize', 'thread/start', 'turn/start']) {
  await check(`Codex cancellation while ${stage} is pending blocks subsequent starts`, async () => {
    const gate = deferred(); const entered = deferred()
    const h = codexHarness({
      listen: stage === 'listen' ? () => { entered.resolve(); return gate.promise } : undefined,
      invoke: (_command, args) => { if (args.method === stage) { entered.resolve(); return gate.promise } },
    })
    const controller = new AbortController()
    const pending = collect(h.provider.stream(providerRequest(controller.signal)))
    await entered.promise; controller.abort()
    const events = await bounded(pending)
    assert.equal(events.length, 1); assert.equal(events[0].status, 'cancelled')
    gate.resolve(stage === 'listen' ? () => {} : stage === 'thread/start' ? { thread: { id: 'thread-1' } } : stage === 'turn/start' ? { turn: { id: 'turn-1' } } : {})
    await flush()
    if (stage === 'listen') assert.equal(h.calls.length, 0)
    if (stage === 'initialize') assert.ok(!h.methods().includes('thread/start'))
    if (stage === 'thread/start') assert.ok(!h.methods().includes('turn/start'))
    if (stage === 'turn/start') assert.equal(h.methods().filter((method) => method === 'turn/interrupt').length, 1)
  })
}
await check('Codex aborted RPC cannot replay after initialization-required rejection', async () => {
  const gate = deferred(); const entered = deferred()
  const h = codexHarness({ invoke: (_command, args) => { if (args.method === 'thread/start') { entered.resolve(); return gate.promise } } })
  const controller = new AbortController()
  const pending = collect(h.provider.stream(providerRequest(controller.signal)))
  await entered.promise; controller.abort(); gate.reject(new Error('HIVEN_CODEX_INITIALIZATION_REQUIRED'))
  assert.equal((await bounded(pending))[0].status, 'cancelled'); await flush()
  assert.equal(h.methods().filter((method) => method === 'initialize').length, 1)
  assert.equal(h.methods().filter((method) => method === 'thread/start').length, 1)
})
await check('Codex active RPC reinitializes once and preserves selected model', async () => {
  let attempts = 0
  const h = codexHarness({ invoke: (_command, args) => {
    if (args.method === 'thread/start' && ++attempts === 1) return Promise.reject(new Error('HIVEN_CODEX_INITIALIZATION_REQUIRED'))
  } })
  const iterator = h.provider.stream(providerRequest())[Symbol.asyncIterator]()
  assert.equal((await iterator.next()).value.type, 'run.started')
  assert.equal(h.methods().filter((method) => method === 'initialize').length, 2)
  const starts = h.calls.filter(([, args]) => args.method === 'thread/start' || args.method === 'turn/start')
  assert.ok(starts.every(([, args]) => args.params.model === 'chosen-model'))
  assert.equal(starts[0][1].params.permissions, ':read-only')
  h.emit('turn/completed', { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } })
  h.emit('item/agentMessage/delta', { threadId: 'thread-1', turnId: 'turn-1', delta: 'late' })
  const events = await collect({ [Symbol.asyncIterator]: () => iterator })
  assert.equal(events.length, 1); assert.equal(events[0].status, 'completed')
  assert.ok(!h.methods().includes('turn/interrupt'))
})
await check('Codex live cancellation discards queued deltas and interrupts once', async () => {
  const h = codexHarness(); const controller = new AbortController()
  const iterator = h.provider.stream(providerRequest(controller.signal))[Symbol.asyncIterator]()
  await iterator.next()
  h.emit('item/agentMessage/delta', { threadId: 'thread-1', turnId: 'turn-1', delta: 'queued' })
  controller.abort()
  h.emit('turn/completed', { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } })
  const events = await collect({ [Symbol.asyncIterator]: () => iterator })
  assert.equal(events.length, 1); assert.equal(events[0].status, 'cancelled')
  assert.equal(h.methods().filter((method) => method === 'turn/interrupt').length, 1)
})

await check('Codex EOF fails all active runs on that connection once and permits a fresh connection', async () => {
  const h = codexHarness()
  const first = h.provider.stream({ ...providerRequest(), runId: 'first' })[Symbol.asyncIterator]()
  const second = h.provider.stream({ ...providerRequest(), runId: 'second' })[Symbol.asyncIterator]()
  await Promise.all([first.next(), second.next()])
  const a = first.next(); const b = second.next()
  h.emit('hiven/transport/closed', { message: 'reader EOF' })
  h.emit('hiven/transport/closed', { message: 'duplicate EOF' })
  h.emit('item/agentMessage/delta', { threadId: 'thread-1', delta: 'late' })
  for (const [iterator, pending] of [[first, a], [second, b]]) {
    const terminal = (await bounded(pending)).value
    assert.equal(terminal.type, 'error'); assert.equal(terminal.code, 'codex_transport_closed')
    assert.equal((await iterator.next()).done, true)
  }
  h.replaceConnection('connection-2')
  const fresh = h.provider.stream({ ...providerRequest(), runId: 'fresh' })[Symbol.asyncIterator]()
  assert.equal((await fresh.next()).value.type, 'run.started')
  h.emit('hiven/transport/closed', { message: 'old reader closed later' }, 'connection-1')
  h.emit('turn/completed', { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } }, 'connection-1')
  h.emit('item/agentMessage/delta', { threadId: 'thread-1', turnId: 'turn-1', delta: 'new' })
  assert.equal((await fresh.next()).value.delta, 'new')
  h.emit('turn/completed', { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } })
  assert.equal((await fresh.next()).value.status, 'completed'); await fresh.next()
  const another = h.provider.stream({ ...providerRequest(), runId: 'another' })[Symbol.asyncIterator]()
  await another.next(); await another.return()
  assert.equal(h.methods().filter((method) => method === 'initialize').length, 2, 'stale close cannot invalidate the new handshake')
})
await check('Codex disconnect while turn/start is pending settles without waiting for its RPC', async () => {
  const gate = deferred(); const entered = deferred()
  const h = codexHarness({ invoke: (_command, args) => { if (args.method === 'turn/start') { entered.resolve(); return gate.promise } } })
  const pending = collect(h.provider.stream(providerRequest()))
  await entered.promise
  h.emit('hiven/transport/closed', { message: 'broken transport' })
  const events = await bounded(pending)
  assert.equal(events.length, 1); assert.equal(events[0].code, 'codex_transport_closed')
  gate.resolve({ turn: { id: 'turn-1' } }); await flush()
  assert.equal(h.methods().filter((method) => method === 'initialize').length, 1)
  assert.ok(!h.methods().includes('turn/interrupt'), 'a dead old connection is never restarted to interrupt its old turn')
})
for (const failure of ['EOF', 'error']) {
  await check(`Codex pending startup ${failure} followed by abort preserves the first terminal`, async () => {
    const gate = deferred(); const entered = deferred()
    const h = codexHarness({ invoke: (_command, args) => { if (args.method === 'turn/start') { entered.resolve(); return gate.promise } } })
    const controller = new AbortController()
    const pending = collect(h.provider.stream(providerRequest(controller.signal)))
    await entered.promise
    if (failure === 'EOF') h.emit('hiven/transport/closed', { message: 'EOF first' })
    else h.emit('error', { threadId: 'thread-1', error: { message: 'provider error first' } })
    controller.abort()
    const events = await bounded(pending)
    const terminals = events.filter((event) => event.type === 'completed' || event.type === 'error')
    assert.equal(terminals.length, 1)
    assert.equal(terminals[0].type, 'error')
    assert.equal(terminals[0].code, failure === 'EOF' ? 'codex_transport_closed' : 'codex_error')
    assert.equal(terminals[0].message, failure === 'EOF' ? 'EOF first' : 'provider error first')
    gate.reject(new Error('late startup rejection')); await flush()
  })
}
await check('Codex bound turn/start never retries into a replacement process', async () => {
  const h = codexHarness({ invoke: (_command, args) => {
    if (args.method === 'turn/start') return Promise.reject(new Error('HIVEN_CODEX_INITIALIZATION_REQUIRED'))
  } })
  await assert.rejects(collect(h.provider.stream(providerRequest())), /INITIALIZATION_REQUIRED/)
  assert.equal(h.methods().filter((method) => method === 'initialize').length, 1)
  const turns = h.calls.filter(([, args]) => args.method === 'turn/start')
  assert.equal(turns.length, 1); assert.equal(turns[0][1].expectedConnectionId, 'connection-1')
})
await check('Codex cancel sends its bound generation and cannot interrupt a replacement process', async () => {
  const h = codexHarness(); const controller = new AbortController()
  const iterator = h.provider.stream(providerRequest(controller.signal))[Symbol.asyncIterator]()
  await iterator.next(); h.replaceConnection('connection-2'); controller.abort()
  const events = await collect({ [Symbol.asyncIterator]: () => iterator })
  assert.equal(events.length, 1); assert.equal(events[0].status, 'cancelled')
  const interrupts = h.calls.filter(([, args]) => args.method === 'turn/interrupt')
  assert.equal(interrupts.length, 1); assert.equal(interrupts[0][1].expectedConnectionId, 'connection-1')
  assert.equal(h.methods().filter((method) => method === 'initialize').length, 1)
})
await check('Codex old handshake acknowledgement cannot clear a newer handshake', async () => {
  const gate = deferred(); const entered = deferred()
  const h = codexHarness({ invoke: (command, args) => {
    if (command === 'ai_codex_notify' && args.expectedConnectionId === 'connection-1') { entered.resolve(); return gate.promise }
  } })
  const old = h.provider.stream({ ...providerRequest(), runId: 'old' })[Symbol.asyncIterator]()
  const oldFailure = assert.rejects(old.next(), /CONNECTION_CHANGED/)
  await entered.promise; h.emit('hiven/transport/closed'); h.replaceConnection('connection-2')
  const fresh = h.provider.stream({ ...providerRequest(), runId: 'fresh' })[Symbol.asyncIterator]()
  await fresh.next(); gate.resolve({}); await oldFailure
  const another = h.provider.stream({ ...providerRequest(), runId: 'another' })[Symbol.asyncIterator]()
  await another.next()
  assert.equal(h.methods().filter((method) => method === 'initialize').length, 2)
  const acknowledgements = h.calls.filter(([command]) => command === 'ai_codex_notify')
  assert.deepEqual(acknowledgements.map(([, args]) => args.expectedConnectionId), ['connection-1', 'connection-2'])
  await fresh.return(); await another.return()
})
await check('Codex EOF before initialize response cannot acknowledge the dead connection', async () => {
  const gate = deferred(); const entered = deferred()
  const h = codexHarness({ invoke: (_command, args) => { if (args.method === 'initialize') { entered.resolve(); return gate.promise } } })
  const failure = assert.rejects(collect(h.provider.stream(providerRequest())), /CONNECTION_CHANGED/)
  await entered.promise; h.emit('hiven/transport/closed'); gate.resolve({}); await failure
  assert.ok(!h.methods().includes('initialized')); assert.ok(!h.methods().includes('thread/start'))
})
await check('Codex shared initialization survives cancellation of only one waiter', async () => {
  const gate = deferred(); const entered = deferred()
  const h = codexHarness({ invoke: (_command, args) => { if (args.method === 'initialize') { entered.resolve(); return gate.promise } } })
  const controller = new AbortController()
  const first = collect(h.provider.stream({ ...providerRequest(controller.signal), runId: 'cancelled' }))
  await entered.promise
  const second = h.provider.stream({ ...providerRequest(), runId: 'live' })[Symbol.asyncIterator]()
  const started = second.next(); controller.abort()
  assert.equal((await bounded(first))[0].status, 'cancelled')
  gate.resolve({}); assert.equal((await started).value.type, 'run.started')
  assert.equal(h.methods().filter((method) => method === 'initialize').length, 1)
  h.emit('turn/completed', { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } })
  assert.equal((await second.next()).value.status, 'completed'); await second.next()
})
await check('Codex terminal notification before turn/start response is authoritative', async () => {
  const gate = deferred(); const entered = deferred()
  const h = codexHarness({ invoke: (_command, args) => { if (args.method === 'turn/start') { entered.resolve(); return gate.promise } } })
  const pending = collect(h.provider.stream(providerRequest()))
  await entered.promise
  h.emit('item/agentMessage/delta', { threadId: 'thread-1', turnId: 'turn-1', delta: 'answer' })
  h.emit('turn/completed', { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } })
  h.emit('hiven/transport/closed')
  const events = await bounded(pending)
  assert.deepEqual(events.map((event) => event.type), ['run.started', 'text.delta', 'completed'])
  assert.equal(events.at(-1).status, 'completed')
  gate.resolve({ turn: { id: 'turn-1' } }); await flush()
  assert.ok(!h.methods().includes('turn/interrupt'))
})

function xaiHarness() {
  const invocation = deferred(); const entered = deferred(); const calls = []; let channel
  const api = load('src/workspace/ai/xaiProvider.ts', { '@tauri-apps/api/core': {
    Channel: class { constructor() { channel = this } },
    invoke(command, args) { calls.push([command, args]); if (command === 'ai_xai_response_stream') { entered.resolve(); return invocation.promise } return Promise.resolve() },
  } })
  return { provider: api.xaiGrokProvider, calls, invocation, entered: entered.promise, emit: (raw) => channel.onmessage(raw) }
}
await check('xAI abort before native start cannot launch a late request', async () => {
  const h = xaiHarness(); const controller = new AbortController()
  const iterator = h.provider.stream(providerRequest(controller.signal))[Symbol.asyncIterator]()
  await iterator.next(); controller.abort()
  assert.equal((await iterator.next()).value.status, 'cancelled'); await iterator.next()
  assert.equal(h.calls.length, 0)
})
for (const outcome of ['cancel', 'complete', 'failed', 'incomplete', 'return']) {
  await check(`xAI ${outcome} seals the queue despite a late event or transport rejection`, async () => {
    const h = xaiHarness(); const controller = new AbortController()
    const iterator = h.provider.stream(providerRequest(controller.signal))[Symbol.asyncIterator]()
    await iterator.next()
    const waiting = iterator.next(); await h.entered
    if (outcome === 'return') {
      h.emit({ type: 'response.output_text.delta', delta: 'partial' }); await waiting
      await iterator.return()
    } else {
      if (outcome === 'cancel') controller.abort()
      else if (outcome === 'complete') h.emit({ type: 'response.completed', response: { usage: { output_tokens: 9 } } })
      else if (outcome === 'failed') h.emit({ type: 'response.failed', response: { error: { message: 'backend failure' } } })
      else h.emit({ type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } })
      h.emit({ type: 'response.output_text.delta', delta: 'late' })
      const events = [(await bounded(waiting)).value, ...await bounded(collect({ [Symbol.asyncIterator]: () => iterator }))]
      assert.ok(events.every((event) => event.type !== 'text.delta'))
      assert.equal(events.filter((event) => event.type === 'completed' || event.type === 'error').length, 1)
      const terminal = events.at(-1)
      if (outcome === 'cancel') assert.equal(terminal.status, 'cancelled')
      if (outcome === 'complete') { assert.equal(terminal.status, 'completed'); assert.equal(events[0].metrics[0].amount, 9) }
      if (outcome === 'failed') assert.equal(terminal.message, 'backend failure')
      if (outcome === 'incomplete') assert.equal(terminal.message, 'max_output_tokens')
    }
    h.invocation.reject(new Error('late network failure')); h.emit({ type: 'response.output_text.delta', delta: 'later' }); await flush()
    assert.equal(h.calls.filter(([command]) => command === 'ai_xai_cancel').length, outcome === 'complete' ? 0 : 1)
  })
}
await check('xAI EOF without a terminal cannot silently succeed', async () => {
  const h = xaiHarness(); const iterator = h.provider.stream(providerRequest())[Symbol.asyncIterator]()
  await iterator.next(); const waiting = iterator.next(); await h.entered; h.invocation.resolve()
  await assert.rejects(waiting, /without a terminal/)
  assert.equal(h.calls.filter(([command]) => command === 'ai_xai_cancel').length, 1)
})
console.log(`AI cancellation behavior passed: ${passed} real runtime/provider cases`)
