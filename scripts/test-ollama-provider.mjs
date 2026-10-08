#!/usr/bin/env node
// Real adapter and system i18n; only the native boundary is faked. No model installation or inference.
import assert from 'node:assert/strict'
import { load } from './ai-runtime-test-harness.mjs'

const plain = (value) => JSON.parse(JSON.stringify(value))
const flush = () => new Promise((resolve) => setImmediate(resolve))
function deferred() {
  let resolve, reject
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}
async function bounded(promise) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Stream cleanup remained pending')), 1000)
    })])
  } finally { clearTimeout(timer) }
}
async function collect(iterable) {
  const events = []
  for await (const event of iterable) events.push(event)
  return events
}
const catalog = (overrides = {}) => ({ models: [{ id: 'local-model:latest', digest: 'digest' }], statusReason: null, complete: true, ...overrides })
const request = (overrides = {}) => ({ runId: 'local-run', agentId: 'local-model:latest', input: [{ type: 'text', text: 'synthetic input' }], ...overrides })
function harness({ desktop = true, locale = 'en', description = catalog(), invoke: hook } = {}) {
  const i18n = load('src/i18n/registry.ts', {})
  const messages = load('src/i18n/locales/settings.ts', {}).default
  i18n.registerMessages('settings', messages)
  const calls = []
  const pending = deferred()
  const entered = deferred()
  let channel
  const { ollamaLocalProvider: provider } = load('src/workspace/ai/ollamaProvider.ts', {
    '../../i18n': i18n,
    '../../store': { useAppStore: { getState: () => ({ locale }) } },
    '@tauri-apps/api/core': {
      Channel: class {},
      invoke(command, args) {
        calls.push([command, args])
        const result = hook?.(command, args)
        if (result !== undefined) return result
        if (command === 'ai_ollama_describe') return Promise.resolve(description)
        if (command === 'ai_ollama_cancel') return Promise.resolve()
        if (command === 'ai_ollama_chat_stream') {
          channel = args.onEvent
          entered.resolve()
          return pending.promise
        }
        throw new Error(`Unexpected native call ${command}`)
      },
    },
  }, desktop ? { window: { __TAURI_INTERNALS__: {} } } : {})
  return {
    provider, calls, pending, entered: entered.promise, messages,
    emit: (event) => channel.onmessage(event),
    cancelCalls: () => calls.filter(([name]) => name === 'ai_ollama_cancel'),
  }
}
let passed = 0
async function check(name, run) {
  try { await run(); passed++ } catch (error) { error.message = `${name}: ${error.message}`; throw error }
}

await check('browser discovery reports desktop requirement without native or network work', async () => {
  const h = harness({ desktop: false })
  const result = await h.provider.describe()
  assert.equal(result.statusReason, 'desktop_required')
  assert.equal(result.authentication, 'none'); assert.equal(result.fallbackPolicy, 'never')
  assert.equal(result.agents.length, 0); assert.equal(h.calls.length, 0)
})
await check('only native-installed models are exposed with exact text capabilities and no invented limits', async () => {
  const h = harness()
  const result = await h.provider.describe()
  assert.equal(h.provider.authentication, 'none'); assert.equal(h.provider.fallbackPolicy, 'never')
  assert.equal(h.provider.login, undefined); assert.equal(h.provider.logout, undefined)
  assert.equal(result.id, 'ollama-local'); assert.equal(result.kind, 'ollama-local'); assert.equal(result.name, 'Ollama')
  assert.equal(result.status, 'ready'); assert.equal(result.modelCatalog, 'complete')
  assert.deepEqual(plain(result.capabilities), ['text.generate'])
  assert.deepEqual(plain(result.agents), [{ id: 'local-model:latest', name: 'local-model:latest', capabilities: ['text.generate'], inputModalities: ['text'], supportedEfforts: [] }])
  assert.equal(result.subscription, undefined); assert.equal(result.quota, undefined)
  assert.deepEqual(h.calls.map(([name]) => name), ['ai_ollama_describe'])
})
for (const locale of ['en', 'zh']) {
  for (const reason of ['service_unreachable', 'metadata_timeout', 'metadata_invalid', 'models_empty', 'models_unsupported']) {
    await check(`${locale}: ${reason} remains unavailable and localized, with no fallback models`, async () => {
      const h = harness({ locale, description: catalog({ models: [], statusReason: reason }) })
      const result = await h.provider.describe()
      assert.equal(result.status, 'unavailable'); assert.equal(result.statusReason, reason)
      assert.equal(result.statusMessage, h.messages[locale][`ollamaStatus_${reason}`])
      assert.equal(result.agents.length, 0)
    })
  }
}
await check('incomplete catalog confirms only models returned by native discovery', async () => {
  const h = harness({ description: catalog({ complete: false, statusReason: 'metadata_timeout' }) })
  const result = await h.provider.describe()
  assert.equal(result.status, 'ready'); assert.equal(result.modelCatalog, 'partial')
  assert.equal(result.agents.length, 1); assert.equal(result.statusReason, 'metadata_timeout')
})
await check('unexpected discovery exceptions never expose response bodies', async () => {
  const h = harness({ invoke: (name) => name === 'ai_ollama_describe' ? Promise.reject('PRIVATE RESPONSE BODY') : undefined })
  const result = await h.provider.describe()
  assert.equal(result.status, 'unavailable'); assert.doesNotMatch(result.statusMessage, /PRIVATE/)
  assert.equal(result.statusMessage, h.messages.en.ollamaErrorGeneric)
})
await check('canonical text/reasoning/observed usage preserve ordering and ignore extra terminal events', async () => {
  const h = harness(); const events = collect(h.provider.stream(request({ effort: 'high' })))
  await h.entered
  const args = h.calls[0][1]
  assert.deepEqual(Object.keys(args).sort(), ['input', 'model', 'onEvent', 'runId'])
  h.emit({ type: 'text.delta', delta: 'answer' })
  h.emit({ type: 'reasoning.delta', delta: 'reasoning' })
  h.emit({ type: 'usage.updated', metrics: [{ kind: 'input_tokens', amount: 0, unit: 'token' }, { kind: 'output_tokens', amount: 9, unit: 'token' }] })
  h.emit({ type: 'completed', status: 'completed' })
  h.emit({ type: 'text.delta', delta: 'late' }); h.emit({ type: 'completed', status: 'cancelled' })
  h.pending.resolve()
  const result = await bounded(events)
  assert.deepEqual(result.map((event) => event.type), ['run.started', 'text.delta', 'reasoning.delta', 'usage.updated', 'completed'])
  assert.equal(result.at(-1).status, 'completed')
  assert.deepEqual(plain(result[3].metrics), [{ kind: 'input_tokens', amount: 0, unit: 'token' }, { kind: 'output_tokens', amount: 9, unit: 'token' }])
  assert.equal(h.cancelCalls().length, 0)
})
await check('pre-abort does not invoke any native command', async () => {
  const h = harness(); const controller = new AbortController(); controller.abort()
  assert.deepEqual(plain(await collect(h.provider.stream(request({ signal: controller.signal })))), [{ type: 'completed', runId: 'local-run', status: 'cancelled' }])
  assert.equal(h.calls.length, 0)
})
for (const operation of ['return', 'abort', 'cancel']) {
  await check(`${operation} at run.started prevents native startup`, async () => {
    const h = harness(); const controller = new AbortController()
    const iterator = h.provider.stream(request({ signal: controller.signal }))[Symbol.asyncIterator]()
    assert.equal((await iterator.next()).value.type, 'run.started')
    if (operation === 'return') assert.equal((await iterator.return()).done, true)
    else {
      if (operation === 'abort') controller.abort()
      else await h.provider.cancel('local-run')
      assert.equal((await iterator.next()).value.status, 'cancelled')
      assert.equal((await iterator.next()).done, true)
    }
    assert.equal(h.calls.length, 0)
  })
}
await check('abort clears buffered deltas and completion before they are consumed', async () => {
  const h = harness(); const controller = new AbortController()
  const iterator = h.provider.stream(request({ signal: controller.signal }))[Symbol.asyncIterator]()
  await iterator.next()
  const first = iterator.next(); await h.entered
  h.emit({ type: 'text.delta', delta: 'first' }); assert.equal((await first).value.delta, 'first')
  h.emit({ type: 'text.delta', delta: 'buffered private data' })
  h.emit({ type: 'usage.updated', metrics: [{ kind: 'output_tokens', amount: 3, unit: 'token' }] })
  h.emit({ type: 'completed', status: 'completed' })
  controller.abort(); h.emit({ type: 'text.delta', delta: 'late private data' }); h.pending.reject('late rejection')
  const remaining = await bounded(collect({ [Symbol.asyncIterator]: () => iterator }))
  assert.deepEqual(plain(remaining), [{ type: 'completed', runId: 'local-run', status: 'cancelled' }])
  assert.equal(h.cancelCalls().length, 1)
})
await check('consumer return wakes a pending next and cancels real native work without waiting for its promise', async () => {
  const h = harness(); const iterator = h.provider.stream(request())[Symbol.asyncIterator]()
  await iterator.next(); const waiting = iterator.next(); await h.entered
  const closing = iterator.return()
  assert.equal((await bounded(waiting)).done, true); assert.equal((await bounded(closing)).done, true)
  h.emit({ type: 'text.delta', delta: 'late' }); h.pending.reject('late native failure'); await flush()
  assert.equal(h.cancelCalls().length, 1)
})
await check('native-start cancellation window calls cancel even before the invoke promise returns', async () => {
  const controller = new AbortController()
  const h = harness({ invoke: (name) => { if (name === 'ai_ollama_chat_stream') controller.abort() } })
  const events = await bounded(collect(h.provider.stream(request({ signal: controller.signal }))))
  assert.deepEqual(events.map((event) => event.type), ['run.started', 'completed'])
  assert.equal(events.at(-1).status, 'cancelled')
  assert.deepEqual(h.calls.map(([name]) => name), ['ai_ollama_chat_stream', 'ai_ollama_cancel'])
  h.pending.resolve(); await flush()
})
for (const input of [[], [{ type: 'localFile', path: '/private/file' }], [{ type: 'localImage', path: '/private/image' }], [{ type: 'localAudio', path: '/private/audio' }]]) {
  await check(`unsupported ${input[0]?.type ?? 'empty'} input never reaches native`, async () => {
    const h = harness(); const events = await collect(h.provider.stream(request({ input })))
    assert.equal(events.length, 1); assert.equal(events[0].code, 'OLLAMA_INPUT_UNSUPPORTED')
    assert.equal(h.calls.length, 0)
  })
}
for (const capability of ['web.search', 'tool.call', 'image.understand', 'structured_output']) {
  await check(`${capability} is rejected rather than silently ignored`, async () => {
    const h = harness(); const events = await collect(h.provider.stream(request({ capabilities: [capability] })))
    assert.equal(events[0].code, 'OLLAMA_INPUT_UNSUPPORTED'); assert.equal(h.calls.length, 0)
  })
}
for (const locale of ['en', 'zh']) {
  for (const [code, key] of Object.entries({
    OLLAMA_SERVICE_UNREACHABLE: 'ollamaStatus_service_unreachable', OLLAMA_METADATA_TIMEOUT: 'ollamaStatus_metadata_timeout',
    OLLAMA_METADATA_INVALID: 'ollamaStatus_metadata_invalid', OLLAMA_MODEL_UNAVAILABLE: 'ollamaErrorModelUnavailable',
    OLLAMA_INPUT_UNSUPPORTED: 'ollamaErrorInputUnsupported', OLLAMA_INPUT_TOO_LARGE: 'ollamaErrorInputTooLarge',
    OLLAMA_TIMEOUT: 'ollamaErrorTimeout', OLLAMA_HTTP_ERROR: 'ollamaErrorHttp', OLLAMA_STREAM_INVALID: 'ollamaErrorStreamInvalid',
    OLLAMA_STREAM_INCOMPLETE: 'ollamaErrorStreamIncomplete', OLLAMA_STREAM_TOO_LARGE: 'ollamaErrorStreamTooLarge',
    OLLAMA_TOOL_CALL_UNSUPPORTED: 'ollamaErrorToolCallUnsupported', OLLAMA_OUTPUT_TRUNCATED: 'ollamaErrorOutputTruncated',
    OLLAMA_CHANNEL_CLOSED: 'ollamaErrorChannelClosed',
  })) {
    await check(`${locale}: ${code} maps to a localized terminal error`, async () => {
      const h = harness({ locale }); const events = collect(h.provider.stream(request()))
      await h.entered; h.pending.reject(code)
      const result = await bounded(events)
      assert.equal(result.at(-1).code, code); assert.equal(result.at(-1).message, h.messages[locale][key])
      assert.equal(result.filter((event) => event.type === 'error').length, 1)
      assert.equal(result.some((event) => event.type === 'completed'), false)
    })
  }
}
await check('unknown errors are sanitized and successful invoke without completion is incomplete', async () => {
  for (const error of ['PRIVATE PROMPT RESPONSE', new Error('PRIVATE PATH'), undefined]) {
    const h = harness(); const events = collect(h.provider.stream(request()))
    await h.entered
    if (error === undefined) h.pending.resolve()
    else h.pending.reject(error)
    const result = await bounded(events)
    assert.equal(result.at(-1).code, error === undefined ? 'OLLAMA_STREAM_INCOMPLETE' : 'OLLAMA_ERROR')
    assert.doesNotMatch(result.at(-1).message, /PRIVATE/)
  }
})
for (const raw of [{ type: 'tool.call', text: 'PRIVATE' }, { type: 'usage.updated', metrics: [{ kind: 'input_tokens', amount: -1, unit: 'token' }] }]) {
  await check('invalid channel data fails closed without reflecting its body', async () => {
    const h = harness(); const events = collect(h.provider.stream(request()))
    await h.entered; h.emit(raw); h.emit({ type: 'completed', status: 'completed' }); h.pending.resolve()
    const result = await bounded(events)
    assert.equal(result.at(-1).code, 'OLLAMA_STREAM_INVALID'); assert.doesNotMatch(result.at(-1).message, /PRIVATE/)
  })
}
console.log(`Ollama provider behavior OK (${passed} cases; fake native boundary, no live model inference)`)
